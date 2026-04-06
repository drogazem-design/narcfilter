// Shared key verification + decrement logic.
// Used by both /api/verify-key and /api/analyze.

import { Redis } from '@upstash/redis';

export async function verifyAndDecrementKey(key) {
  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const record = await redis.get(key);

  if (!record)                                                return { valid: false, reason: 'Nieprawidłowy klucz' };
  if (record.expiresAt && new Date(record.expiresAt) < new Date()) return { valid: false, reason: 'Klucz wygasł' };
  if (record.queriesRemaining <= 0)                          return { valid: false, reason: 'Wyczerpano limit zapytań' };

  const updated = { ...record, queriesRemaining: record.queriesRemaining - 1 };
  await redis.set(key, updated);

  return { valid: true, queriesRemaining: updated.queriesRemaining, packageType: record.packageType };
}
