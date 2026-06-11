// NarcFilter — /api/verify-key.js
// Validates a NF-XXXXX-XXXXX key and decrements queriesRemaining on success.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN

import { verifyAndDecrementKey } from './_verifyKeyLogic.js';
import { checkIpRateLimit } from './_redis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, reason: 'Method not allowed' });
  }

  try {
    // Per-IP rate limit (defends against key-guessing)
    try {
      const ipAllowed = await checkIpRateLimit(req, 'verify-key', 30);
      if (!ipAllowed) {
        return res.status(429).json({
          valid: false,
          reason: 'Zbyt wiele żądań. Odczekaj minutę.',
          retryAfter: 60,
        });
      }
    } catch (ipErr) {
      console.error('verify-key IP rate limit failed (failing closed):', ipErr);
      return res.status(503).json({ valid: false, reason: 'Chwilowy problem techniczny, spróbuj za chwilę.' });
    }

    const { key } = req.body ?? {};

    if (!key || typeof key !== 'string' || !/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)) {
      return res.status(400).json({ valid: false, reason: 'Nieprawidłowy klucz' });
    }

    const result = await verifyAndDecrementKey(key);
    return res.status(200).json(result);

  } catch (err) {
    console.error('verify-key error:', err);
    return res.status(500).json({ valid: false, reason: 'Błąd serwera' });
  }
}
