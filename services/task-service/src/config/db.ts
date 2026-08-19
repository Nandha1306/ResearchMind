import mongoose from "mongoose";

/** Connect task-service to MongoDB. */
export const connectDB = async () => {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI!
    );

    console.log("Task Service MongoDB Connected");
  } catch (error) {
    console.error("Task Service MongoDB Connection Failed");
    process.exit(1);
  }
};