'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { ok: 0x2ecc8f, warn: 0xffb020, crit: 0xff5468 };
const HEX = { ok: '#2ecc8f', warn: '#ffb020', crit: '#ff5468' };

const S = { token: localStorage.getItem('twin_token'), user: null, scenario: 'normal', metric: 'hr', data: null, timer: null, three: null, selected: null, view: 'dash' };

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {}; try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && S.token && !path.includes('/auth/')) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }

/* ---------------- Auth UI ---------------- */
function showTab(login) {
  $('#tabLogin').classList.toggle('active', login); $('#tabRegister').classList.toggle('active', !login);
  $('#loginForm').classList.toggle('hidden', !login); $('#regForm').classList.toggle('hidden', login);
}
$('#tabLogin').onclick = () => showTab(true);
$('#tabRegister').onclick = () => showTab(false);
$$('.eye').forEach((b) => b.onclick = () => { const i = $('#' + b.dataset.t); i.type = i.type === 'password' ? 'text' : 'password'; });

async function doAuth(kind, body, errEl, btn) {
  errEl.textContent = ''; btn.disabled = true; const old = btn.textContent; btn.textContent = 'Please wait…';
  try {
    const r = await api('/api/auth/' + kind, { method: 'POST', body });
    S.token = r.token; S.user = r.user; localStorage.setItem('twin_token', r.token); enterApp();
  } catch (e) { errEl.textContent = e.message; }
  btn.disabled = false; btn.textContent = old;
}
$('#loginForm').onsubmit = (e) => { e.preventDefault(); doAuth('login', { email: $('#lEmail').value, password: $('#lPass').value }, $('#lErr'), $('#lBtn')); };
$('#regForm').onsubmit = (e) => { e.preventDefault(); doAuth('register', { name: $('#rName').value, email: $('#rEmail').value, password: $('#rPass').value }, $('#rErr'), $('#rBtn')); };
$('#demoBtn').onclick = () => doAuth('login', { email: 'demo@twin.com', password: 'Demo@123' }, $('#lErr'), $('#demoBtn'));

function logout() {
  S.token = null; S.user = null; localStorage.removeItem('twin_token'); clearInterval(S.timer);
  $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden');
}
$('#logout').onclick = logout;

function enterApp() {
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#hello').textContent = 'Hello, ' + S.user.name.split(' ')[0] + ' 👋';
  fillProfile(); init3D(); setView(S.view); poll(); clearInterval(S.timer); S.timer = setInterval(poll, 2000);
}

/* ---------------- Navigation ---------------- */
function setView(v) {
  S.view = v;
  ['dash', 'analytics', 'profile'].forEach((x) => $('#v-' + x).classList.toggle('hidden', x !== v));
  $$('.nav[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#side').classList.remove('open');
  if (v === 'dash' && S.three) setTimeout(resize3D, 30);
  if (S.data) render();
}
$$('.nav[data-view]').forEach((b) => b.onclick = () => setView(b.dataset.view));
$('#burger').onclick = () => $('#side').classList.toggle('open');
$$('.chip').forEach((c) => c.onclick = () => {
  S.scenario = c.dataset.s; $$('.chip').forEach((x) => x.classList.toggle('active', x === c)); poll();
  if (S.scenario !== 'normal') toast('Simulating: ' + c.textContent + ' — watch the twin react');
});

/* ---------------- Polling + rendering ---------------- */
const METRICS = {
  hr: { name: 'Heart Rate', icon: '❤️', unit: 'bpm', series: [{ k: 'hr', c: '#ff6b81' }], lo: 60, hi: 100, min: 40, max: 140 },
  bp: { name: 'Blood Pressure', icon: '🩸', unit: 'mmHg', series: [{ k: 'sys', c: '#ff9f43' }, { k: 'dia', c: '#4da3ff' }], lo: 80, hi: 130, min: 50, max: 180 },
  spo2: { name: 'Oxygen (SpO₂)', icon: '🫁', unit: '%', series: [{ k: 'spo2', c: '#2ee6c4' }], lo: 94, hi: 100, min: 80, max: 100 },
  temp: { name: 'Temperature', icon: '🌡️', unit: '°C', series: [{ k: 'temp', c: '#ffd166' }], lo: 36.1, hi: 37.5, min: 35, max: 40 },
  rr: { name: 'Respiration', icon: '💨', unit: '/min', series: [{ k: 'rr', c: '#a78bfa' }], lo: 12, hi: 20, min: 6, max: 32 }
};
async function poll() {
  try { S.data = await api('/api/vitals?n=40&scenario=' + S.scenario); render(); } catch (e) { /* ignore transient errors */ }
}
function render() {
  const d = S.data, a = d.analysis, L = d.latest;
  // vitals cards
  const val = { hr: L.hr, bp: L.sys + '/' + L.dia, spo2: L.spo2, temp: L.temp, rr: L.rr };
  $('#vitals').innerHTML = Object.keys(METRICS).map((k) => {
    const m = METRICS[k];
    return `<div class="vital ${a.status[k]} ${S.metric === k ? 'sel' : ''}" data-m="${k}"><div class="ic">${m.icon}</div><div class="nm">${m.name}</div><div class="vl">${val[k]}<small>${m.unit}</small></div><div class="bar"></div></div>`;
  }).join('');
  $$('.vital').forEach((v) => v.onclick = () => { S.metric = v.dataset.m; render(); });
  $('#chartTitle').textContent = METRICS[S.metric].name;
  // risk
  const col = a.riskLevel === 'Low' ? 'ok' : a.riskLevel === 'Moderate' ? 'warn' : 'crit';
  $('#riskVal').textContent = a.risk;
  const fg = $('#gFg'); fg.style.strokeDashoffset = 314 - (314 * a.risk) / 100; fg.style.stroke = HEX[col];
  $('#riskPill').textContent = a.riskLevel + ' risk'; $('#riskPill').className = 'pill ' + col;
  $('#bmiLine').textContent = 'BMI ' + a.bmi + ' · based on live vitals and profile';
  $('#insights').innerHTML = a.insights.map((i) => `<div class="ins ${i.level}"><div><b>${esc(i.title)}</b><span>${esc(i.text)}</span></div></div>`).join('');
  $('#recs').innerHTML = a.recommendations.map((r) => `<li>${esc(r)}</li>`).join('');
  $('#modelInfo').textContent = a.model.method + ' · window of ' + a.model.window + ' samples (every 2 s).';
  $('#bmiBadge').textContent = 'BMI ' + a.bmi;
  // charts
  if (S.view === 'dash') drawChart($('#mainChart'), METRICS[S.metric], d.history, 260);
  if (S.view === 'analytics') {
    const box = $('#charts');
    if (!box.children.length) box.innerHTML = Object.keys(METRICS).map((k) => `<div class="card"><div class="card-h"><b>${METRICS[k].name}</b><span class="muted">${METRICS[k].unit}</span></div><canvas data-k="${k}"></canvas></div>`).join('');
    $$('#charts canvas').forEach((c) => drawChart(c, METRICS[c.dataset.k], d.history, 190));
  }
  update3D(a, L);
}

/* ---------------- Canvas line chart ---------------- */
function drawChart(cv, m, hist, h) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth; if (!w) return;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const pl = 42, pr = 14, pt = 12, pb = 22, W = w - pl - pr, H = h - pt - pb;
  const y = (v) => pt + H - ((v - m.min) / (m.max - m.min)) * H;
  g.font = '11px Inter, sans-serif'; g.textBaseline = 'middle';
  // normal band
  g.fillStyle = 'rgba(46,204,143,.08)'; g.fillRect(pl, y(m.hi), W, y(m.lo) - y(m.hi));
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.fillStyle = '#8aa4ba'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = m.min + ((m.max - m.min) * i) / 4, yy = y(v);
    g.beginPath(); g.moveTo(pl, yy); g.lineTo(pl + W, yy); g.stroke();
    g.textAlign = 'right'; g.fillText(Math.round(v * 10) / 10, pl - 8, yy);
  }
  m.series.forEach((s) => {
    const pts = hist.map((p, i) => [pl + (i / (hist.length - 1)) * W, y(Math.min(m.max, Math.max(m.min, p[s.k])))]);
    if (m.series.length === 1) { // area fill
      const gr = g.createLinearGradient(0, pt, 0, pt + H); gr.addColorStop(0, s.c + '55'); gr.addColorStop(1, s.c + '00');
      g.beginPath(); g.moveTo(pts[0][0], pt + H); pts.forEach((p) => g.lineTo(p[0], p[1])); g.lineTo(pts[pts.length - 1][0], pt + H); g.closePath(); g.fillStyle = gr; g.fill();
    }
    g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.strokeStyle = s.c; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke();
    const e = pts[pts.length - 1]; g.beginPath(); g.arc(e[0], e[1], 5, 0, 7); g.fillStyle = s.c; g.fill();
    g.beginPath(); g.arc(e[0], e[1], 9, 0, 7); g.strokeStyle = s.c + '55'; g.lineWidth = 2; g.stroke();
  });
  g.fillStyle = '#8aa4ba'; g.textAlign = 'left'; g.fillText('older', pl, h - 8); g.textAlign = 'right'; g.fillText('now', pl + W, h - 8);
}

/* ---------------- Profile ---------------- */
function fillProfile() {
  const p = S.user.profile || {};
  $('#pName').value = S.user.name; $('#pAge').value = p.age; $('#pSex').value = p.sex || 'Male';
  $('#pHeight').value = p.height; $('#pWeight').value = p.weight; $('#pCond').value = p.conditions || ''; $('#pNotes').value = p.notes || '';
}
$('#profForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/profile', { method: 'PUT', body: { name: $('#pName').value, age: $('#pAge').value, sex: $('#pSex').value, height: $('#pHeight').value, weight: $('#pWeight').value, conditions: $('#pCond').value, notes: $('#pNotes').value } });
    S.user = r.user; $('#hello').textContent = 'Hello, ' + S.user.name.split(' ')[0] + ' 👋';
    $('#saved').textContent = '✓ Saved'; setTimeout(() => $('#saved').textContent = '', 2500); toast('Profile saved — twin updated'); poll();
  } catch (err) { toast(err.message); }
};

/* ---------------- 3D digital twin (Three.js) ---------------- */
function init3D() {
  if (S.three) return;
  if (typeof THREE === 'undefined') { $('#viewer').innerHTML = '<p class="muted" style="padding:2rem">3D engine could not load. Check your internet connection.</p>'; return; }
  const el = $('#viewer'), w = el.clientWidth || 600, h = el.clientHeight || 520;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(w, h); el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100); camera.position.set(0, 0.4, 9.2); camera.lookAt(0, 0.2, 0);
  scene.add(new THREE.AmbientLight(0x7aa6cc, 0.75));
  const l1 = new THREE.PointLight(0x00d4ff, 1.3, 40); l1.position.set(4, 4, 6); scene.add(l1);
  const l2 = new THREE.PointLight(0x5a7dff, 0.9, 40); l2.position.set(-5, -1, 4); scene.add(l2);
  const body = new THREE.Group(); body.position.y = -0.2; scene.add(body);
  const shellMat = new THREE.MeshPhongMaterial({ color: 0x1fa3c4, transparent: true, opacity: 0.14, shininess: 90, side: THREE.DoubleSide, depthWrite: false });
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x3fd8ff, wireframe: true, transparent: true, opacity: 0.1 });
  const part = (geo, x, y, z, sx = 1, sy = 1, sz = 1, rz = 0) => {
    const m = new THREE.Mesh(geo, shellMat); const wmesh = new THREE.Mesh(geo, wireMat);
    [m, wmesh].forEach((o) => { o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.z = rz; body.add(o); });
  };
  const sph = (r) => new THREE.SphereGeometry(r, 26, 20), cyl = (a, b, hh) => new THREE.CylinderGeometry(a, b, hh, 24, 1, true);
  part(sph(0.46), 0, 2.75, 0, 1, 1.18, 1.0);                       // head
  part(cyl(0.17, 0.21, 0.35), 0, 2.2, 0);                         // neck
  part(cyl(0.8, 0.55, 2.0), 0, 1.0, 0, 1, 1, 0.62);               // torso
  part(sph(0.58), 0, -0.1, 0, 1, 0.6, 0.62);                      // pelvis
  [-1, 1].forEach((s) => {
    part(sph(0.23), s * 0.88, 1.85, 0);                           // shoulder
    part(cyl(0.15, 0.12, 1.1), s * 1.02, 1.25, 0, 1, 1, 1, s * 0.1); // upper arm
    part(cyl(0.12, 0.09, 1.0), s * 1.14, 0.2, 0, 1, 1, 1, s * 0.07); // forearm
    part(sph(0.13), s * 1.2, -0.38, 0);                           // hand
    part(cyl(0.27, 0.19, 1.4), s * 0.3, -1.05, 0);                // thigh
    part(cyl(0.18, 0.12, 1.4), s * 0.3, -2.4, 0);                 // calf
    part(new THREE.BoxGeometry(0.28, 0.14, 0.5), s * 0.3, -3.15, 0.1); // foot
  });
  // organs
  const organs = {};
  const org = (name, geo, x, y, z, sx, sy, sz) => {
    const mat = new THREE.MeshPhongMaterial({ color: COLORS.ok, emissive: COLORS.ok, emissiveIntensity: 0.45, shininess: 70, transparent: true, opacity: 0.95 });
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.userData.organ = name; body.add(m);
    (organs[name] = organs[name] || []).push(m); return m;
  };
  org('brain', sph(0.3), 0, 2.8, 0, 1.05, 0.85, 0.95);
  org('heart', sph(0.22), 0.2, 1.3, 0.22, 1, 1.15, 0.9);
  org('lungs', sph(0.3), -0.45, 1.45, 0.02, 0.8, 1.45, 0.7); org('lungs', sph(0.3), 0.5, 1.45, 0.02, 0.8, 1.45, 0.7);
  org('liver', sph(0.26), 0.32, 0.72, 0.18, 1.35, 0.7, 0.8);
  org('stomach', sph(0.2), -0.25, 0.68, 0.2, 1.1, 0.85, 0.8);
  org('kidneys', sph(0.13), -0.3, 0.4, -0.15, 0.7, 1.2, 0.7); org('kidneys', sph(0.13), 0.3, 0.4, -0.15, 0.7, 1.2, 0.7);
  // floor ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.6, 64), new THREE.MeshBasicMaterial({ color: 0x00c2de, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = -3.35; body.add(ring);
  const ring2 = ring.clone(); ring2.geometry = new THREE.RingGeometry(2.0, 2.04, 64); ring2.material = new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.3, side: THREE.DoubleSide }); body.add(ring2);

  const T = { renderer, scene, camera, body, organs, hr: 72, drag: false, moved: 0, last: 0, ring, t0: performance.now() };
  S.three = T;
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { T.drag = true; T.moved = 0; T.last = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!T.drag) return; const dx = e.clientX - T.last; T.last = e.clientX; T.moved += Math.abs(dx); body.rotation.y += dx * 0.01; });
  cv.addEventListener('pointerup', (e) => {
    T.drag = false;
    if (T.moved < 5) { // click -> select organ
      const r = cv.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects([].concat(...Object.values(organs)))[0];
      if (hit) { S.selected = hit.object.userData.organ; showOrgan(); }
    }
  });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); camera.position.z = Math.min(14, Math.max(5, camera.position.z + e.deltaY * 0.005)); }, { passive: false });
  window.addEventListener('resize', resize3D);
  (function loop(now) {
    requestAnimationFrame(loop);
    if (!T.drag) body.rotation.y += 0.0035;
    const beat = Math.pow(Math.max(0, Math.sin(((now - T.t0) / 1000) * (T.hr / 60) * Math.PI * 2)), 6);
    (organs.heart || []).forEach((m) => m.scale.set(1 + beat * 0.16, 1.15 + beat * 0.18, 0.9 + beat * 0.16));
    const br = 1 + 0.05 * Math.sin((now - T.t0) / 1000 * 1.6);
    (organs.lungs || []).forEach((m) => m.scale.set(0.8 * br, 1.45 * br, 0.7 * br));
    T.ring.rotation.z += 0.004;
    renderer.render(scene, camera);
  })(performance.now());
}
function resize3D() {
  const T = S.three; if (!T) return; const el = $('#viewer'), w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
  T.renderer.setSize(w, h); T.camera.aspect = w / h; T.camera.updateProjectionMatrix();
}
function update3D(a, L) {
  const T = S.three; if (!T) return; T.hr = L.hr;
  Object.keys(T.organs).forEach((name) => {
    const st = (a.organs[name] || { status: 'ok' }).status;
    T.organs[name].forEach((m) => { m.material.color.setHex(COLORS[st]); m.material.emissive.setHex(COLORS[st]); m.material.emissiveIntensity = S.selected === name ? 0.95 : 0.45; });
  });
  showOrgan();
}
function showOrgan() {
  const box = $('#organBox'); if (!S.selected || !S.data) return;
  const o = S.data.analysis.organs[S.selected], st = { ok: 'Normal', warn: 'Warning', crit: 'Critical' }[o.status];
  box.innerHTML = `<div><b style="text-transform:capitalize">${esc(S.selected)}</b><span class="st ${o.status}">${st}</span></div><span class="muted">${esc(o.detail)}</span>`;
}

/* ---------------- Boot ---------------- */
window.addEventListener('resize', () => { if (S.data && S.view !== 'profile') render(); });
(async function boot() {
  if (!S.token) return;
  try { const r = await api('/api/auth/me'); S.user = r.user; enterApp(); } catch (e) { logout(); }
})();
