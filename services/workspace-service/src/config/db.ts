import mongoose from "mongoose";
import { connectMongo } from "../../../../packages/shared/lifecycle/mongo";

/** Connect the Workspace Service to MongoDB. */
export const connectDB = async (): Promise<void> => {
  try {
    await connectMongo("workspace-service", process.env.MONGO_URI, ["MONGO_URI"]);
    console.log("MongoDB Connected");

    if (process.env.NODE_ENV !== "production") {
      await mongoose.connection.syncIndexes().catch((err) => {
        console.warn("[workspace-service] Index sync warning:", err.message);
      });
    }
  } catch (error) {
    console.error("MongoDB Connection Failed:", (error as Error)?.message);

    process.exit(1);
  }
};
