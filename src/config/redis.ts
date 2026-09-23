import IORedis from 'ioredis';
import { env } from './env';

// BullMQ requires maxRetriesPerRequest: null on the connection it's given,
// otherwise its blocking commands (used internally by Worker) will error out.
// Each caller (the queue producer, the worker) gets its own connection instance.
export function createRedisConnection(): IORedis {
  if (env.redis.url) {
    // Handles rediss:// URLs (TLS) like the ones Upstash issues.
    return new IORedis(env.redis.url, { maxRetriesPerRequest: null });
  }

  return new IORedis({
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password,
    maxRetriesPerRequest: null,
  });
}
