// Shared Redis instance and timeout helper.
// Import this instead of creating new Redis() in each endpoint.

import { Redis } from '@upstash/redis';
import { checkEnv } from './_checkEnv.js';

checkEnv('KV_REST_API_URL', 'KV_REST_API_TOKEN');

export const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export function withTimeout(promise, ms = 5000, label = 'Redis') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

const LUA_INCR_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return count
`;

export async function incrWithExpiry(key, ttlSec, label = 'rate limit') {
  return withTimeout(
    redis.eval(LUA_INCR_WITH_EXPIRY, [key], [String(ttlSec)]),
    5000, label
  );
}
