# AI-Powered Human Body Digital Twin — Full-Stack App

Interactive 3D human body + real-time (simulated IoT) vitals + AI health analysis + secure login.
**Zero npm dependencies** — only Node.js built-ins on the backend and Three.js (CDN) on the frontend.

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, vanilla JS, Three.js (3D body), Canvas charts |
| Backend | Node.js (http module) REST API |
| Auth | scrypt password hashing + HMAC-signed tokens, login rate-limit |
| AI/ML | Z-score anomaly detection + least-squares trend + weighted risk score |
| Data | Simulated sensor stream (heart rate, BP, SpO2, temperature, respiration) |

**Demo login:** `demo@twin.com` / `Demo@123` (or create your own account)

## Run locally
```bash
node server.js          # needs Node 18+
# open http://localhost:3000
```

## Deploy on Render (recommended - full app works as-is)
1. Push this folder to a GitHub repository.
2. Render dashboard → **New → Web Service** → connect the repo.
3. Runtime: **Node** · Build command: *(leave empty)* · Start command: `node server.js`
   (or choose **New → Blueprint**; `render.yaml` is already included).
4. Add environment variable `JWT_SECRET` = any long random string.
5. Deploy → open the `.onrender.com` URL.

## Deploy on Vercel
1. Push this folder to GitHub → Vercel → **Add New Project** → import the repo.
2. Framework preset: **Other** · leave build settings empty (uses `vercel.json`, `public/` and `api/`).
3. Add environment variable `JWT_SECRET`. Deploy.
   Or with the CLI: `npm i -g vercel && vercel --prod`

## Important notes
* Accounts are saved in a JSON file. On **Render free** and **Vercel** the disk is temporary, so newly registered
  users may be cleared on restart/redeploy. The **demo account is recreated automatically**, so the project can
  always be shown. For permanent storage, replace the `users` object in `lib/app.js` with MongoDB Atlas / PostgreSQL.
* Sensor data is simulated (matches the "initially built with sample/simulated data" objective). Use the
  scenario buttons (Normal / Stress / Low O₂ / Fever) to demonstrate AI alerts and the organs changing colour.
* Educational project — not a medical device or diagnosis.

## Project structure
```
server.js            local/Render entry (static files + API)
lib/app.js           all API logic: auth, profile, vitals simulation, AI analysis
api/[...path].js     Vercel serverless entry (re-uses lib/app.js)
public/              index.html, style.css, app.js (UI + 3D twin)
render.yaml          Render blueprint
vercel.json          Vercel config
```

## API
`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `GET/PUT /api/profile` ·
`GET /api/vitals?scenario=normal|stress|hypoxia|fever` · `GET /api/health`
