import { AppError } from "../errors/AppError";

/**
 * Bounded, cursor-paged list endpoints (ISS-043).
 *
 * - `?limit=N` (optional): page size, clamped to [1, maxLimit]. When absent,
 *   the page size is `defaultLimit` (set equal to the cap, so a client that
 *   never pages gets everything up to the cap, exactly as before).
 * - `?cursor=...` (optional): opaque token from the previous page's
 *   `meta.nextCursor` (base64url of `<createdAt ISO>|<_id>`). Malformed: 400.
 * - Order is stable: (createdAt, _id) in the list's direction, so pages never
 *   overlap or skip a record that has the same createdAt as another.
 * - Responses keep `{ success, data }` and add `meta: { limit, nextCursor,
 *   hasMore }`.
 */

export interface ListPageRequest {
  limit: number;
  cursor: { createdAt: Date; id: string } | null;
}

export interface ListPageMeta {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");

export const decodeCursor = (raw: string): { createdAt: Date; id: string } => {
  const invalid = () => new AppError("Invalid cursor", 400);
  if (typeof raw !== "string" || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
  const [iso, id, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (rest.length > 0 || !id || !OBJECT_ID.test(id) || Number.isNaN(createdAt.getTime())) throw invalid();
  return { createdAt, id };
};

export const parseListPage = (
  query: Record<string, unknown> | undefined,
  { defaultLimit, maxLimit }: { defaultLimit: number; maxLimit: number }
): ListPageRequest => {
  const rawLimit = query?.limit;
  let limit = defaultLimit;
  if (rawLimit !== undefined && rawLimit !== "") {
    if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      throw new AppError("limit must be a positive integer", 400);
    }
    limit = Math.min(Number(rawLimit), maxLimit);
  }
  const rawCursor = query?.cursor;
  const cursor = rawCursor === undefined || rawCursor === "" ? null : decodeCursor(String(rawCursor));
  return { limit, cursor };
};

/** Mongo filter for "after the cursor" in the given sort direction (-1 newest first). */
export const afterCursor = (cursor: ListPageRequest["cursor"], direction: 1 | -1) => {
  if (!cursor) return {};
  const op = direction < 0 ? "$lt" : "$gt";
  return {
    $or: [{ createdAt: { [op]: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { [op]: cursor.id } }],
  };
};

export const pageSort = (direction: 1 | -1) => ({ createdAt: direction, _id: direction });

/** Turn `limit + 1` fetched rows into the page and its meta. */
export const toPage = <T extends { createdAt?: Date | string; _id?: unknown }>(rows: T[], limit: number) => {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor =
    hasMore && last?.createdAt ? encodeCursor(new Date(last.createdAt), String(last._id)) : null;
  const meta: ListPageMeta = { limit, nextCursor, hasMore };
  return { data, meta };
};
