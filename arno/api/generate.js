// Vercel serverless function — runs server-side, so the API key never
// reaches the browser. Lives at /api/generate.js → endpoint: /api/generate
//
// Set GROQ_API_KEY as an Environment Variable in your Vercel project
// (Project → Settings → Environment Variables), then redeploy.
// Get a free key at https://console.groq.com
const API_KEY = process.env.GROQ_API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Set GROQ_MODEL in Vercel env vars to change models without editing code.
// Use a plain text instruct model (not vision / reasoning) for flashcards.
// List models your key can use: https://api.groq.com/openai/v1/models
const MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

export const config = {
  maxDuration: 60,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  if (!API_KEY) {
    console.error('GROQ_API_KEY is not set in the environment.');
    res.status(500).json({
      error: { message: 'Server is missing GROQ_API_KEY. Set it in Vercel → Project → Settings → Environment Variables, then redeploy.' }
    });
    return;
  }

  const body = req.body || {};
  const messages = body.messages;
  const max_tokens = body.max_tokens ?? 1500;
  const temperature = body.temperature ?? 0.5;
  const totalBudgetMs = Math.min(Math.max(body.timeout_ms ?? 25000, 5000), 55000);

  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: { message: 'Missing "messages" in request body.' } });
    return;
  }

  const deadline = Date.now() + totalBudgetMs;
  const MAX_ATTEMPTS = 2; // one automatic retry on 429 / 5xx

  try {
    let response;
    let data;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 2000) break;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), remaining);

      try {
        response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            max_tokens,
            temperature,
            stream: false
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const raw = await response.text();
      try {
        data = JSON.parse(raw);
      } catch {
        console.error('Non-JSON response from API:', raw.slice(0, 500));
        data = null;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (response.ok && data) break;
      if (!retryable || attempt === MAX_ATTEMPTS) break;

      // Honor Retry-After if present (seconds), otherwise short backoff.
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Math.min(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500,
        Math.max(deadline - Date.now() - 3000, 0)
      );
      if (waitMs <= 0) break;
      console.warn(`Upstream ${response.status}, retrying in ${waitMs}ms...`);
      await sleep(waitMs);
    }

    if (!response) {
      res.status(504).json({ error: { message: 'Upstream request timed out.', code: 'TIMEOUT' } });
      return;
    }

    if (!response.ok) {
      console.error('Upstream error', response.status, data?.error);
      // 502 (not the upstream status) so a provider-side 404 can't be
      // mistaken for a missing /api/generate route.
      res.status(response.status === 429 ? 429 : 502).json({
        error: {
          message: `Model provider error (${response.status}): ${data?.error?.message || 'unknown'}`,
          code: response.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR'
        }
      });
      return;
    }

    if (!data) {
      res.status(502).json({ error: { message: 'Upstream API returned an unexpected format.' } });
      return;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (content) {
      console.log(`Model responded with ${content.length} characters.`);
    }

    res.status(200).json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: { message: 'Upstream request timed out.', code: 'TIMEOUT' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { message: err.message } });
  }
}
