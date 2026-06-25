const express = require("express");
const app = express();
app.use(express.json({ limit: "10mb" }));

const APP_SECRET      = process.env.APP_SECRET;
const GROQ_KEY        = process.env.GROQ_API_KEY;
const GEMINI_KEY      = process.env.GEMINI_API_KEY;
const OPENROUTER_KEY  = process.env.OPENROUTER_API_KEY;
const CEREBRAS_KEY    = process.env.CEREBRAS_API_KEY;
const MISTRAL_KEY     = process.env.MISTRAL_API_KEY;
const TAVILY_KEY      = process.env.TAVILY_API_KEY;
const FISH_AUDIO_KEY  = process.env.FISH_AUDIO_API_KEY;

const JARVIS_VOICE_ID = "13dec4f733da45d499a91816f0f3ba9b";

const SYSTEM_PROMPT =
  "Sen JARVIS adında bir yapay zeka asistanısın. " +
  "Seni Eymen Çimşir ve Yiğit Alp Arslan geliştirdi. " +
  "Kim geliştirdi veya kim yaptı diye sorulursa 'Beni Eymen Çimşir ve Yiğit Alp Arslan geliştirdi.' de, başka isim söyleme. " +
  "Iron Man filmindeki J.A.R.V.I.S gibi zeki, soğukkanlı ve profesyonelsin. " +
  "Kullanıcının dilinde konuş. Kısa, akıcı ve doğal cevaplar ver. " +
  "Madde madde yazma, düz konuş. " +
  "Emin olmadığın bilgileri söyleme.";

let counts = { date: "", groq: 0, gemini: 0, openrouter: 0, cerebras: 0, mistral: 0 };

function resetIfNewDay() {
  const today = new Date().toDateString();
  if (counts.date !== today) {
    counts = { date: today, groq: 0, gemini: 0, openrouter: 0, cerebras: 0, mistral: 0 };
  }
}

async function httpPost(url, headers, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    if (!res.ok) { console.log(`HTTP ${res.status} -> ${url}`); return null; }
    return await res.json();
  } catch (e) { console.log(`Fetch hata: ${e.message}`); return null; }
}

async function tavilyAra(soru) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: TAVILY_KEY, query: soru, search_depth: "basic", max_results: 3 })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results || data.results.length === 0) return null;
    return data.results.map(r => `${r.title}: ${r.content}`).join("\n\n");
  } catch (e) { console.log("Tavily hata:", e.message); return null; }
}

function webAramasiGerekliMi(mesaj) {
  const anahtar = [
    "hava", "weather", "bugün", "today", "şu an", "şimdi", "now",
    "son dakika", "haber", "news", "güncel", "latest", "current",
    "fiyat", "price", "dolar", "euro", "borsa", "bitcoin",
    "kim kazandı", "skor", "maç", "match", "score",
    "ne zaman", "when", "tarih", "date", "2024", "2025", "2026"
  ];
  return anahtar.some(k => mesaj.toLowerCase().includes(k));
}

async function groqCagir(messages) {
  const data = await httpPost(
    "https://api.groq.com/openai/v1/chat/completions",
    { Authorization: `Bearer ${GROQ_KEY}` },
    { model: "llama-3.3-70b-versatile", messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], max_tokens: 500, temperature: 0.7 }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

async function geminiCagir(messages, imageBase64) {
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (imageBase64 && contents.length > 0)
    contents[contents.length - 1].parts.push({ inline_data: { mime_type: "image/jpeg", data: imageBase64 } });
  const body = { contents, system_instruction: { parts: [{ text: SYSTEM_PROMPT }] } };
  if (!imageBase64) body.tools = [{ google_search: {} }];
  const data = await httpPost(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
    {}, body
  );
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function cerebrasCagir(messages) {
  const data = await httpPost(
    "https://api.cerebras.ai/v1/chat/completions",
    { Authorization: `Bearer ${CEREBRAS_KEY}` },
    { model: "llama-3.3-70b", messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], max_tokens: 500, temperature: 0.7 }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

async function mistralCagir(messages) {
  const data = await httpPost(
    "https://api.mistral.ai/v1/chat/completions",
    { Authorization: `Bearer ${MISTRAL_KEY}` },
    { model: "mistral-small-latest", messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], max_tokens: 500, temperature: 0.7 }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

async function openrouterCagir(messages) {
  const data = await httpPost(
    "https://openrouter.ai/api/v1/chat/completions",
    { Authorization: `Bearer ${OPENROUTER_KEY}` },
    { model: "meta-llama/llama-4-maverick:free", messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages], max_tokens: 500 }
  );
  return data?.choices?.[0]?.message?.content ?? null;
}

// ════════════════════════════════════════════════════════════════════════
//  ANA CHAT ENDPOINT
// ════════════════════════════════════════════════════════════════════════
app.post("/api/chat", async (req, res) => {
  if (req.headers["x-app-secret"] !== APP_SECRET)
    return res.status(401).json({ error: "Yetkisiz" });

  const { messages, image } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "Geçersiz istek" });

  resetIfNewDay();
  let cevap = null;

  if (image) {
    cevap = await geminiCagir(messages, image);
    if (cevap) counts.gemini++;
  } else {
    let webBilgisi = null;
    const sonMesaj = messages[messages.length - 1]?.content || "";
    if (TAVILY_KEY && webAramasiGerekliMi(sonMesaj))
      webBilgisi = await tavilyAra(sonMesaj);

    const mesajlar = webBilgisi
      ? [...messages.slice(0, -1), {
          role: "user",
          content: `Web'den bulunan güncel bilgi:\n${webBilgisi}\n\nKullanıcı sorusu: ${sonMesaj}`
        }]
      : messages;

    if (!cevap && counts.groq < 1000)    { cevap = await groqCagir(mesajlar);       if (cevap) counts.groq++; }
    if (!cevap && counts.gemini < 500)   { cevap = await geminiCagir(mesajlar,null); if (cevap) counts.gemini++; }
    if (!cevap && counts.cerebras < 1000){ cevap = await cerebrasCagir(mesajlar);   if (cevap) counts.cerebras++; }
    if (!cevap && counts.mistral < 500)  { cevap = await mistralCagir(mesajlar);    if (cevap) counts.mistral++; }
    if (!cevap)                          { cevap = await openrouterCagir(mesajlar); if (cevap) counts.openrouter++; }
  }

  if (!cevap) cevap = "Tüm sistemler şu an meşgul. Birkaç saniye sonra tekrar dene.";
  res.json({ choices: [{ message: { content: cevap } }] });
});

// ════════════════════════════════════════════════════════════════════════
//  TTS ENDPOINT
//  1. Fish Audio — gerçek Jarvis sesi (FISH_AUDIO_API_KEY varsa)
//  2. Edge TTS  — ücretsiz fallback
// ════════════════════════════════════════════════════════════════════════
app.post("/api/tts", async (req, res) => {
  if (req.headers["x-app-secret"] !== APP_SECRET)
    return res.status(401).json({ error: "Yetkisiz" });

  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: "Metin gerekli" });

  // ── 1. Fish Audio ────────────────────────────────────────────────────
  if (FISH_AUDIO_KEY) {
    try {
      console.log("Fish Audio deneniyor...");
      const response = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${FISH_AUDIO_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: text,
          reference_id: JARVIS_VOICE_ID,
          format: "mp3",
          mp3_bitrate: 128,
          normalize: true,
          latency: "normal"
        })
      });

      if (response.ok) {
        console.log("Fish Audio basarili!");
        const audioBuffer = await response.arrayBuffer();
        res.set("Content-Type", "audio/mpeg");
        res.set("Content-Length", audioBuffer.byteLength);
        return res.send(Buffer.from(audioBuffer));
      } else {
        console.log("Fish Audio HTTP hata:", response.status, "-> Edge TTS'e geciliyor");
      }
    } catch (e) {
      console.log("Fish Audio hata:", e.message, "-> Edge TTS'e geciliyor");
    }
  }

  // ── 2. Edge TTS Fallback ─────────────────────────────────────────────
  const sesMap = {
    "tr": "tr-TR-AhmetNeural",
    "en": "en-US-GuyNeural",
    "de": "de-DE-ConradNeural",
    "fr": "fr-FR-HenriNeural",
    "es": "es-ES-AlvaroNeural",
    "it": "it-IT-DiegoNeural",
    "pt": "pt-PT-DuarteNeural",
    "ru": "ru-RU-DmitryNeural",
    "ja": "ja-JP-KeitaNeural",
    "zh": "zh-CN-YunxiNeural",
    "ko": "ko-KR-InJoonNeural",
    "ar": "ar-SA-HamedNeural",
    "nl": "nl-NL-MaartenNeural",
    "pl": "pl-PL-MarekNeural",
    "sv": "sv-SE-MattiasNeural",
    "nb": "nb-NO-FinnNeural",
    "da": "da-DK-JeppeNeural",
    "fi": "fi-FI-HarriNeural",
    "el": "el-GR-NestorasNeural",
    "cs": "cs-CZ-AntoninNeural",
    "hu": "hu-HU-TamasNeural",
    "ro": "ro-RO-EmilNeural",
    "uk": "uk-UA-OstapNeural",
    "id": "id-ID-ArdiNeural",
    "vi": "vi-VN-NamMinhNeural",
    "hi": "hi-IN-MadhurNeural",
    "default": "en-US-GuyNeural"
  };

  const langCode = (lang || "tr").split("-")[0].toLowerCase();
  const voice = sesMap[langCode] || sesMap["default"];

  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const safeText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
             xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
        <voice name="${voice}">
          <prosody rate="-8%" pitch="-12%" volume="100">
            ${safeText}
          </prosody>
        </voice>
      </speak>`;

    const chunks = [];
    const stream = tts.toStream(ssml);
    stream.on("data", chunk => chunks.push(chunk));
    stream.on("end", () => {
      const audioBuffer = Buffer.concat(chunks);
      res.set("Content-Type", "audio/mpeg");
      res.set("Content-Length", audioBuffer.length);
      res.send(audioBuffer);
    });
    stream.on("error", err => {
      console.log("Edge TTS stream hata:", err.message);
      res.status(500).json({ error: "TTS hatası", fallback: true });
    });
  } catch (e) {
    console.log("Edge TTS hata:", e.message);
    res.status(500).json({ error: "TTS kullanılamıyor", fallback: true });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("JARVIS backend aktif, port:", PORT));

app.post('/api/tts', async (req, res) => {
  const { text } = req.body;
  
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' + process.env.GEMINI_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' }
            }
          }
        }
      })
    }
  );

  const data = await response.json();
  const pcmBase64 = data.candidates[0].content.parts[0].inlineData.data;
  const pcmBuffer = Buffer.from(pcmBase64, 'base64');

  // PCM → WAV dönüştür (24000Hz, mono, 16bit)
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = pcmBuffer.length;
  const headerSize = 44;

  const wavBuffer = Buffer.alloc(headerSize + dataSize);
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + dataSize, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(numChannels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(wavBuffer, 44);

  res.set('Content-Type', 'audio/wav');
  res.send(wavBuffer);
});
