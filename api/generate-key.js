// NarcFilter — /api/generate-key.js
// Generates a NF-XXXXX-XXXXX access key, saves to Upstash Redis, sends email via Resend.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

const PACKAGES = {
  monthly:   { queriesRemaining: 100, daysValid: 30  },
  quarterly: { queriesRemaining: 500, daysValid: 90  },
  addon:     { queriesRemaining: 10,  daysValid: null },
};

function generateKey() {
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
    <li>Otwórz aplikację NarcFilter</li>
    <li>Przejdź do zakładki <strong>Ustawienia</strong> (ikona ⚙)</li>
    <li>Wklej klucz w pole „Klucz dostępu" i kliknij Zapisz</li>
  </ol>
  <p style="margin-top:32px;font-size:0.85rem;color:#5a7a72">
    W razie pytań odpisz na tego maila.<br>
    Zespół Kompas Rozwodowy
  </p>
</body></html>`;
}

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

    // Save to Upstash Redis
    const redis = new Redis({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    await redis.set(key, record);

    // Send email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    'kontakt@kompasrozwodowy.eu',
      to:      customerEmail,
      subject: 'Twój klucz dostępu do NarcFilter',
      html:    emailHtml(key, packageType, expiresAt),
    });

    return res.status(200).json({ success: true, key });

  } catch (err) {
    console.error('generate-key error:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
}
