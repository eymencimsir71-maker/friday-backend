const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const APP_SECRET     = process.env.APP_SECRET;
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const rateLimitMap = new Map();
function rateLimit(req, res, next) {
    const ip      = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now     = Date.now();
    const windowMs = 60 * 1000;
    const maxReqs  = 20;
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, start: now });
        return next();
    }
    const entry = rateLimitMap.get(ip);
    if (now - entry.start > windowMs) {
        rateLimitMap.set(ip, { count: 1, start: now });
        return next();
    }
    if (entry.count >= maxReqs) {
        return res.status(429).json({ error: 'Too many requests.' });
    }
    entry.count++;
    next();
}

app.use(rateLimit);

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post('/api/chat', async (req, res) => {
    const clientSecret = req.headers['x-app-secret'];
    if (!APP_SECRET || clientSecret !== APP_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { contents, system_instruction } = req.body;
    if (!contents || !Array.isArray(contents)) {
        return res.status(400).json({ error: 'Invalid request body' });
    }
    try {
        const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ contents, system_instruction }),
            signal:  AbortSignal.timeout(30000)
        });
        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Gemini API error', details: data });
        }
        res.json(data);
    } catch (err) {
        if (err.name === 'TimeoutError') {
            return res.status(504).json({ error: 'Timeout' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Friday backend listening on port ${PORT}`));
