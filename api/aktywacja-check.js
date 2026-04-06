// NarcFilter — /api/aktywacja-check.js
// Looks up an existing key by email and resends it. Never generates a new key.
// Env vars required: KV_REST_API_URL, KV_REST_API_TOKEN, RESEND_API_KEY

import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

function emailHtml(key) {
  return `<!DOCTYPE html><html lang="pl"><body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a2e28">
  <h1 style="color:#2D7A6B">Twój klucz dostępu do NarcFilter</h1>
  <p>Oto Twój klucz dostępu (na Twoją prośbę):</p>
  <div style="background:#F4EFE6;border:2px solid #2D7A6B;border-radius:10px;padding:18px 24px;text-align:center;margin:20px 0">
    <span style="font-size:1.5rem;font-weight:700;letter-spacing:0.1em;color:#2D7A6B">${key}</span>
  </div>
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { email } = req.body ?? {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Podaj prawidłowy adres email.' });
    }

    const redis = new Redis({
      url:   process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const key = await redis.get(`email:${email.toLowerCase()}`);

    if (!key) {
      return res.status(404).json({
        success: false,
        error: 'Nie znaleziono zakupu dla tego adresu email. Jeśli właśnie kupiłeś/aś, poczekaj chwilę i spróbuj ponownie.',
      });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    'kontakt@kompasrozwodowy.eu',
      to:      email,
      subject: 'Twój klucz dostępu NarcFilter (ponowne wysłanie)',
      html:    emailHtml(key),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('aktywacja-check error:', err);
    return res.status(500).json({ success: false, error: 'Błąd serwera. Spróbuj ponownie.' });
  }
}
