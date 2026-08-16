import Redis from "ioredis";

const redisWorker = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return Math.min(times * 100, 2000);
    },
  }
);

redisWorker.on("connect", () => {
  console.log("AI Worker Redis Connected");
});

redisWorker.on("error", (error) => {
  console.error("AI Worker Redis Error:", error);
});

export default redisWorker;