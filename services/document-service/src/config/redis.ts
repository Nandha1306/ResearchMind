import Redis from "ioredis";
import {
  attachRedisLogging,
  redisReconnectDelay,
} from "../../../../packages/shared/lifecycle/redis";

/*
 * Producer client for the embedding queue.
 *
 * - Reconnects forever with a capped backoff (it used to give up after 3
 *   attempts, leaving uploads unable to enqueue until a restart).
 * - Individual commands still fail fast (maxRetriesPerRequest), so an upload
 *   during an outage is marked "failed" visibly instead of hanging.
 */
const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    maxRetriesPerRequest: 3,
    retryStrategy: redisReconnectDelay,
  }
);

attachRedisLogging(redis, "document-service");

export default redis;
