import mongoose from "mongoose";

/** Connect AI service to MongoDB for session logging. */
export const connectDB = async () => {
  try {
    const mongoUri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI ||
      "mongodb://admin:password@127.0.0.1:27017/researchmind_ai?authSource=admin";

    await mongoose.connect(mongoUri);

    console.log("AI Service MongoDB Connected");
  } catch (error) {
    console.warn("AI Service MongoDB Connection Warning:", error);
  }
};
