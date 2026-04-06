// NarcFilter — /api/verify-key.js
// Validates a NF-XXXXX-XXXXX key and decrements queriesRemaining on success.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN

import { verifyAndDecrementKey } from './_verifyKeyLogic.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, reason: 'Method not allowed' });
  }

  try {
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
