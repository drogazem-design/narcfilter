// Shared key generation logic.
// Used by /api/generate-key and /api/webhook-naffy.

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

export const PACKAGES = {
  monthly:   { queriesRemaining: 100, daysValid: 30  },
  quarterly: { queriesRemaining: 500, daysValid: 90  },
  addon:     { queriesRemaining: 10,  daysValid: null },
};

export function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = () => Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `NF-${seg()}-${seg()}`;
}

function emailHtml(key, packageType, expiresAt) {
  const packageLabels = { monthly: 'Miesięczny (100 analiz)', quarterly: 'Kwartalny (500 analiz)', addon: 'Doładowanie (10 analiz)' };
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

  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });
  await redis.set(key, record);
  // Reverse index: allows looking up key by email (used by /api/aktywacja-check)
  await redis.set(`email:${customerEmail.toLowerCase()}`, key);

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from:    'kontakt@kompasrozwodowy.eu',
    to:      customerEmail,
    subject: 'Twój klucz dostępu do NarcFilter',
    html:    emailHtml(key, packageType, expiresAt),
  });

  return { key };
}
