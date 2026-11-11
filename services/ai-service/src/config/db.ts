import { connectMongo, resolveMongoUri } from "../../../../packages/shared/lifecycle/mongo";

/**
 * Connect AI service to MongoDB for session logging.
 *
 * Failure is propagated to the caller (server.ts exits). It used to be only a
 * warning, which let the service run without a database: every answered
 * question was then silently not saved and GET /sessions hung and failed.
 * No hardcoded fallback URI (the old default embedded credentials).
 */
export const connectDB = async () => {
  await connectMongo(
    "ai-service",
    resolveMongoUri("MONGODB_URI", "MONGO_URI")?.uri,
    ["MONGODB_URI", "MONGO_URI"]
  );

  console.log("AI Service MongoDB Connected");
};
