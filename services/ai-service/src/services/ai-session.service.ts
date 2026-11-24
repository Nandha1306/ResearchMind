import { AISession, IAISessionSource } from "../models/AISession";
import { describeErrorForLog } from "../../../../packages/shared/errors/safe-error";
import { afterCursor, pageSort, toPage, type ListPageRequest } from "../../../../packages/shared/http/list-page";

export interface CreateAiSessionInput {
  workspaceId: string;
  userId: string;
  query: string;
  answer: string;
  sources: IAISessionSource[];
  aiModel: string;
}

/** Save completed RAG query session into MongoDB. */
export const saveAiSession = async (
  input: CreateAiSessionInput
): Promise<string | null> => {
  try {
    const session = await AISession.create({
      workspaceId: input.workspaceId,
      userId: input.userId,
      query: input.query,
      answer: input.answer,
      sources: input.sources,
      aiModel: input.aiModel,
    });

    return session._id.toString();
  } catch (error) {
    console.error("Failed to save AI session to MongoDB:", describeErrorForLog(error));
    return null;
  }
};

/** Default and maximum page size of the session history (SEC-023). */
export const AI_SESSION_PAGE_DEFAULT = 20;
export const AI_SESSION_PAGE_MAX = 100;

/**
 * The caller's own AI sessions in a workspace, newest first, cursor-paged
 * (SEC-023, user decision: history is private to the asking user; nobody,
 * the owner included, sees another member's questions).
 */
export const getWorkspaceAiSessions = async (
  workspaceId: string,
  userId: string,
  page: ListPageRequest = { limit: AI_SESSION_PAGE_DEFAULT, cursor: null }
) => {
  const rows = await AISession.find({ workspaceId, userId, ...afterCursor(page.cursor, -1) })
    .sort(pageSort(-1))
    .limit(page.limit + 1)
    .lean();
  return toPage(rows as any[], page.limit);
};

export type ClientSessionSource =
  | { documentId: string; chunkIndex: number; score: number }
  | { documentId: ""; chunkIndex: number; score: number; deleted: true };

/**
 * SEC-012 (a): sessions keep their question and answer, but a source that
 * cites a document which is deleted (or gone) is redacted IN PLACE -- same
 * position, so the `[Source N]` numbers in the stored answer still line up
 * -- as `{ documentId: "", deleted: true }`. One batched liveness check per
 * request. If that check cannot run, EVERY source is redacted (fail closed
 * on provenance; the history itself stays readable).
 */
export const redactDeletedSources = async (
  sessions: Array<{ toObject?: () => any } & Record<string, any>>,
  workspaceId: string,
  isLive: (workspaceId: string, ids: string[]) => Promise<{ has: (id: string) => boolean }>
) => {
  const plain = sessions.map((s) => (typeof s.toObject === "function" ? s.toObject() : { ...s }));
  const ids = [
    ...new Set(
      plain.flatMap((s) => (Array.isArray(s.sources) ? s.sources : [])).map((src: any) => String(src?.documentId ?? ""))
    ),
  ].filter(Boolean);

  let live: { has: (id: string) => boolean };
  try {
    live = await isLive(workspaceId, ids);
  } catch (error) {
    console.warn(
      `[ai-service] Could not check source documents for the session history; all sources redacted: ${(error as Error)?.message}`
    );
    live = { has: () => false };
  }

  return plain.map((session) => ({
    ...session,
    sources: (Array.isArray(session.sources) ? session.sources : []).map((src: any): ClientSessionSource => {
      const id = String(src?.documentId ?? "");
      return id && live.has(id)
        ? { documentId: id, chunkIndex: src.chunkIndex, score: src.score }
        : { documentId: "", chunkIndex: src?.chunkIndex, score: src?.score, deleted: true };
    }),
  }));
};
