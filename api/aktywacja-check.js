// NarcFilter — /api/aktywacja-check.js
// Looks up an existing key by email and resends it. Never generates a new key.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import { Resend } from 'resend';
import { checkEnv } from './_checkEnv.js';
import { redis, withTimeout } from './_redis.js';

checkEnv('RESEND_API_KEY');

const resend = new Resend(process.env.RESEND_API_KEY);

function emailHtml(key) {
  const keyBox = `
  <div style="background:#F4EFE6;border:2px solid #2D7A6B;border-radius:10px;padding:18px 24px;text-align:center;margin:20px 0">
    <span style="font-size:1.5rem;font-weight:700;letter-spacing:0.1em;color:#2D7A6B">${key}</span>
  </div>`;

  return `<!DOCTYPE html><html lang="pl"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2e28">
  <h1 style="color:#2D7A6B">Twój klucz dostępu do NarcFilter</h1>
  <p>Oto Twój klucz dostępu (na Twoją prośbę):</p>
  ${keyBox}
  <h2 style="color:#2D7A6B;font-size:1rem">Jak wpisać klucz?</h2>
  <ol style="line-height:1.8">
    <li>Wejdź na <a href="https://narcfilter.kompasrozwodowy.eu" style="color:#2D7A6B">narcfilter.kompasrozwodowy.eu</a></li>
    <li>Kliknij ikonę <strong>Ustawienia ⚙</strong> w prawym górnym rogu</li>
    <li>Wklej klucz w pole „Klucz dostępu" i kliknij <strong>Zapisz ustawienia</strong></li>
  </ol>
  <p style="margin-top:24px;font-size:0.85rem;color:#5a7a72">
    W razie pytań odpisz na tego maila.<br>
    Zespół Kompas Rozwodowy
  </p>

  <hr style="border:none;border-top:1px solid #d8d0c0;margin:36px 0">

  <h1 style="color:#2D7A6B">Your NarcFilter Access Key</h1>
  <p>Here is your access key (as requested):</p>
  ${keyBox}
  <h2 style="color:#2D7A6B;font-size:1rem">How to enter the key</h2>
  <ol style="line-height:1.8">
    <li>Go to <a href="https://narcfilter.kompasrozwodowy.eu" style="color:#2D7A6B">narcfilter.kompasrozwodowy.eu</a></li>
    <li>Click the <strong>Settings ⚙</strong> icon in the top right corner</li>
    <li>Paste your key in the "Access key" field and click <strong>Save settings</strong></li>
  </ol>
  <p style="margin-top:24px;font-size:0.85rem;color:#5a7a72">
    If you have any questions, just reply to this email.<br>
    The Kompas Rozwodowy (Divorce Compass) Team
  </p>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { email } = req.body ?? {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Podaj prawidłowy adres email.' });
    }

    const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
return count
`;

    const emailRateKey = `rate:aktywacja:email:${email.toLowerCase()}`;
    const emailCount = await withTimeout(
      redis.eval(RATE_LIMIT_SCRIPT, [emailRateKey], []),
      5000, 'email rate limit'
    );
    if (emailCount > 3) {
      return res.status(429).json({
        success: false,
        error: 'Przekroczono limit prób. Spróbuj za godzinę. / Rate limit exceeded. Try again in an hour.',
      });
    }

    const forwardedFor = req.headers['x-forwarded-for'] ?? '';
    const ip = String(forwardedFor).split(',')[0].trim() || 'unknown';
    const ipRateKey = `rate:aktywacja:ip:${ip}`;
    const ipCount = await withTimeout(
      redis.eval(RATE_LIMIT_SCRIPT, [ipRateKey], []),
      5000, 'ip rate limit'
    );
    if (ipCount > 30) {
      return res.status(429).json({
        success: false,
        error: 'Przekroczono limit prób. Spróbuj za godzinę. / Rate limit exceeded. Try again in an hour.',
      });
    }

    const key = await withTimeout(redis.get(`email:${email.toLowerCase()}`), 5000, 'get key by email');

    if (!key) {
      return res.status(200).json({ success: true });
    }

    await resend.emails.send({
      from:    'kontakt@kompasrozwodowy.eu',
      to:      email,
      subject: 'Twój klucz dostępu NarcFilter / Your NarcFilter Access Key (resend)',
      html:    emailHtml(key),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('aktywacja-check error:', err);
    return res.status(500).json({ success: false, error: 'Błąd serwera. Spróbuj ponownie.' });
  }
}
