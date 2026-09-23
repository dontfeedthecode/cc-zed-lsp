import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PassThrough } from 'node:stream';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  InitializeRequest,
  InitializedNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  PublishDiagnosticsNotification,
  CompletionRequest,
  HoverRequest,
  DiagnosticSeverity,
  type Diagnostic,
  type ProtocolConnection,
} from 'vscode-languageserver-protocol/node.js';
import { createConnection } from 'vscode-languageserver/node.js';
import { buildServer } from '../src/buildServer.js';

/**
 * Drives the real server over an in-memory duplex pair: a genuine
 * initialize/didOpen/completion exchange with no process spawn. The separate
 * child-process test in cli.test.ts covers packaging, which this cannot.
 */
class TestClient {
  constructor(
    private readonly conn: ProtocolConnection,
    private readonly diagnostics = new Map<string, Diagnostic[]>(),
    private readonly waiters = new Map<string, (d: Diagnostic[]) => void>(),
  ) {}

  static async start(): Promise<TestClient> {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    buildServer(
      createConnection(
        new StreamMessageReader(clientToServer),
        new StreamMessageWriter(serverToClient),
      ),
    );

    const conn = createProtocolConnection(
      new StreamMessageReader(serverToClient),
      new StreamMessageWriter(clientToServer),
    );
    conn.listen();

    const client = new TestClient(conn);
    conn.onNotification(PublishDiagnosticsNotification.type, (p) => {
      client.record(p.uri, p.diagnostics);
    });

    await conn.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      // debounceMs: 0 keeps the tests deterministic without sleeping.
      initializationOptions: { claudeSkills: { debounceMs: 0 } },
      capabilities: {
        textDocument: { completion: { completionItem: { snippetSupport: true } } },
      },
    } as never);
    await conn.sendNotification(InitializedNotification.type, {});
    return client;
  }

  private record(uri: string, diagnostics: Diagnostic[]) {
    this.diagnostics.set(uri, diagnostics);
    this.waiters.get(uri)?.(diagnostics);
    this.waiters.delete(uri);
  }

  async open(uri: string, text: string): Promise<Diagnostic[]> {
    const received = new Promise<Diagnostic[]>((resolve) => this.waiters.set(uri, resolve));
    await this.conn.sendNotification(DidOpenTextDocumentNotification.type, {
      textDocument: { uri, languageId: 'markdown', version: 1, text },
    });
    return received;
  }

  async change(uri: string, text: string): Promise<Diagnostic[]> {
    const received = new Promise<Diagnostic[]>((resolve) => this.waiters.set(uri, resolve));
    await this.conn.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text }],
    });
    return received;
  }

  completion(uri: string, line: number, character: number) {
    return this.conn.sendRequest(CompletionRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  hover(uri: string, line: number, character: number) {
    return this.conn.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line, character },
    });
  }

  dispose() {
    this.conn.dispose();
  }
}

let client: TestClient;
let dir: string;

const skillUri = (name: string) => pathToFileURL(join(dir, name, 'SKILL.md')).toString();
const readmeUri = () => pathToFileURL(join(dir, 'README.md')).toString();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'claude-skills-lsp-'));
  for (const n of ['my-skill', 'other-skill']) mkdirSync(join(dir, n), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  client = await TestClient.start();
});

afterAll(() => {
  client?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const items = (r: unknown) => (Array.isArray(r) ? r : ((r as any)?.items ?? [])) as any[];
const labels = (r: unknown) => items(r).map((i) => i.label);

describe('initialize', () => {
  it('serves a clean skill with no diagnostics', async () => {
    const uri = skillUri('my-skill');
    const d = await client.open(uri, '---\nname: my-skill\ndescription: Does a thing.\n---\n\nBody\n');
    expect(d).toEqual([]);
  });
});

describe('the gate', () => {
  it('stays completely silent in a README', async () => {
    // The failure mode most likely to make someone uninstall: squiggles in
    // files that have nothing to do with Claude Code.
    const d = await client.open(readmeUri(), '---\nbogus: yes\nnope: 1\n---\n# Readme\n');
    expect(d).toEqual([]);
    expect(labels(await client.completion(readmeUri(), 1, 3))).toEqual([]);
    expect(await client.hover(readmeUri(), 1, 3)).toBeNull();
  });
});

describe('diagnostics over the wire', () => {
  it('reports a misplaced subagent key with the right severity and code', async () => {
    const uri = skillUri('other-skill');
    const d = await client.open(
      uri,
      '---\nname: other-skill\ndescription: x\ntools: Read\n---\n\nBody\n',
    );
    const hit = d.find((x) => x.code === 'misplaced-key')!;
    expect(hit).toBeDefined();
    expect(hit.severity).toBe(DiagnosticSeverity.Warning);
    expect(hit.source).toBe('claude-skills');
    expect(hit.message).toContain('allowed-tools');
  });

  it('clears diagnostics once the document is fixed', async () => {
    const uri = skillUri('other-skill');
    const d = await client.change(uri, '---\nname: other-skill\ndescription: x\n---\n\nBody\n');
    expect(d).toEqual([]);
  });

  it('flags an opening fence that is not on line 1 as an error', async () => {
    const uri = skillUri('my-skill');
    const d = await client.change(uri, '\n---\nname: my-skill\ndescription: x\n---\n');
    const hit = d.find((x) => x.code === 'fence-not-first-line')!;
    expect(hit.severity).toBe(DiagnosticSeverity.Error);
  });
});

describe('completion over the wire', () => {
  it('offers frontmatter keys and omits ones already present', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\n\n---\n\nBody\n');
    const got = labels(await client.completion(uri, 2, 0));
    expect(got).toContain('description');
    expect(got).toContain('allowed-tools');
    expect(got).not.toContain('name');
  });

  it('offers enum values with a choice snippet on the key', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\n\n---\n\nBody\n');
    const effort = items(await client.completion(uri, 2, 0)).find((i) => i.label === 'effort');
    expect(effort.textEdit.newText).toBe('effort: ${1|low,medium,high,xhigh,max|}');
  });

  it('offers enum values in value position', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\neffort: \n---\n\nBody\n');
    expect(labels(await client.completion(uri, 2, 8)).sort()).toEqual([
      'high',
      'low',
      'max',
      'medium',
      'xhigh',
    ]);
  });

  it('offers the real built-in tool list for allowed-tools', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\nallowed-tools: \n---\n\nBody\n');
    const got = labels(await client.completion(uri, 2, 15));
    expect(got).toContain('Bash');
    expect(got).toContain('WebFetch');
    expect(got).toContain('Bash(...)');
  });

  it('replaces only the last item in a partially written tool list', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\nallowed-tools: Read, Gr\n---\n\nBody\n');
    // `Gr` begins at column 21; accepting Grep must not swallow `Read, `.
    const grep = items(await client.completion(uri, 2, 23)).find((i) => i.label === 'Grep');
    expect(grep.textEdit.range.start.character).toBe(21);
    expect(grep.textEdit.newText).toBe('Grep');
  });

  it('offers body substitutions after a dollar sign', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\n---\n\nRun $\n');
    expect(labels(await client.completion(uri, 4, 5))).toContain('$ARGUMENTS');
  });
});

describe('hover over the wire', () => {
  it('returns the docs prose for a frontmatter key', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\neffort: high\n---\n\nBody\n');
    const hover: any = await client.hover(uri, 2, 2);
    expect(hover.contents.value).toContain('`effort`');
    expect(hover.contents.value).toContain('xhigh');
    expect(hover.contents.value).toContain('code.claude.com');
  });

  it('returns nothing for a key it does not know', async () => {
    const uri = skillUri('my-skill');
    await client.change(uri, '---\nname: my-skill\nmystery: 1\n---\n\nBody\n');
    expect(await client.hover(uri, 2, 3)).toBeNull();
  });
});
