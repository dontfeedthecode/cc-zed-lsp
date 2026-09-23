import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MIN_EXPECTED_BYTES } from './sources.ts';

export class FetchClassError extends Error {
  readonly kind = 'FETCH';
}

export interface FetchedDoc {
  url: string;
  text: string;
  sha256: string;
  bytes: number;
}

/**
 * Fetch a docs page, asserting it still looks like a docs page.
 *
 * These assertions are the FETCH drift class: if the docs site is redesigned,
 * moved behind auth, or starts serving an SPA shell, we want a loud failure and
 * an untouched extract — "stale but correct" beats "silently empty".
 */
export async function fetchDoc(url: string, offlineDir?: string): Promise<FetchedDoc> {
  let text: string;

  if (offlineDir) {
    const name = url.replace(/[^a-z0-9]+/gi, '_');
    text = await readFile(`${offlineDir}/${name}`, 'utf8');
  } else {
    const res = await fetch(url, { headers: { accept: 'text/markdown, text/plain, */*' } });
    if (!res.ok) throw new FetchClassError(`${url} returned HTTP ${res.status}`);

    const ctype = res.headers.get('content-type') ?? '';
    if (!/text\/(markdown|plain)/i.test(ctype)) {
      throw new FetchClassError(`${url} returned content-type "${ctype}", expected text/markdown`);
    }
    text = await res.text();
  }

  const bytes = Buffer.byteLength(text, 'utf8');
  const floor = MIN_EXPECTED_BYTES[url];
  if (floor !== undefined && bytes < floor) {
    throw new FetchClassError(
      `${url} returned ${bytes} bytes, expected at least ${floor}. ` +
        `The page may have been restructured — refusing to regenerate.`,
    );
  }

  return { url, text, sha256: createHash('sha256').update(text).digest('hex'), bytes };
}
