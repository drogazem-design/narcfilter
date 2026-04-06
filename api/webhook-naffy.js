// NarcFilter — /api/webhook-naffy.js
// Receives purchase webhooks from Naffy, generates an NF access key and emails it to the buyer.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import { PACKAGES, createAndDeliverKey } from './_generateKeyLogic.js';

// Maps Naffy product identifiers to NarcFilter package types.
// Extend this map as new products are added in Naffy.
const NAFFY_PRODUCT_MAP = {
  monthly:   'monthly',
  quarterly: 'quarterly',
  addon:     'addon',
};

function resolvePackageType(body) {
  // Try common Naffy payload fields for product/plan identification.
  const raw = body?.product_id ?? body?.plan ?? body?.packageType ?? 'monthly';
  return NAFFY_PRODUCT_MAP[raw] ?? 'monthly';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body ?? {};
    const email = body.email ?? body.customer_email ?? body.buyer_email;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Brak lub nieprawidłowy adres email' });
    }

    const packageType = resolvePackageType(body);
    if (!PACKAGES[packageType]) {
      return res.status(400).json({ success: false, error: `Nieznany typ pakietu: ${packageType}` });
    }

    const { key } = await createAndDeliverKey({ packageType, customerEmail: email });

    console.log(`webhook-naffy: key ${key} created for ${email} (${packageType})`);
    return res.status(200).json({ success: true, key });

  } catch (err) {
    console.error('webhook-naffy error:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
}
