/**
 * Regenerate (or drift-check) the docs extract.
 *
 *   npm run docs:sync    # --write : refetch and rewrite the extract + lock
 *   npm run docs:check   # --check : fail on HARD drift, annotate on SOFT
 *
 * Exit codes: 0 ok / SOFT only, 1 HARD drift needing triage, 3 FETCH failure.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELD_TABLES, TOOLS_TABLE, LLMS_INDEX } from './sources.ts';
import { fetchDoc, FetchClassError } from './fetch.ts';
import { extractFields } from './extractors/fields.ts';
import { extractTools } from './extractors/tools.ts';
import { extractPages } from './extractors/pages.ts';
import { buildLockArtifact, classifyDrift, classifyToolDrift, type Lock } from './drift.ts';
import { SKILL_CURATION, SKILL_PORTABLE_FIELDS } from '../../schema/src/curated/skill.fields.ts';
import { UNDOCUMENTED_FIELDS } from '../../schema/src/curated/undocumented.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRACT_PATH = resolve(HERE, '../../schema/src/generated/docs-extract.json');
const LOCK_PATH = resolve(HERE, '../docs-sync.lock.json');

const curatedEnums: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(SKILL_CURATION)
    .filter(([, c]) => Array.isArray(c.enum))
    .map(([k, c]) => [k, c.enum!]),
);
const curatedKnown = new Set([
  ...Object.keys(SKILL_CURATION),
  ...Object.keys(UNDOCUMENTED_FIELDS),
]);

async function readLock(): Promise<Lock | null> {
  try {
    return JSON.parse(await readFile(LOCK_PATH, 'utf8')) as Lock;
  } catch {
    return null;
  }
}

async function main() {
  const write = process.argv.includes('--write');
  const check = process.argv.includes('--check');
  if (write === check) {
    console.error('Pass exactly one of --write or --check');
    process.exit(2);
  }

  const offline = process.env.DOCS_SYNC_OFFLINE_DIR;

  // FETCH class: any failure here aborts before anything is written.
  const llms = await fetchDoc(LLMS_INDEX, offline);
  const knownPages = new Set(extractPages(llms.text));

  const toolsDoc = await fetchDoc(TOOLS_TABLE.url, offline);
  const tools = extractTools(toolsDoc.text, TOOLS_TABLE.pageUrl, knownPages);

  const sources: Lock['sources'] = {
    index: { url: llms.url, sha256: llms.sha256, bytes: llms.bytes },
    tools: { url: toolsDoc.url, sha256: toolsDoc.sha256, bytes: toolsDoc.bytes },
  };

  const artifacts: Record<string, ReturnType<typeof extractFields>> = {};
  for (const src of FIELD_TABLES) {
    const doc = await fetchDoc(src.url, offline);
    sources[src.artifact] = { url: doc.url, sha256: doc.sha256, bytes: doc.bytes };
    artifacts[src.artifact] = extractFields(doc.text, src, knownPages);
  }

  const lock = await readLock();
  const findings = [
    ...Object.entries(artifacts).flatMap(([name, a]) =>
      classifyDrift(name, a, lock?.artifacts?.[name], { enums: curatedEnums, known: curatedKnown }),
    ),
    ...classifyToolDrift(tools, lock),
  ];

  // Links that resolve outside the published page index are SOFT: upstream link
  // rot, worth a PR but never worth blocking on.
  for (const [artifact, a] of Object.entries(artifacts)) {
    for (const [fname, f] of Object.entries(a.fields)) {
      for (const l of f.links) {
        if (!l.known) {
          findings.push({
            cls: 'SOFT',
            message: `${artifact}.${fname}: link ${l.raw} -> ${l.resolved} is not in llms.txt.`,
          });
        }
      }
    }
  }

  const hard = findings.filter((f) => f.cls === 'HARD');
  const soft = findings.filter((f) => f.cls === 'SOFT');

  for (const f of soft) console.log(`SOFT  ${f.message}`);
  for (const f of hard) console.error(`HARD  ${f.message}`);

  if (check) {
    console.log(
      `\n${Object.keys(artifacts).length} artifact(s), ${tools.length} tools, ` +
        `${hard.length} hard / ${soft.length} soft finding(s).`,
    );
    process.exit(hard.length ? 1 : 0);
  }

  const extract = {
    $generated: true,
    $doNotEdit: 'Regenerate with `npm run docs:sync`. Curated facts live in src/curated/.',
    generatorVersion: 1,
    fetchedAt: new Date().toISOString(),
    sources,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([k, a]) => [
        k,
        {
          docsAnchor: a.docsAnchor,
          portableFields: k === 'skill' ? SKILL_PORTABLE_FIELDS : [],
          fields: a.fields,
        },
      ]),
    ),
    tools,
    docPages: [...knownPages].sort(),
  };

  await mkdir(dirname(EXTRACT_PATH), { recursive: true });
  await writeFile(EXTRACT_PATH, JSON.stringify(extract, null, 2) + '\n');

  const newLock: Lock = {
    lockVersion: 1,
    sources,
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([k, a]) => [k, buildLockArtifact(a)]),
    ),
    toolNames: tools.map((t) => t.name),
  };
  await writeFile(LOCK_PATH, JSON.stringify(newLock, null, 2) + '\n');

  console.log(`\nWrote ${EXTRACT_PATH}`);
  console.log(`Wrote ${LOCK_PATH}`);
  console.log(`${tools.length} tools, ${Object.keys(artifacts.skill?.fields ?? {}).length} skill fields.`);
}

main().catch((err) => {
  if (err instanceof FetchClassError) {
    console.error(`\nFETCH  ${err.message}`);
    console.error('Refusing to regenerate. The committed extract is unchanged.');
    process.exit(3);
  }
  console.error(err);
  process.exit(2);
});
