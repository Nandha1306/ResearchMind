import Redis from "ioredis";
import {
  attachRedisLogging,
  redisReconnectDelay,
} from "../../../../packages/shared/lifecycle/redis";

/*
 * General-purpose client (health checks). Reconnects forever with a capped
 * backoff; it used to give up after 3 attempts and never recover.
 */
const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: 3,
    retryStrategy: redisReconnectDelay,
  }
);

attachRedisLogging(redis, "ai-service");

export default redis;
