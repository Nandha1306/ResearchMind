import mongoose from "mongoose";

export const connectDB = async () => {
    // console.log("MONGO_URI =", process.env.MONGO_URI);
  try {
    await mongoose.connect(process.env.MONGO_URI!);

    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Failed", error);

    process.exit(1);
  }
};