import mongoose from "mongoose";

/** Connect the Workspace Service to MongoDB. */
export const connectDB = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI!);

    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Failed:", error);

    process.exit(1);
  }
};