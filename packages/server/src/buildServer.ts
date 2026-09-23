import {
  TextDocuments,
  TextDocumentSyncKind,
  type Connection,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

import { classify, type ArtifactDescriptor } from "./gate.js";
import { readConfig, DEFAULT_CONFIG, type ServerConfig } from "./config.js";
import { computeDiagnostics } from "./features/diagnostics.js";
import { computeCompletions } from "./features/completion.js";
import { computeHover } from "./features/hover.js";

/**
 * Wire an LSP connection. Kept separate from the stdio entry point so the test
 * suite can drive the real server over an in-memory stream pair — full protocol
 * fidelity, no process spawn, milliseconds per case.
 */
export function buildServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);

  let config: ServerConfig = DEFAULT_CONFIG;
  let snippetSupport = false;

  /**
   * Gate results, cached per URI.
   *
   * The extension attaches to every Markdown buffer, so this runs for READMEs,
   * changelogs and blog drafts too. Caching the null keeps the common case to a
   * map lookup and is what makes that attachment strategy tolerable.
   */
  const gateCache = new Map<string, ArtifactDescriptor | null>();

  function artifactFor(uri: string): ArtifactDescriptor | null {
    if (gateCache.has(uri)) return gateCache.get(uri)!;
    const result = classify(uri, {
      include: config.include,
      exclude: config.exclude,
      enabled: config.enabled,
    });
    gateCache.set(uri, result);
    return result;
  }

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    config = readConfig(params.initializationOptions);
    snippetSupport =
      params.capabilities.textDocument?.completion?.completionItem
        ?.snippetSupport ?? false;

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
          // ':' and '-' cover frontmatter values and list items; '$' and '{'
          // cover body substitutions. Clients that ignore trigger characters
          // still reach all of these on explicit invoke.
          triggerCharacters: [":", "-", " ", "$", "{", "[", ","],
          resolveProvider: false,
        },
        hoverProvider: true,
      },
      serverInfo: { name: "claude-skills-lsp", version: "0.1.0" },
    };
  });

  connection.onDidChangeConfiguration((change) => {
    config = readConfig(change.settings);
    gateCache.clear();
    for (const doc of documents.all()) scheduleDiagnostics(doc.uri);
  });

  // --- diagnostics -----------------------------------------------------------

  const pending = new Map<string, NodeJS.Timeout>();

  function publish(uri: string): void {
    const doc = documents.get(uri);
    if (!doc) return;

    const artifact = artifactFor(uri);
    if (!artifact) {
      // Always publish, even when empty: a rename out of skill shape must clear
      // whatever we previously reported.
      connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }

    connection.sendDiagnostics({
      uri,
      diagnostics: computeDiagnostics(doc, artifact, config),
    });
  }

  function scheduleDiagnostics(uri: string): void {
    const existing = pending.get(uri);
    if (existing) clearTimeout(existing);

    if (config.debounceMs <= 0) {
      publish(uri);
      return;
    }
    pending.set(
      uri,
      setTimeout(() => {
        pending.delete(uri);
        publish(uri);
      }, config.debounceMs),
    );
  }

  documents.onDidChangeContent((e) => scheduleDiagnostics(e.document.uri));

  documents.onDidClose((e) => {
    const timer = pending.get(e.document.uri);
    if (timer) clearTimeout(timer);
    pending.delete(e.document.uri);
    gateCache.delete(e.document.uri);
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  });

  // --- completion & hover ----------------------------------------------------

  connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const artifact = artifactFor(params.textDocument.uri);
    if (!artifact) return [];

    return computeCompletions(
      doc,
      doc.offsetAt(params.position),
      artifact,
      snippetSupport,
    );
  });

  connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const artifact = artifactFor(params.textDocument.uri);
    if (!artifact) return null;

    return computeHover(doc, doc.offsetAt(params.position), artifact);
  });

  documents.listen(connection);
  connection.listen();
}
