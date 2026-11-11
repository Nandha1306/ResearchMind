import { connectMongo } from "../../../../packages/shared/lifecycle/mongo";

export const connectDB = async () => {
  try {
    await connectMongo("auth-service", process.env.MONGO_URI, ["MONGO_URI"]);

    console.log("MongoDB Connected");
  } catch (error) {
    console.error("MongoDB Connection Failed:", (error as Error)?.message);

    process.exit(1);
  }
};
