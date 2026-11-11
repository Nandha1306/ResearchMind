import mongoose from "mongoose";

/** Connect task-service to MongoDB. */
export const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/researchmind";
    try {
      await mongoose.connect(uri);
    } catch (e) {
      console.warn("Primary MONGO_URI failed, attempting fallback to mongodb://127.0.0.1:27017/researchmind...");
      await mongoose.connect("mongodb://127.0.0.1:27017/researchmind");
    }

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