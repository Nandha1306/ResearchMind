import { createClient } from "redis";

export const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
});

/*
 * node-redis emits "error" on every connection problem; an EventEmitter error
 * with no listener throws and would crash the auth service. Log it instead.
 */
redisClient.on("error", (error: Error) => {
  console.error(`[auth-service] Redis error: ${error?.message}`);
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();

    console.log("Redis Connected");
  } catch (error) {
    console.error("Redis Connection Failed", error);
  }
};

/** Close the client during shutdown without hanging when Redis is down. */
export const closeRedis = async () => {
  if (redisClient.isReady) {
    await redisClient.close();
  } else if (redisClient.isOpen) {
    redisClient.destroy();
  }
};
