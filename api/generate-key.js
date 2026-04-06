// NarcFilter — /api/generate-key.js
// Generates a NF-XXXXX-XXXXX access key, saves to Upstash Redis, sends email via Resend.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import { PACKAGES, createAndDeliverKey } from './_generateKeyLogic.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { packageType, customerEmail } = req.body ?? {};

    if (!packageType || !PACKAGES[packageType]) {
      return res.status(400).json({ success: false, error: 'Invalid packageType' });
    }
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ success: false, error: 'Invalid customerEmail' });
    }

    const { key } = await createAndDeliverKey({ packageType, customerEmail });
    return res.status(200).json({ success: true, key });

  } catch (err) {
    console.error('generate-key error:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
}
