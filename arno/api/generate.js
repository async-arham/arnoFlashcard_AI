// Vercel serverless function — runs server-side, so the API key never
// reaches the browser. Deployed automatically when you push this repo to
// Vercel (any file under /api becomes a serverless endpoint at /api/<name>).

// ⚠️ Set OPENROUTER_API_KEY as an Environment Variable in your Vercel project
// settings (Project → Settings → Environment Variables) instead of hardcoding
// it here. The fallback below only exists so local testing still works if
// you forget — replace/remove it once you've set the real env var.
const API_KEY = process.env.OPENROUTER_API_KEY || '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';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'nvidia/nemotron-nano-12b-v2-vl:free';

export const config = {
  maxDuration: 60, // allow the function up to 60s (set in vercel.json too, for Hobby/Pro compatibility)
};

export default async function handler(req, res) {
  // CORS — harmless to leave open since the key never leaves the server,
  // and this lets you test the deployed function from anywhere.
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

  // Vercel parses JSON bodies automatically for Node serverless functions,
  // but guard against an empty/malformed body anyway.
  const body = req.body || {};
  const messages = body.messages;
  const max_tokens = body.max_tokens ?? 1500;
  const temperature = body.temperature ?? 0.5;
  const requestedTimeoutMs = Math.min(Math.max(body.timeout_ms ?? 25000, 5000), 55000);

  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: { message: 'Missing "messages" in request body.' } });
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestedTimeoutMs);

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': req.headers.origin || 'https://vercel.app',
        'X-Title': 'StudyDeck'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens,
        temperature,
        stream: false // force a single JSON response instead of SSE chunks
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    // Read as text first so we can recover from non-JSON / SSE-formatted
    // replies instead of crashing on res.json().
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // Fallback: looks like SSE ("data: {...}\n\ndata: {...}"). Stitch the
      // streamed text deltas back into one chat-completion-shaped object.
      const pieces = raw
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(line => line && line !== '[DONE]');

      let combined = '';
      for (const piece of pieces) {
        try {
          const chunk = JSON.parse(piece);
          combined += chunk?.choices?.[0]?.delta?.content || '';
        } catch {
          // ignore unparsable fragments
        }
      }

      if (!combined) {
        console.error('Raw response from API:', raw.slice(0, 500));
        res.status(502).json({ error: { message: 'Upstream API returned an unexpected format.' } });
        return;
      }
      data = { choices: [{ message: { content: combined } }] };
    }

    const contentPreview = data?.choices?.[0]?.message?.content;
    if (contentPreview) {
      console.log(`Model responded with ${contentPreview.length} characters.`);
    } else if (data?.error) {
      console.error('Upstream API error:', data.error);
    }

    res.status(response.status).json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      res.status(504).json({ error: { message: 'Upstream request timed out.', code: 'TIMEOUT' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { message: err.message } });
  }
}
