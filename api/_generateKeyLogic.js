// Shared key generation logic.
// Used by /api/generate-key and /api/webhook-naffy.

import { Resend } from 'resend';
import { checkEnv } from './_checkEnv.js';
import { redis, withTimeout } from './_redis.js';

checkEnv('RESEND_API_KEY');

const resend = new Resend(process.env.RESEND_API_KEY);

export const PACKAGES = {
  starter:   { queriesRemaining: 10,  daysValid: null },
  standard:  { queriesRemaining: 100, daysValid: null },
  pro:       { queriesRemaining: 500, daysValid: null },
  addon:     { queriesRemaining: 10,  daysValid: null },
};

export function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => chars[b % chars.length]).join('');
  return `NF-${seg()}-${seg()}`;
}

function emailHtml(key, packageType, expiresAt) {
  const packageLabels = { starter: 'Starter (10 analiz)', standard: 'Standard (100 analiz)', pro: 'Pro (500 analiz)', addon: 'Doładowanie (10 analiz)' };
  const expiryLine = expiresAt
    ? `<p>Ważny do: <strong>${new Date(expiresAt).toLocaleDateString('pl-PL')}</strong></p>`
    : `<p>Ważność: <strong>bezterminowo</strong></p>`;

  return `<!DOCTYPE html><html lang="pl"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2e28">
  <h1 style="color:#2D7A6B">Twój klucz dostępu do NarcFilter</h1>
  <p>Dziękujemy za zakup pakietu <strong>${packageLabels[packageType]}</strong>.</p>
  <p>Twój klucz dostępu:</p>
  <div style="background:#F4EFE6;border:2px solid #2D7A6B;border-radius:10px;padding:18px 24px;text-align:center;margin:20px 0">
    <span style="font-size:1.5rem;font-weight:700;letter-spacing:0.1em;color:#2D7A6B">${key}</span>
  </div>
  ${expiryLine}
  <h2 style="color:#2D7A6B;font-size:1rem">Jak wpisać klucz?</h2>
  <ol style="line-height:1.8">
    <li>Wejdź na <a href="https://narcfilter.vercel.app" style="color:#2D7A6B">narcfilter.vercel.app</a></li>
    <li>Kliknij ikonę <strong>Ustawienia ⚙</strong> w prawym górnym rogu</li>
    <li>Wklej klucz w pole „Klucz dostępu" i kliknij <strong>Zapisz ustawienia</strong></li>
  </ol>
  <p style="margin-top:32px;font-size:0.85rem;color:#5a7a72">
    W razie pytań odpisz na tego maila.<br>
    Zespół Kompas Rozwodowy
  </p>
</body></html>`;
}

/**
 * Checks if a Stripe session was already processed (idempotency guard).
 */
export async function isSessionProcessed(sessionId) {
  return (await withTimeout(redis.get(`session:${sessionId}`), 5000, 'isSessionProcessed')) !== null;
}

/**
 * Marks a Stripe session as processed. TTL: 7 days.
 */
export async function markSessionProcessed(sessionId) {
  await withTimeout(redis.set(`session:${sessionId}`, 1, { ex: 7 * 86_400 }), 5000, 'markSessionProcessed');
}

/**
 * Generates a key, saves it to Redis, and sends an email.
 * @returns {Promise<{ key: string }>}
 */
export async function createAndDeliverKey({ packageType, customerEmail }) {
  const pkg = PACKAGES[packageType];
  const now = new Date();
  const expiresAt = pkg.daysValid
    ? new Date(now.getTime() + pkg.daysValid * 86_400_000).toISOString()
    : null;

  const key = generateKey();
  const record = {
    packageType,
    queriesRemaining: pkg.queriesRemaining,
    expiresAt,
    email: customerEmail,
    createdAt: now.toISOString(),
  };

  await withTimeout(
    redis.pipeline()
      .set(key, record)
      // Reverse index: allows looking up key by email (used by /api/aktywacja-check)
      .set(`email:${customerEmail.toLowerCase()}`, key)
      .exec(),
    5000, 'save key'
  );

  await resend.emails.send({
    from:    'kontakt@kompasrozwodowy.eu',
    to:      customerEmail,
    subject: 'Twój klucz dostępu do NarcFilter',
    html:    emailHtml(key, packageType, expiresAt),
  });

  return { key };
}
