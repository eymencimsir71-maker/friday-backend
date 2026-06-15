// ═══════════════════════════════════════════════════════════════════════════
//  KERASUS AI  —  Backend Server  v3.0
//  Node.js + Express
//
//  Özellikler:
//    • /api/chat        → Anthropic Claude (web search dahil)
//    • /api/football    → Canlı maç skorları (API-Football)
//    • /api/standings   → Puan durumu
//    • /api/fixtures    → Günün maçları
//    • Güvenlik: APP_SECRET header kontrolü
//    • CORS: Android uygulaması için açık
//    • Rate limiting: basit in-memory
//
//  Kurulum:
//    npm install express node-fetch cors dotenv
//    node server.js
//
//  .env dosyası:
//    ANTHROPIC_API_KEY=sk-ant-...
//    FOOTBALL_API_KEY=...
//    APP_SECRET=friday-gizli-2026
//    PORT=3000
// ═══════════════════════════════════════════════════════════════════════════

require("dotenv").config();
const express  = require("express");
const cors     = require("cors");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ortam değişkenleri ──────────────────────────────────────────────────────
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || "";
const FOOTBALL_API_KEY   = process.env.FOOTBALL_API_KEY   || "";
const APP_SECRET         = process.env.APP_SECRET         || "friday-gizli-2026";

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ── Basit rate limiter (IP başına dakikada 30 istek) ───────────────────────
const rateLimitMap = new Map();

function rateLimit(req, res, next) {
  const ip  = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const win = 60_000; // 1 dakika
  const max = 30;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }

  const entry = rateLimitMap.get(ip);
  if (now - entry.start > win) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return next();
  }

  entry.count++;
  if (entry.count > max) {
    return res.status(429).json({ error: "Çok fazla istek. Lütfen bekleyin." });
  }
  next();
}

// ── Güvenlik: APP_SECRET kontrolü ──────────────────────────────────────────
function checkSecret(req, res, next) {
  const secret = req.headers["x-app-secret"];
  if (secret !== APP_SECRET) {
    return res.status(401).json({ error: "Yetkisiz erişim." });
  }
  next();
}

// ── Fetch yardımcısı ───────────────────────────────────────────────────────
async function fetchJSON(url, options = {}) {
  // Node 18+ global fetch kullanır, eski sürümler için node-fetch
  const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch");
  const res = await fetchFn(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

// ════════════════════════════════════════════════════════════════════════════
//  /api/chat  — Anthropic Claude + Web Search
// ════════════════════════════════════════════════════════════════════════════
//
//  İstek gövdesi:
//    { "messages": [ { "role": "user"|"assistant"|"system", "content": "..." } ] }
//
//  Yanıt:
//    OpenAI uyumlu format:
//    { "choices": [ { "message": { "role": "assistant", "content": "..." } } ] }
//
// ════════════════════════════════════════════════════════════════════════════

app.post("/api/chat", rateLimit, checkSecret, async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages dizisi gerekli." });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "ANTHROPIC_API_KEY ayarlanmamış." });
    }

    // System ve user/assistant mesajlarını ayır
    const systemMessages = messages.filter(m => m.role === "system");
    const chatMessages   = messages.filter(m => m.role !== "system");

    const systemPrompt = systemMessages.length > 0
      ? systemMessages.map(m => m.content).join("\n")
      : "Sen Kerasus adında gelişmiş bir yapay zeka asistanısın. Kullanıcının dilinde konuş. Samimi ve yardımsever ol.";

    // Anthropic API isteği — web_search tool dahil
    const anthropicBody = {
      model: "claude-opus-4-5",          // veya claude-haiku-4-5 (daha hızlı/ucuz)
      max_tokens: 1024,
      system: systemPrompt,
      messages: chatMessages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ]
    };

    const fetchFn = typeof fetch !== "undefined" ? fetch : require("node-fetch");

    const anthropicRes = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":            "application/json",
        "x-api-key":               ANTHROPIC_API_KEY,
        "anthropic-version":       "2023-06-01",
        "anthropic-beta":          "web-search-2025-03-05"
      },
      body: JSON.stringify(anthropicBody)
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic hata:", errText);
      return res.status(502).json({ error: "Anthropic API hatası.", detail: errText });
    }

    const data = await anthropicRes.json();

    // Tüm text bloklarını birleştir (tool_use sonuçları dahil)
    const cevap = (data.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    // OpenAI uyumlu format döndür (Android kodu bunu bekliyor)
    res.json({
      choices: [
        {
          message: {
            role:    "assistant",
            content: cevap || "Bir yanıt oluşturulamadı."
          }
        }
      ]
    });

  } catch (err) {
    console.error("/api/chat hatası:", err.message);
    res.status(500).json({ error: "Sunucu hatası.", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  /api/football/live  — Canlı Maç Skorları
// ════════════════════════════════════════════════════════════════════════════
//
//  Query parametreleri:
//    league  (isteğe bağlı) → Lig ID'si, örn: 203 (Süper Lig), boş = tümü
//
//  Yanıt:
//    {
//      "matches": [
//        {
//          "id": 12345,
//          "homeTeam": "Galatasaray",
//          "awayTeam": "Fenerbahçe",
//          "homeScore": 1,
//          "awayScore": 0,
//          "minute": 67,
//          "status": "LIVE",
//          "league": "Süper Lig",
//          "events": [ { "type": "GOAL", "team": "home", "player": "Icardi", "minute": 23 } ]
//        }
//      ],
//      "updated": "2026-06-15T18:30:00.000Z"
//    }
//
//  Önbellek: 60 saniye (API kotasını korumak için)
// ════════════════════════════════════════════════════════════════════════════

// Önbellek
let liveCache      = null;
let liveCacheTime  = 0;
const LIVE_TTL     = 60_000; // 60 saniye

app.get("/api/football/live", rateLimit, checkSecret, async (req, res) => {
  try {
    if (!FOOTBALL_API_KEY) {
      return res.status(500).json({ error: "FOOTBALL_API_KEY ayarlanmamış." });
    }

    // Önbellekten dön
    if (liveCache && Date.now() - liveCacheTime < LIVE_TTL) {
      return res.json(liveCache);
    }

    const leagueParam = req.query.league || "";
    const url = leagueParam
      ? `https://v3.football.api-sports.io/fixtures?live=all&league=${leagueParam}`
      : `https://v3.football.api-sports.io/fixtures?live=all`;

    const data = await fetchJSON(url, {
      headers: { "x-apisports-key": FOOTBALL_API_KEY }
    });

    const matches = (data.response || []).map(fixture => ({
      id:        fixture.fixture.id,
      homeTeam:  fixture.teams.home.name,
      awayTeam:  fixture.teams.away.name,
      homeLogo:  fixture.teams.home.logo,
      awayLogo:  fixture.teams.away.logo,
      homeScore: fixture.goals.home  ?? 0,
      awayScore: fixture.goals.away  ?? 0,
      minute:    fixture.fixture.status.elapsed ?? 0,
      status:    fixture.fixture.status.short,   // "1H","HT","2H","ET","P"
      statusLong:fixture.fixture.status.long,
      league:    fixture.league.name,
      leagueId:  fixture.league.id,
      country:   fixture.league.country,
      events:    (fixture.events || []).map(ev => ({
        type:   ev.type,       // "Goal","Card","subst"
        detail: ev.detail,     // "Normal Goal","Yellow Card" vs
        team:   ev.team.name,
        player: ev.player.name,
        minute: ev.time.elapsed
      }))
    }));

    const result = { matches, updated: new Date().toISOString() };
    liveCache     = result;
    liveCacheTime = Date.now();

    res.json(result);

  } catch (err) {
    console.error("/api/football/live hatası:", err.message);
    res.status(500).json({ error: "Futbol API hatası.", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  /api/football/fixtures  — Günün Maçları (Canlı + Programlı)
// ════════════════════════════════════════════════════════════════════════════
//
//  Query parametreleri:
//    league  → Lig ID (örn: 203)
//    date    → YYYY-MM-DD (varsayılan: bugün)
//
//  Lig ID'leri:
//    203 → Türkiye Süper Lig
//    39  → İngiltere Premier League
//    140 → İspanya La Liga
//    135 → İtalya Serie A
//    78  → Almanya Bundesliga
//    61  → Fransa Ligue 1
//    2   → UEFA Champions League
//    3   → UEFA Europa League
// ════════════════════════════════════════════════════════════════════════════

let fixturesCache     = {};
let fixturesCacheTime = {};
const FIXTURES_TTL    = 300_000; // 5 dakika

app.get("/api/football/fixtures", rateLimit, checkSecret, async (req, res) => {
  try {
    if (!FOOTBALL_API_KEY) {
      return res.status(500).json({ error: "FOOTBALL_API_KEY ayarlanmamış." });
    }

    const league = req.query.league || "203";
    const today  = new Date().toISOString().split("T")[0];
    const date   = req.query.date   || today;
    const cacheKey = `${league}_${date}`;

    // Önbellekten dön
    if (fixturesCache[cacheKey] && Date.now() - fixturesCacheTime[cacheKey] < FIXTURES_TTL) {
      return res.json(fixturesCache[cacheKey]);
    }

    const season = new Date().getFullYear();
    const url = `https://v3.football.api-sports.io/fixtures?league=${league}&date=${date}&season=${season}`;

    const data = await fetchJSON(url, {
      headers: { "x-apisports-key": FOOTBALL_API_KEY }
    });

    const fixtures = (data.response || []).map(fixture => ({
      id:         fixture.fixture.id,
      homeTeam:   fixture.teams.home.name,
      awayTeam:   fixture.teams.away.name,
      homeLogo:   fixture.teams.home.logo,
      awayLogo:   fixture.teams.away.logo,
      homeScore:  fixture.goals.home,
      awayScore:  fixture.goals.away,
      kickoff:    fixture.fixture.date,           // ISO 8601
      venue:      fixture.fixture.venue?.name,
      status:     fixture.fixture.status.short,
      statusLong: fixture.fixture.status.long,
      minute:     fixture.fixture.status.elapsed,
      league:     fixture.league.name,
      leagueId:   fixture.league.id,
      round:      fixture.league.round
    }));

    const result = { fixtures, date, league, updated: new Date().toISOString() };
    fixturesCache[cacheKey]     = result;
    fixturesCacheTime[cacheKey] = Date.now();

    res.json(result);

  } catch (err) {
    console.error("/api/football/fixtures hatası:", err.message);
    res.status(500).json({ error: "Fikstür hatası.", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  /api/football/standings  — Puan Durumu
// ════════════════════════════════════════════════════════════════════════════
//
//  Query parametreleri:
//    league  → Lig ID (varsayılan: 203 Süper Lig)
//    season  → Yıl (varsayılan: bu yıl)
//
//  Önbellek: 1 saat
// ════════════════════════════════════════════════════════════════════════════

let standingsCache     = {};
let standingsCacheTime = {};
const STANDINGS_TTL    = 3_600_000; // 1 saat

app.get("/api/football/standings", rateLimit, checkSecret, async (req, res) => {
  try {
    if (!FOOTBALL_API_KEY) {
      return res.status(500).json({ error: "FOOTBALL_API_KEY ayarlanmamış." });
    }

    const league   = req.query.league || "203";
    const season   = req.query.season || new Date().getFullYear();
    const cacheKey = `${league}_${season}`;

    if (standingsCache[cacheKey] && Date.now() - standingsCacheTime[cacheKey] < STANDINGS_TTL) {
      return res.json(standingsCache[cacheKey]);
    }

    const url  = `https://v3.football.api-sports.io/standings?league=${league}&season=${season}`;
    const data = await fetchJSON(url, {
      headers: { "x-apisports-key": FOOTBALL_API_KEY }
    });

    const raw = data.response?.[0]?.league?.standings?.[0] || [];
    const standings = raw.map(team => ({
      rank:       team.rank,
      team:       team.team.name,
      logo:       team.team.logo,
      played:     team.all.played,
      won:        team.all.win,
      drawn:      team.all.draw,
      lost:       team.all.lose,
      goalsFor:   team.all.goals.for,
      goalsAgainst: team.all.goals.against,
      goalDiff:   team.goalsDiff,
      points:     team.points,
      form:       team.form   // "WWDLW" gibi
    }));

    const result = { standings, league, season, updated: new Date().toISOString() };
    standingsCache[cacheKey]     = result;
    standingsCacheTime[cacheKey] = Date.now();

    res.json(result);

  } catch (err) {
    console.error("/api/football/standings hatası:", err.message);
    res.status(500).json({ error: "Puan durumu hatası.", detail: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  /api/football/leagues  — Popüler liglerin listesi
// ════════════════════════════════════════════════════════════════════════════

app.get("/api/football/leagues", checkSecret, (req, res) => {
  res.json({
    leagues: [
      { id: 203, name: "Süper Lig",          country: "Türkiye",   flag: "🇹🇷" },
      { id: 39,  name: "Premier League",      country: "İngiltere", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
      { id: 140, name: "La Liga",             country: "İspanya",   flag: "🇪🇸" },
      { id: 135, name: "Serie A",             country: "İtalya",    flag: "🇮🇹" },
      { id: 78,  name: "Bundesliga",          country: "Almanya",   flag: "🇩🇪" },
      { id: 61,  name: "Ligue 1",             country: "Fransa",    flag: "🇫🇷" },
      { id: 2,   name: "Champions League",    country: "UEFA",      flag: "🏆" },
      { id: 3,   name: "Europa League",       country: "UEFA",      flag: "🥈" },
      { id: 197, name: "Süper Lig (Yunanistan)", country: "Yunanistan", flag: "🇬🇷" },
      { id: 88,  name: "Eredivisie",          country: "Hollanda",  flag: "🇳🇱" }
    ]
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  /health  — Sunucu sağlık kontrolü
// ════════════════════════════════════════════════════════════════════════════

app.get("/health", (req, res) => {
  res.json({
    status:          "OK",
    version:         "3.0",
    time:            new Date().toISOString(),
    anthropic:       !!ANTHROPIC_API_KEY,
    football:        !!FOOTBALL_API_KEY,
    uptime_seconds:  Math.floor(process.uptime())
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint bulunamadı.", path: req.path });
});

// ── Sunucuyu başlat ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("═══════════════════════════════════════");
  console.log("  KERASUS Backend v3.0");
  console.log(`  Port       : ${PORT}`);
  console.log(`  Anthropic  : ${ANTHROPIC_API_KEY ? "✅ Bağlı" : "❌ Eksik"}`);
  console.log(`  Football   : ${FOOTBALL_API_KEY  ? "✅ Bağlı" : "❌ Eksik"}`);
  console.log("═══════════════════════════════════════");
});
