'use strict';
// Shared API logic (used by server.js on Render/local and api/[...path].js on Vercel).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
const FILE = path.join(DATA_DIR, 'users.json');
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

// ---------- tiny user store (JSON file) ----------
let users = {};
try { users = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { users = {}; }
const save = () => { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(users)); } catch (e) {} };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function makeUser(name, email, pw, profile) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { id: crypto.randomUUID(), name, email, salt, hash: hashPw(pw, salt), created: Date.now(),
    profile: profile || { age: 25, sex: 'Male', height: 170, weight: 65, conditions: '', notes: '' } };
}
// Demo account so the site can always be shown, even after a serverless cold start.
if (!users['demo@twin.com']) {
  users['demo@twin.com'] = makeUser('Demo User', 'demo@twin.com', 'Demo@123',
    { age: 28, sex: 'Male', height: 172, weight: 68, conditions: 'None', notes: 'Sample patient for project demo' });
  save();
}

// ---------- tokens (HMAC signed, stateless) ----------
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}
function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}

// ---------- helpers ----------
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') return resolve(req.body);
      try { return resolve(JSON.parse(req.body)); } catch (e) { return resolve({}); }
    }
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, profile: u.profile });
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const hits = {};
function limited(ip) {
  const now = Date.now(); const h = hits[ip] && hits[ip].reset > now ? hits[ip] : (hits[ip] = { n: 0, reset: now + 60000 });
  return ++h.n > 15;
}
function authUser(req) {
  const h = req.headers['authorization'] || '';
  const p = verify(h.startsWith('Bearer ') ? h.slice(7) : '');
  return p ? users[p.email] : null;
}

// ---------- simulated IoT sensor stream ----------
const noise = (x) => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };
function sample(t, scenario, f) {
  const s = t / 1000;
  let hr = 72 + 6 * Math.sin(s / 9) + 3 * Math.sin(s / 2.3) + (noise(Math.floor(s)) - 0.5) * 4;
  let sys = 118 + 5 * Math.sin(s / 15) + (noise(s + 1) - 0.5) * 3;
  let dia = 78 + 3 * Math.sin(s / 15) + (noise(s + 2) - 0.5) * 2;
  let spo2 = 97.6 + 0.8 * Math.sin(s / 11) + (noise(s + 3) - 0.5) * 0.8;
  let temp = 36.7 + 0.1 * Math.sin(s / 40) + (noise(s + 4) - 0.5) * 0.06;
  let rr = 16 + 1.5 * Math.sin(s / 7) + (noise(s + 5) - 0.5);
  if (scenario === 'stress') { hr += 38 * f; sys += 28 * f; dia += 14 * f; rr += 6 * f; }
  if (scenario === 'hypoxia') { spo2 -= 8.5 * f; rr += 8 * f; hr += 16 * f; }
  if (scenario === 'fever') { temp += 1.9 * f; hr += 20 * f; rr += 3 * f; }
  const r1 = (v) => Math.round(v * 10) / 10;
  return { t, hr: Math.round(hr), sys: Math.round(sys), dia: Math.round(dia), spo2: r1(clamp(spo2, 70, 100)), temp: r1(temp), rr: r1(rr) };
}

// ---------- lightweight AI/ML analysis (z-score anomaly detection + linear trend + risk model) ----------
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1e-6; };
function slope(a) { // least-squares slope per sample
  const n = a.length, xm = (n - 1) / 2, ym = mean(a);
  let num = 0, den = 0; a.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
  return den ? num / den : 0;
}
const SEV = { ok: 0, warn: 0.5, crit: 1 };
function level(v, rules) { // rules: [warnLow, critLow, warnHigh, critHigh]
  const [wl, cl, wh, ch] = rules;
  if (v <= cl || v >= ch) return 'crit';
  if (v <= wl || v >= wh) return 'warn';
  return 'ok';
}
const worstOf = (...l) => l.sort((a, b) => SEV[b] - SEV[a])[0];
function analyze(points, profile) {
  const last = points[points.length - 1];
  const base = points.slice(0, Math.floor(points.length * 0.6));
  const z = (key) => (last[key] - mean(base.map((p) => p[key]))) / std(base.map((p) => p[key]));
  const st = {
    hr: level(last.hr, [60, 50, 100, 120]),
    bp: worstOf(level(last.sys, [95, 85, 130, 160]), level(last.dia, [60, 50, 85, 100])),
    spo2: level(last.spo2, [94, 90, 200, 201]),
    temp: level(last.temp, [36.0, 35.0, 37.8, 39.0]),
    rr: level(last.rr, [12, 9, 20, 25])
  };
  const h = clamp(Number(profile.height) || 170, 100, 230) / 100, w = clamp(Number(profile.weight) || 65, 25, 250);
  const bmi = Math.round((w / (h * h)) * 10) / 10;
  const age = Number(profile.age) || 25;
  let risk = 8 + 22 * SEV[st.hr] + 20 * SEV[st.bp] + 28 * SEV[st.spo2] + 14 * SEV[st.temp] + 10 * SEV[st.rr];
  if (bmi >= 30) risk += 8; else if (bmi >= 25) risk += 3; else if (bmi < 18.5) risk += 4;
  if (age > 60) risk += 4;
  const zs = { hr: z('hr'), spo2: z('spo2'), temp: z('temp'), rr: z('rr') };
  const anomalies = Object.keys(zs).filter((k) => Math.abs(zs[k]) > 2.5);
  risk += anomalies.length * 5;
  risk = Math.round(clamp(risk, 0, 100));
  const organs = {
    heart: { status: worstOf(st.hr, st.bp), detail: `Heart rate ${last.hr} bpm, BP ${last.sys}/${last.dia} mmHg.` },
    lungs: { status: worstOf(st.spo2, st.rr), detail: `SpO₂ ${last.spo2}%, respiration ${last.rr} breaths/min.` },
    brain: { status: st.temp, detail: `Core temperature ${last.temp} °C.` },
    liver: { status: bmi >= 30 ? 'warn' : 'ok', detail: `BMI ${bmi} — metabolic load indicator (simulated).` },
    stomach: { status: 'ok', detail: 'No abnormal signals detected (simulated).' },
    kidneys: { status: bmi >= 30 && st.bp !== 'ok' ? 'warn' : 'ok', detail: 'Perfusion estimated from blood pressure and BMI (simulated).' }
  };
  const insights = [];
  const tr = slope(points.map((p) => p.hr)) * 30;
  if (st.hr !== 'ok') insights.push({ level: st.hr, title: last.hr > 100 ? 'Elevated heart rate' : 'Low heart rate', text: `Heart rate is ${last.hr} bpm, outside the normal resting range of 60–100 bpm.` });
  if (st.bp !== 'ok') insights.push({ level: st.bp, title: 'Blood pressure out of range', text: `Reading ${last.sys}/${last.dia} mmHg. Normal is below 130/85.` });
  if (st.spo2 !== 'ok') insights.push({ level: st.spo2, title: 'Low oxygen saturation', text: `SpO₂ is ${last.spo2}%. Values below 94% need attention.` });
  if (st.temp !== 'ok') insights.push({ level: st.temp, title: last.temp > 37.5 ? 'Raised temperature' : 'Low temperature', text: `Body temperature is ${last.temp} °C.` });
  if (st.rr !== 'ok') insights.push({ level: st.rr, title: 'Abnormal breathing rate', text: `Respiration is ${last.rr} breaths/min (normal 12–20).` });
  if (Math.abs(tr) > 6) insights.push({ level: 'warn', title: tr > 0 ? 'Heart rate trending up' : 'Heart rate trending down', text: `Linear trend of about ${tr > 0 ? '+' : ''}${Math.round(tr)} bpm per minute over the monitoring window.` });
  anomalies.forEach((k) => insights.push({ level: 'warn', title: 'Anomaly detected (' + k.toUpperCase() + ')', text: `Latest value deviates ${Math.abs(zs[k]).toFixed(1)}σ from the personal baseline.` }));
  if (bmi >= 30) insights.push({ level: 'warn', title: 'High BMI', text: `BMI ${bmi} is in the obesity range, a long-term risk factor for heart disease.` });
  if (!insights.length) insights.push({ level: 'ok', title: 'All vitals within normal range', text: 'No abnormal patterns detected in the current monitoring window.' });
  const recs = [];
  if (st.hr !== 'ok' || st.bp !== 'ok') recs.push('Rest, hydrate and re-measure in a few minutes.');
  if (st.spo2 !== 'ok') recs.push('Sit upright, take slow deep breaths and seek care if SpO₂ stays low.');
  if (st.temp !== 'ok') recs.push('Rest, drink fluids and monitor temperature regularly.');
  if (bmi >= 25) recs.push('Regular physical activity and a balanced diet can improve cardiovascular health.');
  if (!recs.length) recs.push('Keep up regular activity, sleep and hydration.');
  recs.push('Educational project — not a medical diagnosis. Consult a doctor for health concerns.');
  return { risk, riskLevel: risk < 25 ? 'Low' : risk < 50 ? 'Moderate' : 'High', status: st, bmi, organs, insights, recommendations: recs,
    model: { method: 'Z-score anomaly detection + least-squares trend + weighted risk score', window: points.length } };
}

// ---------- request handler ----------
async function handler(req, res) {
  try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '');
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || 'x';

    if (p === '/api/health') return send(res, 200, { ok: true, time: Date.now() });

    if (req.method === 'POST' && (p === '/api/auth/register' || p === '/api/auth/login')) {
      if (limited(ip)) return send(res, 429, { error: 'Too many attempts. Please wait a minute.' });
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
      if (p.endsWith('register')) {
        const name = String(b.name || '').trim().slice(0, 60);
        if (name.length < 2) return send(res, 400, { error: 'Enter your full name.' });
        if (pw.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
        if (users[email]) return send(res, 409, { error: 'An account with this email already exists.' });
        users[email] = makeUser(name, email, pw); save();
      }
      const u = users[email];
      if (!u || hashPw(pw, u.salt) !== u.hash) return send(res, 401, { error: 'Invalid email or password.' });
      return send(res, 200, { token: sign({ email, exp: Date.now() + 12 * 3600 * 1000 }), user: publicUser(u) });
    }

    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'Please log in to continue.' });

    if (req.method === 'GET' && p === '/api/auth/me') return send(res, 200, { user: publicUser(user) });

    if (p === '/api/profile') {
      if (req.method === 'GET') return send(res, 200, { profile: user.profile });
      if (req.method === 'PUT') {
        const b = await readBody(req);
        user.profile = {
          age: clamp(parseInt(b.age) || 25, 1, 120), sex: ['Male', 'Female', 'Other'].includes(b.sex) ? b.sex : 'Other',
          height: clamp(parseFloat(b.height) || 170, 50, 250), weight: clamp(parseFloat(b.weight) || 65, 10, 300),
          conditions: String(b.conditions || '').slice(0, 200), notes: String(b.notes || '').slice(0, 500)
        };
        if (b.name && String(b.name).trim().length >= 2) user.name = String(b.name).trim().slice(0, 60);
        save();
        return send(res, 200, { user: publicUser(user) });
      }
    }

    if (req.method === 'GET' && (p === '/api/vitals' || p === '/api/analysis')) {
      const n = clamp(parseInt(url.searchParams.get('n')) || 40, 10, 120);
      const scn = ['normal', 'stress', 'hypoxia', 'fever'].includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'normal';
      const now = Math.floor(Date.now() / 2000) * 2000, pts = [];
      for (let i = n - 1; i >= 0; i--) {
        const idx = n - 1 - i; const f = clamp((idx / n - 0.4) / 0.4, 0, 1);
        pts.push(sample(now - i * 2000, scn, scn === 'normal' ? 0 : f));
      }
      return send(res, 200, { scenario: scn, history: pts, latest: pts[pts.length - 1], analysis: analyze(pts, user.profile) });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
}

module.exports = { handler };
