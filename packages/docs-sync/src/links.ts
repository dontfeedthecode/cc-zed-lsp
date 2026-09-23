import { DOCS_ORIGIN } from './sources.ts';

export interface RewrittenLink {
  text: string;
  raw: string;
  resolved: string;
  /** False when the target page is absent from llms.txt — a SOFT drift finding. */
  known: boolean;
}

/**
 * Turn a docs-relative link into an absolute one.
 *
 * Three real shapes appear upstream, and the third is an upstream bug we have to
 * absorb: the `shell` field's description links to `/en/tools-reference#...`,
 * missing the `/docs` segment. A naive prefix-join would produce a 404, so this
 * normalises rather than concatenates.
 */
export function resolveHref(raw: string, pageUrl: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('#')) return `${pageUrl}${raw}`;
  if (raw.startsWith('/docs/')) return `${DOCS_ORIGIN}${raw}`;
  // Upstream bug: `/en/...` is missing the `/docs` prefix.
  if (raw.startsWith('/en/')) return `${DOCS_ORIGIN}/docs${raw}`;
  if (raw.startsWith('/')) return `${DOCS_ORIGIN}${raw}`;
  return raw;
}

const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Rewrite every markdown link in a cell to an absolute URL, and report which
 * targets exist. Done at generate time, not hover time, so the check runs in CI
 * and the committed JSON is self-contained.
 */
export function absolutiseLinks(
  markdown: string,
  pageUrl: string,
  knownPages: ReadonlySet<string>,
): { markdown: string; links: RewrittenLink[] } {
  const links: RewrittenLink[] = [];
  const out = markdown.replace(MD_LINK, (_full, text: string, raw: string) => {
    const resolved = resolveHref(raw, pageUrl);
    const pageOnly = resolved.split('#')[0]!;
    // Only docs pages are expected in llms.txt. A link to an external site
    // (e.g. agentskills.io) is not link rot, so it is never reported.
    const external = !pageOnly.startsWith(DOCS_ORIGIN);
    const known = external || knownPages.size === 0 || knownPages.has(pageOnly);
    links.push({ text, raw, resolved, known });
    return `[${text}](${resolved})`;
  });
  return { markdown: out, links };
}
