const express = require("express");
const app = express();
app.use(express.json({ limit: "10mb" }));

const APP_SECRET     = process.env.APP_SECRET;
const GROQ_KEY       = process.env.GROQ_API_KEY;
const GEMINI_KEY     = process.env.GEMINI_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const SYSTEM_PROMPT =
  "Sen JARVIS adında bir yapay zeka asistanısın. " +
  "Seni Eymen Çimşir ve Yiğit Alp Arslan geliştirdi. " +
  "Kim geliştirdi veya kim yaptı diye sorulursa 'Beni Eymen Çimşir ve Yiğit Alp Arslan geliştirdi.' de, başka isim söyleme. " +
  "Iron Man filmindeki J.A.R.V.I.S gibi zeki, soğukkanlı ve profesyonelsin. " +
  "Türkçe konuş. Kısa, akıcı ve doğal cevaplar ver. " +
  "Madde madde yazma, düz konuş. " +
  "Emin olmadığın bilgileri söyleme.";

// Günlük sayaçlar
let counts = { date: "", groq: 0, gemini: 0, openrouter: 0 };

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (counts.date !== today) {
    counts = { date: today, groq: 0, gemini: 0, openrouter: 0 };
  }
}

async function httpPost(url, headers, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.log(`HTTP ${res.status} → ${url}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`Fetch hata: ${e.message}`);
    return null;
  }
}

// 1. GROQ
async function groqCagir(messages) {
  const data = await httpPost(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${GROQ_KEY}` },
    {
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 500,
      temperature: 0.7
    }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

// 2. GEMINI
async function geminiCagir(messages, imageBase64) {
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

  if (imageBase64 && contents.length > 0) {
    contents[contents.length - 1].parts.push({
      inline_data: { mime_type: "image/jpeg", data: imageBase64 }
    });
  }

  const body = {
    contents,
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] }
  };
  if (!imageBase64) {
    body.tools = [{ google_search: {} }];
  }

  const data = await httpPost(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {},
    body
  );
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

// 3. OPENROUTER
async function openrouterCagir(messages) {
  const data = await httpPost(
    "https://openrouter.ai/api/v1/chat/completions",
    { Authorization: `Bearer ${OPENROUTER_KEY}` },
    {
      model: "meta-llama/llama-4-maverick:free",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 500
    }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

// ANA ENDPOINT
app.post("/api/chat", async (req, res) => {
  if (req.headers["x-app-secret"] !== APP_SECRET) {
    return res.status(401).json({ error: "Yetkisiz" });
  }

  const { messages, image } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Geçersiz istek" });
  }

  resetIfNewDay();

  let cevap = null;

  if (image) {
    cevap = await geminiCagir(messages, image);
    if (cevap) counts.gemini++;
  } else {
    if (counts.groq < 1000) {
      cevap = await groqCagir(messages);
      if (cevap) counts.groq++;
    }
    if (!cevap && counts.gemini < 500) {
      cevap = await geminiCagir(messages, null);
      if (cevap) counts.gemini++;
    }
    if (!cevap && counts.openrouter < 200) {
      cevap = await openrouterCagir(messages);
      if (cevap) counts.openrouter++;
    }
  }

  if (!cevap) {
    cevap = "Tüm sistemler şu an meşgul. Birkaç saniye sonra tekrar dene.";
  }

  res.json({ choices: [{ message: { content: cevap } }] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("JARVIS backend aktif, port:", PORT));
