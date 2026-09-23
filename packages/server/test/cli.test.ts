import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The only test that spawns a real process.
 *
 * Everything else drives the server in-process, which cannot catch the failures
 * that actually reach users: a broken shebang, a missing `bin` entry, a file
 * left out of the published tarball, or an ESM/CJS mismatch. One test, aimed
 * squarely at packaging.
 */
describe.skipIf(!existsSync(join(pkgDir, 'dist/server.js')))('packaged CLI', () => {
  it('completes an LSP initialize handshake over stdio', async () => {
    const child = spawn(process.execPath, [join(pkgDir, 'bin/server.js'), '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { processId: null, rootUri: null, capabilities: {} },
    });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);

    const response = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`timed out; stdout was: ${buf}`)), 10_000);
      child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        if (buf.includes('"capabilities"')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      child.stderr.on('data', (c) => (buf += `[stderr] ${c}`));
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited early with code ${code}; output: ${buf}`));
      });
    });

    child.kill();
    expect(response).toContain('completionProvider');
    expect(response).toContain('hoverProvider');
    expect(response).toContain('claude-skills-lsp');
  });

  it('ships bin/ and dist/ in the published tarball', () => {
    // A `files` array that omits bin/ produces a package that installs cleanly
    // and then cannot start. npm pack is the only thing that sees this.
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
    });
    const files: string[] = JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
    expect(files).toContain('bin/server.js');
    expect(files).toContain('dist/server.js');
  });
});
