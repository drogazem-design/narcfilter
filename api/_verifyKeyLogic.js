// Shared key verification + decrement logic.
// Used by both /api/verify-key and /api/analyze.

import { redis, withTimeout } from './_redis.js';

// Atomic verify-and-decrement via Lua script — eliminates the read-modify-write race condition.
// KEYS[1] = access key, ARGV[1] = current ISO timestamp for expiry check.
// ISO 8601 UTC strings are lexicographically sortable, so string comparison is correct.
// Returns a JSON-encoded result object that the JS side parses.
const LUA_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return cjson.encode({status='not_found'})
end
local rec = cjson.decode(raw)
if type(rec.expiresAt) == 'string' and ARGV[1] > rec.expiresAt then
  return cjson.encode({status='expired'})
end
if rec.queriesRemaining <= 0 then
  return cjson.encode({status='exhausted'})
end
rec.queriesRemaining = rec.queriesRemaining - 1
redis.call('SET', KEYS[1], cjson.encode(rec))
return cjson.encode({status='ok', queriesRemaining=rec.queriesRemaining, packageType=rec.packageType})
`;

export async function verifyAndDecrementKey(key) {
  const raw = await withTimeout(redis.eval(LUA_SCRIPT, [key], [new Date().toISOString()]), 5000, 'verify key');
  const result = typeof raw === 'string' ? JSON.parse(raw) : raw;

  if (result.status === 'not_found')  return { valid: false, reason: 'Nieprawidłowy klucz' };
  if (result.status === 'expired')    return { valid: false, reason: 'Klucz wygasł' };
  if (result.status === 'exhausted')  return { valid: false, reason: 'Wyczerpano limit zapytań' };

  return { valid: true, queriesRemaining: result.queriesRemaining, packageType: result.packageType };
}
