import Redis from "ioredis";

const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        return null;
      }

      return Math.min(times * 100, 2000);
    },
  }
);

redis.on("connect", () => {
  console.log("AI Service Redis Connected");
});

redis.on("error", (error) => {
  console.error("AI Service Redis Error:", error);
});

export default redis;