// NarcFilter — /api/webhook-stripe.js
// Receives Stripe checkout.session.completed events, generates NF key and emails buyer.
// Env vars required: STRIPE_WEBHOOK_SECRET, KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import Stripe from 'stripe';
import { Resend } from 'resend';
import { createAndDeliverKey, topUpKey, PACKAGES } from './_generateKeyLogic.js';
import { checkEnv } from './_checkEnv.js';
import { redis, withTimeout } from './_redis.js';

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
  'plink_1TT0JKDg3rjklSS3hFN4Bp7o': 'starter',
  'plink_1TT0JUDg3rjklSS3Z5drAAz7': 'standard',
  'plink_1TT0JWDg3rjklSS3ioLl2rU7': 'pro',
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
    try {
      await resend.emails.send({
        from:    'kontakt@kompasrozwodowy.eu',
        to:      'kontakt@kompasrozwodowy.eu',
        subject: '[NarcFilter] Brak emaila w sesji Stripe',
        text: [
          `Session ID: ${session.id}`,
          `Payment Link: ${session.payment_link}`,
          `Customer details: ${JSON.stringify(session.customer_details ?? {}, null, 2)}`,
          '',
          'Klient zapłacił, ale Stripe nie przekazał adresu email — manualny follow-up wymagany.',
        ].join('\n'),
      });
    } catch (alertErr) {
      console.error('webhook-stripe: failed to send no-email alert:', alertErr);
    }
    return res.status(200).json({ received: true, warning: 'no email found' });
  }

  const packageType = PAYMENT_LINK_MAP[session.payment_link];
  if (!packageType) {
    console.log(`webhook-stripe: unknown payment_link ${session.payment_link}`);
    try {
      await resend.emails.send({
        from:    'kontakt@kompasrozwodowy.eu',
        to:      'kontakt@kompasrozwodowy.eu',
        subject: '[NarcFilter] Nieznany payment_link w webhooku Stripe',
        text: [
          `Session ID: ${session.id}`,
          `Payment Link: ${session.payment_link}`,
          `Email klienta: ${email}`,
          '',
          'Klient zapłacił, ale payment_link nie jest w PAYMENT_LINK_MAP.',
          'Sprawdź czy to nowy pakiet (np. addon) — dodaj do mapy lub manualnie wystaw klucz.',
        ].join('\n'),
      });
    } catch (alertErr) {
      console.error('webhook-stripe: failed to send unknown-link alert:', alertErr);
    }
    return res.status(200).json({ received: true, warning: 'unknown payment_link' });
  }

  let reserved;
  try {
    reserved = await withTimeout(
      redis.set(`session:${session.id}`, 1, { nx: true, ex: 30 * 86_400 }),
      5000, 'reserve session'
    );
  } catch (redisErr) {
    console.error('webhook-stripe: redis SET NX failed:', redisErr);
    return res.status(500).json({ error: 'Storage unavailable, please retry' });
  }
  if (reserved !== 'OK') {
    console.log(`webhook-stripe: duplicate event ${session.id}, skipping`);
    return res.status(200).json({ received: true });
  }

  try {
    const queriesCount = PACKAGES[packageType].queriesRemaining;
    const topped = await topUpKey({ queriesCount, customerEmail: email });
    if (topped) {
      console.log(`webhook-stripe: key topped up +${queriesCount} (${packageType}), session ${session.id}`);
      return res.status(200).json({ received: true });
    }
    await createAndDeliverKey({ packageType, customerEmail: email });
    console.log(`webhook-stripe: new key created (${packageType}), session ${session.id}`);
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('webhook-stripe: delivery failed:', err?.message, err?.stack);

    const msg = String(err?.message ?? '');
    const isStorageError =
      /timeout|Redis|ECONN|ENOTFOUND|fetch failed|UpstashError|save key|topup/i.test(msg);

    if (isStorageError) {
      try {
        await withTimeout(redis.del(`session:${session.id}`), 3000, 'release session');
      } catch (relErr) {
        console.error('webhook-stripe: failed to release session reservation:', relErr);
      }
      return res.status(500).json({ error: 'Storage error, please retry' });
    }

    try {
      await resend.emails.send({
        from:    'kontakt@kompasrozwodowy.eu',
        to:      'kontakt@kompasrozwodowy.eu',
        subject: '[NarcFilter ALERT] Błąd dostawy klucza — wymagany manualny follow-up',
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
    return res.status(200).json({ received: true, error: 'Delivery failed (manual follow-up needed)' });
  }
}
