import { createClient } from "redis";

export const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();

    console.log("Redis Connected");
  } catch (error) {
    console.error("Redis Connection Failed", error);
  }
};