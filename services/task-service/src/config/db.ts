import mongoose from "mongoose";
import { connectMongo, resolveMongoUri } from "../../../../packages/shared/lifecycle/mongo";

/**
 * Connect task-service to MongoDB.
 *
 * There is intentionally no fallback URI: silently connecting to a different
 * (unauthenticated) database on failure split task data across databases or
 * left the service "up" with every query failing. A missing or unreachable
 * database now stops the service with a visible error.
 */
export const connectDB = async () => {
  try {
    await connectMongo(
      "task-service",
      resolveMongoUri("MONGODB_URI", "MONGO_URI")?.uri,
      ["MONGODB_URI", "MONGO_URI"]
    );

    console.log("Task Service MongoDB Connected");

    if (process.env.NODE_ENV !== "production") {
      await mongoose.connection.syncIndexes().catch((err) => {
        console.warn("[task-service] Index sync warning:", err.message);
      });
    }
  } catch (error: any) {
    console.error("Task Service MongoDB Connection Failed:", error?.message);
    process.exit(1);
  }
};
