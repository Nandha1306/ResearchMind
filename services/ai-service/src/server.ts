import dotenv from "dotenv";
dotenv.config();

import app from "./app";
import redis from "./config/redis";
import { connectDB } from "./config/db";

const PORT = process.env.PORT || 5006;

/** Start the AI service HTTP server after connecting DB and verifying Redis. */
const startServer = async () => {
  try {
    await connectDB();
    await redis.ping();

    app.listen(PORT, () => {
      console.log(`AI Service running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start AI Service:", error);
    process.exit(1);
  }
};

startServer();