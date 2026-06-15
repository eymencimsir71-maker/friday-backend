// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// API Key'ler - Render Environment Variables'dan okunur
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

// Sırayla denenecek sağlayıcılar - liste sırası = öncelik sırası
const providers = [
  {
    name: 'gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    apiKey: GEMINI_API_KEY,
    model: 'gemini-2.0-flash'
  },
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile'
  },
  {
    name: 'mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    apiKey: MISTRAL_API_KEY,
    model: 'mistral-large-latest'
  },
  {
    name: 'cerebras',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    apiKey: CEREBRAS_API_KEY,
    model: 'llama-3.3-70b'
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: OPENROUTER_API_KEY,
    model: 'meta-llama/llama-3.2-3b-instruct:free'
  }
];

async function callProvider(provider, messages) {
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: messages
    })
  });

  if (!response.ok) {
    throw new Error(`${provider.name} hata kodu: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Ana endpoint - APK buraya istek atacak
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages alanı gerekli' });

  let lastError = null;

  for (const provider of providers) {
    if (!provider.apiKey) continue; // key tanımlı değilse atla

    try {
      const reply = await callProvider(provider, messages);
      return res.json({ reply, source: provider.name });
    } catch (err) {
      console.log(`${provider.name} başarısız: ${err.message} → sıradakine geçiliyor`);
      lastError = err;
      continue;
    }
  }

  res.status(503).json({ error: 'Tüm AI sağlayıcıları şu anda kullanılamıyor', detail: lastError?.message });
});

app.get('/', (req, res) => {
  res.send('Server çalışıyor ✅');
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
