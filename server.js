const express = require('express');

const app = express();
app.use(express.json());

// CORS - ekstra paket gerekmeden
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const providers = [
  { name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: GEMINI_API_KEY, model: 'gemini-2.0-flash' },
  { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: GROQ_API_KEY, model: 'llama-3.3-70b-versatile' },
  { name: 'mistral', url: 'https://api.mistral.ai/v1/chat/completions', apiKey: MISTRAL_API_KEY, model: 'mistral-large-latest' },
  { name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', apiKey: CEREBRAS_API_KEY, model: 'llama-3.3-70b' },
  { name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: OPENROUTER_API_KEY, model: 'meta-llama/llama-3.2-3b-instruct:free' }
];

async function callProvider(provider, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({ model: provider.model, messages }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${provider.name} ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error(`${provider.name}: boş yanıt döndü`);
    return reply;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Ana endpoint - APK buraya istek atacak
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages alanı (array) gerekli' });
  }

  const errors = [];

  for (const provider of providers) {
    if (!provider.apiKey) {
      errors.push(`${provider.name}: API key tanımlı değil`);
      continue;
    }

    try {
      const reply = await callProvider(provider, messages);
      return res.json({ reply, source: provider.name });
    } catch (err) {
      console.error(`${provider.name} başarısız:`, err.message);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  res.status(503).json({ error: 'Tüm AI sağlayıcıları başarısız oldu', details: errors });
});

// Hangi key'lerin tanımlı olduğunu kontrol etmek için
app.get('/health', (req, res) => {
  res.json({
    gemini: !!GEMINI_API_KEY,
    groq: !!GROQ_API_KEY,
    mistral: !!MISTRAL_API_KEY,
    cerebras: !!CEREBRAS_API_KEY,
    openrouter: !!OPENROUTER_API_KEY
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Server çalışıyor ✅' });
});

app.use((err, req, res, next) => {
  console.error('Beklenmeyen hata:', err);
  res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor ✅`);
});
