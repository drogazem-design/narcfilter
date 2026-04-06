// NarcFilter — /api/verify-key.js
// Validates a NF-XXXXX-XXXXX key, decrements queriesRemaining on success.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN

import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, reason: 'Method not allowed' });
  }

  try {
    const { key } = req.body ?? {};

    if (!key || typeof key !== 'string' || !/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(key)) {
      return res.status(400).json({ valid: false, reason: 'Nieprawidłowy klucz' });
    }

    const redis = new Redis({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const record = await redis.get(key);

    if (!record) {
      return res.status(200).json({ valid: false, reason: 'Nieprawidłowy klucz' });
    }

    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return res.status(200).json({ valid: false, reason: 'Klucz wygasł' });
    }

    if (record.queriesRemaining <= 0) {
      return res.status(200).json({ valid: false, reason: 'Wyczerpano limit zapytań' });
    }

    const updated = { ...record, queriesRemaining: record.queriesRemaining - 1 };
    await redis.set(key, updated);

    return res.status(200).json({
      valid: true,
      queriesRemaining: updated.queriesRemaining,
      packageType: record.packageType,
    });

  } catch (err) {
    console.error('verify-key error:', err);
    return res.status(500).json({ valid: false, reason: 'Błąd serwera' });
  }
}
