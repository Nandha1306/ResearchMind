import mongoose from "mongoose";
import logger from "../utils/logger";

/** Connect document-service to MongoDB. */
export const connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI!
    );

    logger.info(
      "Document Service MongoDB Connected"
    );
  } catch (error) {
    logger.error(
      "MongoDB Connection Failed"
    );
    
    process.exit(1);
  }
};