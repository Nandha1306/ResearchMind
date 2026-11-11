import Redis from "ioredis";
import {
  attachRedisLogging,
  redisReconnectDelay,
} from "../../../../packages/shared/lifecycle/redis";

/*
 * Dedicated blocking-consumer client for the embedding worker. BLPOP must not
 * time out on reconnects, hence maxRetriesPerRequest: null; it reconnects
 * forever with a capped backoff.
 */
const redisWorker = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: null,
    retryStrategy: redisReconnectDelay,
  }
);

attachRedisLogging(redisWorker, "ai-service:worker");

export default redisWorker;
