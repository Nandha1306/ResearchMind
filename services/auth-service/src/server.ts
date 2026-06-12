import dotenv from "dotenv";

dotenv.config();

import app from "./app";
import { connectDB } from "./config/db";
import { connectRedis } from "./config/redis";

const PORT = process.env.PORT || 5001;

const startServer = async () => {
  await connectDB();

  await connectRedis();

  app.listen(PORT, () => {
    console.log(`Auth Service running on port ${PORT}`);
  });
};

startServer();