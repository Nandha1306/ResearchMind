/**
 * Cursor paging for list endpoints (ISS-043). Framework-free so it can be
 * unit-tested with a stubbed axios.
 *
 * The server returns one capped page per request plus
 * `meta: { limit, nextCursor, hasMore }` (newest-first lists use a
 * (createdAt desc, _id desc) cursor). The UI keeps showing whole lists by
 * following `nextCursor`, up to MAX_LIST_PAGES requests so a huge workspace
 * cannot make the browser loop; when that ceiling is hit, `truncated` is
 * true and the page shows a "showing first N" notice.
 */

export const MAX_LIST_PAGES = 10;

export interface ListMeta {
  limit?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface PagedList<T> {
  items: T[];
  /** True when more items exist than were loaded (the page ceiling was hit). */
  truncated: boolean;
}

/** The part of axios.get this helper needs. */
export type GetFn = (
  url: string,
  config?: { params?: Record<string, unknown> }
) => Promise<{ data: { data?: unknown; meta?: ListMeta } }>;

export const fetchAllPages = async <T>(
  get: GetFn,
  url: string,
  params: Record<string, unknown> = {},
  maxPages: number = MAX_LIST_PAGES
): Promise<PagedList<T>> => {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const response = await get(url, { params: cursor === undefined ? { ...params } : { ...params, cursor } });
    const body = response.data;
    if (Array.isArray(body?.data)) items.push(...(body.data as T[]));
    const next = body?.meta?.hasMore ? body.meta.nextCursor : null;
    if (!next) return { items, truncated: false };
    cursor = next;
  }
  return { items, truncated: true };
};
