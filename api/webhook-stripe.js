// NarcFilter — /api/webhook-stripe.js
// Receives Stripe checkout.session.completed events, generates NF key and emails buyer.
// Env vars required: STRIPE_WEBHOOK_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import Stripe from 'stripe';
import { Resend } from 'resend';
import { createAndDeliverKey, topUpKey, isSessionProcessed, markSessionProcessed, PACKAGES } from './_generateKeyLogic.js';
import { checkEnv } from './_checkEnv.js';

checkEnv('STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Disable Vercel's body parser — Stripe signature verification requires the raw body.
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let rejected = false;
    const LIMIT = 1 * 1024 * 1024;
    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > LIMIT) {
        rejected = true;
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

const PAYMENT_LINK_MAP = {
  'plink_1TK0NYDg3rjklSS3sYlIEbYR': 'starter',
  'plink_1TK0Q8Dg3rjklSS3qVOP0Iif': 'standard',
  'plink_1TK0QmDg3rjklSS3cpH6lEhl': 'pro',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req).catch(() => null);
  if (!rawBody) {
    return res.status(400).json({ error: 'Could not read request body' });
  }

  const sig = req.headers['stripe-signature'];

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

  const packageType = PAYMENT_LINK_MAP[session.payment_link];
  if (!packageType) {
    console.log(`webhook-stripe: ignoring payment_link ${session.payment_link}`);
    return res.status(200).json({ received: true });
  }

  if (await isSessionProcessed(session.id)) {
    console.log(`webhook-stripe: duplicate event ${session.id}, skipping`);
    return res.status(200).json({ received: true });
  }

  try {
    const queriesCount = PACKAGES[packageType].queriesRemaining;
    const topped = await topUpKey({ queriesCount, customerEmail: email });
    if (topped) {
      await markSessionProcessed(session.id);
      console.log(`webhook-stripe: key topped up +${queriesCount} (${packageType}), session ${session.id}`);
      return res.status(200).json({ received: true });
    }
    await createAndDeliverKey({ packageType, customerEmail: email });
    await markSessionProcessed(session.id);
    console.log(`webhook-stripe: new key created (${packageType}), session ${session.id}`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('webhook-stripe: createAndDeliverKey failed:', err);
    try {
      await resend.emails.send({
        from:    'kontakt@kompasrozwodowy.eu',
        to:      'kontakt@kompasrozwodowy.eu',
        subject: '[NarcFilter] Błąd dostawy klucza',
        text: [
          `Email klienta: ${email}`,
          `Session ID: ${session.id}`,
          `Pakiet: ${packageType}`,
          `Błąd: ${err.message}`,
        ].join('\n'),
      });
    } catch (alertErr) {
      console.error('webhook-stripe: failed to send alert email:', alertErr);
    }
    // Return 200 to prevent Stripe from retrying.
    return res.status(200).json({ received: true, error: 'Delivery failed' });
  }
}
