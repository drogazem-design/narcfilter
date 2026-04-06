// NarcFilter — /api/webhook-stripe.js
// Receives Stripe checkout.session.completed events, generates NF key and emails buyer.
// Env vars required: STRIPE_WEBHOOK_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import Stripe from 'stripe';
import { createAndDeliverKey } from './_generateKeyLogic.js';

// Disable Vercel's body parser — Stripe signature verification requires the raw body.
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Amount-to-package mapping (amount_total in grosz, 1 PLN = 100 grosz).
// Exact match preferred; falls back to nearest lower threshold.
const AMOUNT_MAP = [
  { amount: 5900, packageType: 'quarterly' }, // 59 PLN → 500 analiz
  { amount: 2900, packageType: 'monthly'   }, // 29 PLN → 100 analiz
  { amount:  900, packageType: 'starter'   }, //  9 PLN →  10 analiz
];

function resolvePackageType(session) {
  const amount = session.amount_total ?? 0;
  for (const { amount: threshold, packageType } of AMOUNT_MAP) {
    if (amount >= threshold) return packageType;
  }
  return 'starter'; // safest fallback
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req).catch(() => null);
  if (!rawBody) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig    = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook signature invalid: ${err.message}` });
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge other event types without processing
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const email   = session.customer_details?.email;

  if (!email) {
    console.error('webhook-stripe: no email in session', session.id);
    return res.status(200).json({ received: true, warning: 'no email found' });
  }

  try {
    const packageType = resolvePackageType(session);
    const { key } = await createAndDeliverKey({ packageType, customerEmail: email });
    console.log(`webhook-stripe: key ${key} created for ${email} (${packageType}), session ${session.id}`);
    return res.status(200).json({ received: true, key });

  } catch (err) {
    console.error('webhook-stripe: createAndDeliverKey failed:', err);
    // Return 200 to prevent Stripe from retrying — log the error for manual resolution.
    return res.status(200).json({ received: true, error: err.message });
  }
}
