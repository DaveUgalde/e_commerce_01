import { Redis } from 'ioredis';

export const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
});