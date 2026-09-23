/**
 * The upstream pages the schema is derived from.
 *
 * Adding an artifact type (agent, command, hook) starts here: add an entry, add
 * a curated field file, add a path matcher. Nothing in the feature layer changes.
 */
export const DOCS_ORIGIN = 'https://code.claude.com';

export interface FieldTableSource {
  /** Matches an ArtifactKind in @thecode/claude-skills-schema. */
  artifact: string;
  url: string;
  /** Page the table's relative links resolve against. */
  pageUrl: string;
  /** Anchor appended to hover "Docs" links. */
  anchor: string;
  /** Heading the frontmatter table lives under, used to locate it. */
  heading: string;
}

export const FIELD_TABLES: FieldTableSource[] = [
  {
    artifact: 'skill',
    url: `${DOCS_ORIGIN}/docs/en/skills.md`,
    pageUrl: `${DOCS_ORIGIN}/docs/en/skills`,
    anchor: 'frontmatter-reference',
    heading: 'Frontmatter reference',
  },
  // Phase 2:
  // { artifact: 'agent',   url: `${DOCS_ORIGIN}/docs/en/sub-agents.md`, ... },
  // { artifact: 'command', url: `${DOCS_ORIGIN}/docs/en/slash-commands.md`, ... },
];

/** The canonical built-in tool list, used for `allowed-tools` completion. */
export const TOOLS_TABLE = {
  url: `${DOCS_ORIGIN}/docs/en/tools-reference.md`,
  pageUrl: `${DOCS_ORIGIN}/docs/en/tools-reference`,
};

/** Page index, used to validate that rewritten links point somewhere real. */
export const LLMS_INDEX = `${DOCS_ORIGIN}/llms.txt`;

/**
 * A fetched page must look like what we expect before we overwrite anything.
 * A docs redesign should fail loudly, not silently empty the extract.
 */
export const MIN_EXPECTED_BYTES: Record<string, number> = {
  [`${DOCS_ORIGIN}/docs/en/skills.md`]: 60_000,
  [`${DOCS_ORIGIN}/docs/en/tools-reference.md`]: 50_000,
  [LLMS_INDEX]: 20_000,
};
