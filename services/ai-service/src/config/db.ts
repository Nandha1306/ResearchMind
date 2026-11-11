import mongoose from "mongoose";

/** Connect AI service to MongoDB for session logging. */
export const connectDB = async () => {
  try {
    /*
     * No hardcoded fallback: the previous default embedded real database
     * credentials in tracked source, which is a committed secret.
     */
    const mongoUri =
      process.env.MONGODB_URI ||
      process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error(
        "MONGO_URI is not configured for ai-service"
      );
    }

    await mongoose.connect(mongoUri);

    console.log("AI Service MongoDB Connected");
  } catch (error) {
    console.warn("AI Service MongoDB Connection Warning:", error);
  }
};
