import { AISession, IAISessionSource } from "../models/AISession";

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
): Promise<string> => {
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
    console.error("Failed to save AI session to MongoDB:", error);
    return `session_${Date.now()}`;
  }
};

/** Retrieve recent AI sessions for a workspace. */
export const getWorkspaceAiSessions = async (workspaceId: string) => {
  return AISession.find({ workspaceId }).sort({ createdAt: -1 }).limit(20);
};
