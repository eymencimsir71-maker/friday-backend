const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-app-secret');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const textProviders = [
  { name: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: GEMINI_API_KEY, model: 'gemini-2.0-flash' },
  { name: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: GROQ_API_KEY, model: 'llama-3.3-70b-versatile' },
  { name: 'mistral', url: 'https://api.mistral.ai/v1/chat/completions', apiKey: MISTRAL_API_KEY, model: 'mistral-large-latest' },
  { name: 'cerebras', url: 'https://api.cerebras.ai/v1/chat/completions', apiKey: CEREBRAS_API_KEY, model: 'llama-3.3-70b' },
  { name: 'openrouter', url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: OPENROUTER_API_KEY, model: 'meta-llama/llama-3.2-3b-instruct:free' }
];

const visionProvider = { name: 'gemini-vision', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: GEMINI_API_KEY, model: 'gemini-2.0-flash' };

// ── Tavily web arama ──────────────────────────────────────────────
async function tavilySearch(query) {
  if (!TAVILY_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        include_answer: true,
        max_results: 4
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Tavily ${response.status}`);

    const data = await response.json();
    let context = '';
    if (data.answer) context += `Özet: ${data.answer}\n\n`;
    if (Array.isArray(data.results)) {
      data.results.slice(0, 4).forEach((r, i) => {
        context += `[${i + 1}] ${r.title}: ${r.content?.slice(0, 300)}\n`;
      });
    }
    return context.trim() || null;
  } catch (err) {
    clearTimeout(timeout);
    console.error('Tavily hata:', err.message);
    return null;
  }
}

// Bir kelimenin/cümlenin gerçek zamanlı bilgi gerektirip gerektirmediğini kabaca tahmin et
function aramaGerekliMi(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const tetikleyiciler = [
    'bugün', 'dün', 'yarın', 'şu an', 'güncel', 'son', 'haber', 'maç', 'skor',
    'sonuç', 'fiyat', 'kur', 'hava durumu', 'kim', 'ne zaman', 'kaç',
    'today', 'latest', 'news', 'score', 'price', 'weather', 'current'
  ];
  return tetikleyiciler.some(k => t.includes(k));
}

async function callChatAPI(provider, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

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

function buildVisionMessages(messages, imageBase64) {
  const msgs = JSON.parse(JSON.stringify(messages));
  const lastIdx = msgs.length - 1;
  if (msgs[lastIdx] && msgs[lastIdx].role === 'user') {
    const textContent = msgs[lastIdx].content;
    msgs[lastIdx] = {
      role: 'user',
      content: [
        { type: 'text', text: textContent },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ]
    };
  }
  return msgs;
}

app.post('/', async (req, res) => {
  const { messages, image } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages alanı (array) gerekli' });
  }

  // Görsel varsa - Gemini vision
  if (image) {
    try {
      const visionMsgs = buildVisionMessages(messages, image);
      const reply = await callChatAPI(visionProvider, visionMsgs);
      return res.json({ choices: [{ message: { content: reply } }] });
    } catch (err) {
      console.error('Vision hatası:', err.message);
      return res.json({ choices: [{ message: { content: 'Görsel şu anda analiz edilemiyor.' } }] });
    }
  }

  // Son kullanıcı mesajını bul
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const soru = lastUserMsg ? lastUserMsg.content : '';

  // Gerekirse web araması yap
  let finalMessages = messages;
  if (aramaGerekliMi(soru)) {
    const context = await tavilySearch(soru);
    if (context) {
      const searchMsg = {
        role: 'system',
        content: `Aşağıda bu soruyla ilgili güncel web arama sonuçları var. Bu bilgiyi kullanarak cevap ver:\n\n${context}`
      };
      // Sistem mesajından sonra, son kullanıcı mesajından önce ekle
      finalMessages = [...messages];
      finalMessages.splice(finalMessages.length - 1, 0, searchMsg);
    }
  }

  const errors = [];
  for (const provider of textProviders) {
    if (!provider.apiKey) {
      errors.push(`${provider.name}: API key tanımlı değil`);
      continue;
    }
    try {
      const reply = await callChatAPI(provider, finalMessages);
      return res.json({ choices: [{ message: { content: reply } }] });
    } catch (err) {
      console.error(`${provider.name} başarısız:`, err.message);
      errors.push(`${provider.name}: ${err.message}`);
    }
  }

  res.status(503).json({ error: 'Tüm AI sağlayıcıları başarısız oldu', details: errors });
});

app.get('/health', (req, res) => {
  res.json({
    gemini: !!GEMINI_API_KEY,
    groq: !!GROQ_API_KEY,
    mistral: !!MISTRAL_API_KEY,
    cerebras: !!CEREBRAS_API_KEY,
    openrouter: !!OPENROUTER_API_KEY,
    tavily: !!TAVILY_API_KEY
  });
});

app.use((err, req, res, next) => {
  console.error('Beklenmeyen hata:', err);
  res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor ✅`);
});
