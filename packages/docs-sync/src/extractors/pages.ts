/**
 * Every doc page URL, harvested from llms.txt. Used to verify that links we
 * rewrite actually point somewhere, which catches upstream link rot.
 *
 * llms.txt lists pages with a `.md` suffix (`/docs/en/model-config.md`) while
 * in-page links omit it (`/docs/en/model-config`). Both forms are recorded so a
 * lookup succeeds whichever way the link was written.
 */
export function extractPages(llmsTxt: string): string[] {
  const urls = new Set<string>();
  for (const m of llmsTxt.matchAll(/https?:\/\/[^\s)\]]+/g)) {
    const bare = m[0].replace(/[.,]+$/, '').split('#')[0]!;
    urls.add(bare);
    if (bare.endsWith('.md')) urls.add(bare.slice(0, -3));
    else urls.add(`${bare}.md`);
  }
  return [...urls].sort();
}
