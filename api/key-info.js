// NarcFilter — /api/key-info.js
// Read-only key lookup — returns queriesRemaining without decrementing.

import { redis, withTimeout, checkIpRateLimit } from './_redis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Per-IP rate limit
    try {
      const ipAllowed = await checkIpRateLimit(req, 'key-info', 30);
      if (!ipAllowed) {
        return res.status(429).json({
          valid: false,
          reason: 'Zbyt wiele żądań. Odczekaj minutę.',
          retryAfter: 60,
        });
      }
    } catch (ipErr) {
      console.error('key-info IP rate limit failed (failing closed):', ipErr);
      return res.status(503).json({ valid: false, reason: 'Chwilowy problem techniczny, spróbuj za chwilę.' });
    }

    const { key } = req.body ?? {};

    if (!key || typeof key !== 'string' || !/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)) {
      return res.status(400).json({ valid: false, reason: 'Nieprawidłowy klucz' });
    }

    const raw = await withTimeout(redis.get(key), 5000, 'key-info');
    if (!raw) return res.status(200).json({ valid: false, reason: 'Nieprawidłowy klucz' });

    const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (rec.expiresAt && new Date().toISOString() > rec.expiresAt) {
      return res.status(200).json({ valid: false, reason: 'Klucz wygasł' });
    }

    return res.status(200).json({
      valid: true,
      queriesRemaining: rec.queriesRemaining ?? 0,
      packageType: rec.packageType ?? null,
    });

  } catch (err) {
    console.error('key-info error:', err);
    return res.status(500).json({ valid: false, reason: 'Błąd serwera' });
  }
}
