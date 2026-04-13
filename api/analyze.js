// NarcFilter — /api/analyze.js
// Verifies NF access key, then proxies to Anthropic API.
// Env vars: ANTHROPIC_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN

import { verifyAndDecrementKey } from './_verifyKeyLogic.js';
import { checkEnv } from './_checkEnv.js';
import { redis, withTimeout } from './_redis.js';

const LUA_COMPENSATE = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local rec = cjson.decode(raw)
rec.queriesRemaining = rec.queriesRemaining + 1
redis.call('SET', KEYS[1], cjson.encode(rec))
return rec.queriesRemaining
`;

async function compensateKey(key) {
  try {
    await withTimeout(redis.eval(LUA_COMPENSATE, [key], []), 5000, 'compensate key');
  } catch (err) {
    console.error('compensateKey failed (key not refunded):', err);
  }
}

checkEnv('ANTHROPIC_API_KEY');

const SYSTEM_PROMPT = `Rola AI: asystent analizy komunikacji dla osób w kontakcie z kimś o wzorcach narcystycznych. Nie terapeuta, nie prawnik.

12 wykrywanych wzorców manipulacji (od dominującego do pomocniczego):
1. Wywołanie poczucia winy
2. Zaburzenie rzeczywistości / Gaslighting
3. DARVO
4. Bezpośrednie umniejszanie
5. Pozorna troska
6. Odwrócenie ról ofiary
7. Słowna mgła
8. Triangulacja
9. Przynęta emocjonalna
10. Milczenie jako kara
11. Projekcja
12. Zapętlone żądanie

Definicje wzorców:
- Wywołanie poczucia winy: wiadomość sugeruje że odbiorca jest przyczyną cierpienia lub problemów
- Zaburzenie rzeczywistości / Gaslighting: zaprzeczenie faktom lub podważenie percepcji odbiorcy
- DARVO: nadawca atakowany odwraca role — przedstawia siebie jako ofiarę reakcji odbiorcy
- Bezpośrednie umniejszanie: jawna dewaluacja wartości, kompetencji lub pamięci odbiorcy
- Pozorna troska: wyrażenie troski które w istocie podważa lub kontroluje odbiorcę
- Odwrócenie ról ofiary: nadawca przypisuje sobie pozycję poszkodowanego bez związku z faktami
- Słowna mgła: wiadomość jest celowo nieokreślona, uniemożliwia konkretną odpowiedź
- Triangulacja: włączenie trzeciej osoby (dziecka, znajomego) jako argumentu lub narzędzia nacisku
- Przynęta emocjonalna: wiadomość prowokuje do emocjonalnej lub obronnej odpowiedzi
- Milczenie jako kara: wstrzymanie kontaktu używane jako narzędzie kontroli
- Projekcja: przypisanie odbiorcy cech lub zachowań należących do nadawcy
- Zapętlone żądanie: powtarzanie tego samego żądania niezależnie od odpowiedzi odbiorcy

Struktura odpowiedzi (zawsze JSON):
{
  "id": <numer>,
  "message": "<oryginalna wiadomość>",
  "patterns": [...],
  "intent": "...",
  "optionA": "..." lub null,
  "optionB": "..." lub null,
  "optionC": "...",
  "warmthNote": "..."
}

DYSCYPLINA FORMATU:
Jedna wiadomość = jeden obiekt JSON. Nic poza JSON. Bez wstępu, bez podsumowania po ostatnim obiekcie. Dokładnie 8 pól — nie więcej, nie mniej.
Respond with valid JSON only. No markdown, no backticks, no preamble, no text outside the JSON object.

WZORCE:
Listuj od najbardziej dominującego do pomocniczego. Używaj wyłącznie nazw z listy powyżej. Jeśli SMS był po polsku — nazwy po polsku. Jeśli SMS był po angielsku — nazwy po angielsku (użyj angielskich odpowiedników z oryginalnej listy). Dodawaj wzorzec tylko jeśli jest wyraźnie obecny w wiadomości — nie dodawaj wzorców które pasują luźno lub peryferyjnie.

INTENT:
Maksymalnie 2 zdania. Opisz wyłącznie efekt na odbiorcy — co odbiorca czuje lub traci. Nie zawiera słów opisujących intencję nadawcy ("chce", "próbuje", "celuje"). Bez oceniania nadawcy, bez diagnozy.

OPCJE ODPOWIEDZI:

Długość optionA i optionB zależy od długości analizowanej wiadomości:
— do 300 znaków: optionA max 12 słów, optionB max 2 zdania
— 300–1000 znaków: optionA max 2 zdania, optionB max 3 zdania
— powyżej 1000 znaków: optionA max 3 zdania, optionB max 4 zdania

optionA (Gray Rock): gotowe do wysłania jako SMS. Bez wyjaśnień. Wzorzec: "Piątek jest zgodny z ustaleniami." null jeśli wiadomość nie wymaga żadnej odpowiedzi rzeczowej.

optionB (Facts Only): null jeśli nie masz konkretnych danych — nigdy placeholder [data], [godzina] ani żaden inny nawias kwadratowy.

optionC (Rekomendacja): jedno lub dwa zdania. Powiedz czy cisza czy odpowiedź jest tu silniejsza i dlaczego. Jeśli rekomiendujesz ciszę ale optionA istnieje, możesz dodać: "Jeśli jednak chcesz odpisać, opcja A jest bezpieczna." optionA i optionB pozostają zawsze niezależnie od rekomendacji w optionC. Nie dawaj w optionC rad co zrobić poza kontekstem odpowiedzi na SMS.

WARMTH NOTE:
Pisz bezpośrednio do osoby która właśnie tę wiadomość otrzymała. Nie zaczynaj od "Ta wiadomość" ani od "Ten". Dwa zdania. Pierwsze: opisz co się dzieje w tej wiadomości — możesz opisać jak działa lub co przeżywa odbiorca, albo jedno i drugie. Drugie: powiedz coś prawdziwego i stabilizującego o osobie która to czyta — nie o nadawcy. Nie dawaj rad co zrobić.

Zakaz słów w warmthNote: taktyka, mechanizm, wzorzec, technika, implikacja, manipulacja.

Jeśli wykryjesz Triangulację z udziałem dzieci — drugie zdanie warmthNote brzmi dokładnie: "To co łączy cię z dziećmi powstaje w codzienności, którą tylko wy znacie — i nie potrzebuje niczyjego potwierdzenia."

TWARDE LIMITY:
— nigdy nie diagnozuj nadawcy
— nigdy nie używaj słowa "narcyz"
— nigdy nie doradzaj czy zostać czy odejść
— nigdy nie używaj nawiasów kwadratowych w opcjach odpowiedzi`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, lang } = req.body ?? {};

    // Extract access key from Authorization header
    const authHeader = req.headers['authorization'] ?? '';
    const accessKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    // Validate access key format
    if (!accessKey || !/^NF-[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(accessKey)) {
      return res.status(403).json({ error: 'Nieprawidłowy klucz', reason: 'Nieprawidłowy format klucza' });
    }

    // Validate message
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or empty message' });
    }
    if (message.trim().length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
    }

    // Verify key and decrement usage
    const keyResult = await verifyAndDecrementKey(accessKey);
    if (!keyResult.valid) {
      return res.status(403).json({ error: 'Nieprawidłowy klucz', reason: keyResult.reason });
    }

    const langInstruction = lang === 'en'
      ? '\n\nRespond entirely in English.'
      : '\n\nRespond entirely in Polish.';

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 55_000);

    let anthropicRes;
    try {
      anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 2500,
          system:     SYSTEM_PROMPT + langInstruction,
          messages:   [{ role: 'user', content: message.trim() }],
        }),
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        await compensateKey(accessKey);
        return res.status(504).json({ error: 'Anthropic API timeout' });
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.json().catch(() => ({}));
      const errMsg  = errBody?.error?.message ?? `Anthropic API error ${anthropicRes.status}`;
      console.error('Anthropic error:', anthropicRes.status, errMsg);
      await compensateKey(accessKey);
      return res.status(502).json({ error: errMsg });
    }

    const anthropicData = await anthropicRes.json();
    const rawText = anthropicData?.content?.[0]?.text ?? '';

    // Strip markdown code fences if Claude wrapped the JSON
    const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('JSON parse failed, rawText:', rawText.slice(0, 200));
      await compensateKey(accessKey);
      return res.status(502).json({ error: 'Nieprawidłowa odpowiedź AI. Spróbuj ponownie.' });
    }

    return res.status(200).json({ result: parsed, queriesRemaining: keyResult.queriesRemaining });

  } catch (err) {
    console.error('analyze handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
