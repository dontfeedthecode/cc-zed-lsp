#!/usr/bin/env node
/**
 * The extension pins an exact server version, so a drift between these four
 * files ships an extension that installs a server it was never tested against.
 * Cheap to check, expensive to discover in the wild.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const pick = (text, re, label) => {
  const m = re.exec(text);
  if (!m) throw new Error(`could not read a version from ${label}`);
  return m[1];
};

const found = {
  'packages/server/package.json': JSON.parse(read('packages/server/package.json')).version,
  'extension/src/lib.rs (SERVER_VERSION)': pick(
    read('extension/src/lib.rs'),
    /SERVER_VERSION: &str = "([^"]+)"/,
    'lib.rs',
  ),
  'extension/Cargo.toml': pick(read('extension/Cargo.toml'), /^version = "([^"]+)"/m, 'Cargo.toml'),
  'extension/extension.toml': pick(
    read('extension/extension.toml'),
    /^version = "([^"]+)"/m,
    'extension.toml',
  ),
};

const unique = [...new Set(Object.values(found))];
for (const [file, version] of Object.entries(found)) {
  console.log(`  ${version.padEnd(12)} ${file}`);
}

if (unique.length !== 1) {
  console.error(`\nVersions disagree: ${unique.join(', ')}`);
  process.exit(1);
}
console.log(`\nAll four agree on ${unique[0]}.`);
