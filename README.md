# Local Area Problem Reporter (v2.0)

A secure civic-issue portal. Citizens report local problems with a **photo and location**; an **AI/ML layer**
analyses the photo and text; the administrator must upload **resolution evidence** (an after-work photo)
before a report can be marked *Resolved*.

## What is new in v2.0
| Feature | How it works |
|---|---|
| AI photo analysis | MobileNetV2 (TensorFlow.js) runs in the browser, detects what the photo shows and suggests a category (`public/js/ai.js`). |
| AI text analysis | Naive Bayes classifier suggests the category, keyword model predicts priority (Low/Normal/High/Critical), TF-IDF cosine similarity flags duplicates (`ai.js`). |
| Location access | When a photo is added the browser asks for location permission, stores latitude/longitude and fills the place name (OpenStreetMap). |
| Admin resolution evidence | `POST /api/reports/:id/evidence` – admin uploads an after-photo (+ note, GPS). The server **refuses** `Resolved` without it. AI compares before/after photos and the distance of the evidence from the reported spot is stored. |
| Works on any PC / phone | Responsive pages, listens on `0.0.0.0`, proxy-aware, ready-made deployment files for a public https link. |

## 1. Run on your computer
```bash
npm install
npm run create-admin        # creates the administrator account (once)
npm start
```
Open `http://localhost:3000`. The console also prints a **Same Wi-Fi** link (e.g. `http://192.168.1.5:3000`) that phones on the same network can open.

## 2. Get a public link (no `localhost`) – anyone, any device
Location access (and the camera/photo features on phones) only work on **https**, so deploy to a host that gives an https address.

### Option A – Render.com (free, recommended)
1. Create a GitHub repository and push this folder (the `data/*.json` files are ignored by `.gitignore`).
2. On https://render.com choose **New + → Blueprint**, select the repository. `render.yaml` is picked up automatically.
3. When asked, enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` (10+ characters). The administrator account is created on first start.
4. After the build finishes you get a link like `https://local-area-problem-reporter.onrender.com` – share it with anyone.
   * You can rename the service in the dashboard, or attach your own domain under *Settings → Custom Domains*.
   * Free instances sleep after inactivity (first visit takes ~30 s) and their disk is **temporary**. For permanent data add a Render *Disk* mounted at `/var/data` and set `DATA_DIR=/var/data`, or later move to a database.

### Option B – Docker (any cloud / VPS)
```bash
docker build -t lapr .
docker run -p 3000:3000 -e SESSION_SECRET=long-random-text -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=ChangeMe12345 -v lapr-data:/app/data lapr
```

### Option C – Temporary public link for a demo
Run the app and use a tunnel such as `npx cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`. The link works only while your computer and the tunnel are running.

## Environment variables
`PORT`, `SESSION_SECRET`, `NODE_ENV=production`, `DATA_DIR`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PUBLIC_URL` (see `.env.example`).

## Tests
`npm test` runs unit tests for the AI module and the data layer. `npm run check` checks the syntax of all scripts.

## Notes
* The browser downloads TensorFlow.js and MobileNet from a CDN the first time a photo is analysed (internet needed). If it cannot load, the form still works without AI.
* The AI suggestions are advisory. MobileNet is a general image model (ImageNet), not trained on civic data – fine-tuning is listed as future work.
* Sessions are kept in memory; users sign in again after a server restart.
