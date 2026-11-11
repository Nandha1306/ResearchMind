import logger from "../utils/logger";
import { connectMongo, resolveMongoUri } from "../../../../packages/shared/lifecycle/mongo";

/** Connect document-service to MongoDB. */
export const connectDB = async () => {
  try {
    await connectMongo(
      "document-service",
      resolveMongoUri("MONGODB_URI", "MONGO_URI")?.uri,
      ["MONGODB_URI", "MONGO_URI"]
    );

    logger.info(
      "Document Service MongoDB Connected"
    );
  } catch (error) {
    logger.error(
      `MongoDB Connection Failed: ${(error as Error)?.message}`
    );

    process.exit(1);
  }
};
