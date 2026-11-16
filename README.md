# WASHELA (وصلها) — Freelance Courier & Delivery Platform

**WASHELA** is a complete, production-ready freelance parcel and item delivery platform designed for shops, restaurants, individuals, couriers, and administrators. It connects three dedicated applications to a unified Node.js/Express backend API, persistent JSON database (`data/waselha-db.json` + automatic snapshots), and Firebase Authentication/Firestore synchronization.

---

## Applications Included

1. **WASELHA CUSTOMER (`/customer`, Android: `iq.waselha.customer`)**
   - Freelance delivery order creation for shops, restaurants, and individuals
   - Interactive Google Maps pickup & dropoff pin selection + address search
   - Live dynamic delivery fee quote calculated from Manager-controlled zones, inter-zone route matrix, and long-distance rules before order confirmation
   - Real-time order tracking (`SSE`) and courier status updates
2. **WASELHA DRIVER (`/driver`, Android: `iq.waselha.driver`)**
   - Courier registration & secure login
   - Live incoming delivery orders feed with pickup/dropoff coordinates and delivery fee preview
   - Accept / reject orders, step-by-step status progression (`picked_up` → `on_the_way` → `delivered`)
   - Automatic earnings calculation (75% courier share / 25% platform commission) and order history
3. **WASELHA MANAGER (`/manager`, Android: `iq.waselha.manager`)**
   - Super Admin dashboard with scrypt-hashed password authentication and HMAC-signed sessions
   - Full dynamic control over delivery zones (create, rename, edit fees, toggle coverage, delete)
   - Zone-to-zone route pricing table (`ZoneRouteRate`) and long-distance fee rules
   - Order, courier, user, pricing settings, and database backup/restore management

---

## Project Structure

```text
WASHELA/
├── server.ts                    # Express API server, Auth/RBAC, pricing engine, SSE, static/downloads host
├── index.html                   # SPA HTML shell (RTL Arabic)
├── vite.config.ts               # Multi-target Vite + PWA config (hub, customer, driver, manager)
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies and build/dev/start scripts
├── eslint.config.js             # ESLint & Firebase security rules linter config
├── capacitor.config.ts          # Root Capacitor reference config
├── metadata.json                # App metadata and capabilities
├── .env.example                 # Safe environment variables template (no secrets)
├── .gitignore                   # GitHub-ready ignore rules
├── firebase-applet-config.json  # Firebase project & Firestore DB client configuration
├── firebase-blueprint.json      # Firestore schema blueprint
├── firestore.rules              # Hardened Firestore security rules
├── security_spec.md             # Security specification and test invariants
├── data/
│   ├── waselha-db.json          # Persistent database (users, drivers, zones, routeRates, orders, settings)
│   └── backups/                 # Timestamped JSON database snapshots
├── public/                      # PWA icons & manifests (manifest-customer.json, manifest-driver.json, manifest-manager.json)
├── mobile/                      # Android Capacitor configs & pure Android SDK 34 APK builder (build-apks.sh)
├── dist-customer/               # Built Customer app bundle (/customer/)
├── dist-driver/                 # Built Driver app bundle (/driver/)
├── dist-manager/                # Built Manager app bundle (/manager/)
└── src/
    ├── App.tsx                  # Root router & Hub / Customer / Driver / Manager shell
    ├── main.tsx                 # React entry point
    ├── index.css                # Tailwind CSS v4 styles
    ├── types.ts                 # Shared domain types & zone pricing calculation engine
    ├── firebase.ts              # Firebase App, Auth, and Firestore initialization
    ├── components/
    │   ├── CustomerSection.tsx  # Customer & Shops workflow
    │   ├── DriverSection.tsx    # Courier workflow & earnings
    │   ├── AdminSection.tsx     # Super Admin manager control panel
    │   ├── GoogleMapsView.tsx   # Google Maps interactive picker & route view
    │   └── SplashScreen.tsx     # Branded splash screen
    ├── services/
    │   ├── api.ts               # Same-origin & mobile HTTP API client
    │   └── firestoreSync.ts     # Firestore synchronization helpers
    ├── hooks/
    │   └── usePWAInstall.tsx    # Offline indicator & PWA install handler
    └── utils/
        └── orderStatus.ts       # Localized Arabic order status & role labels
```

---

## Prerequisites

- **Node.js** `>= 22.18.0` (recommended: Node 22 LTS, supports native TypeScript execution for `node server.ts`; or use `npx tsx server.ts`)
- **npm** `>= 10` (or **bun**)
- *(Optional, for rebuilding signed Android APKs)* **JDK 17** and **Android SDK 34** (`build-tools;34.0.0`)

---

## Local Installation & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your real `GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `APP_URL`, and a strong random `SESSION_SECRET`.

3. **Run in Development Mode (Frontend + Backend on port 3000):**
   ```bash
   npm run dev
   ```
   - Hub: `http://localhost:3000/`
   - Customer App: `http://localhost:3000/customer`
   - Driver App: `http://localhost:3000/driver`
   - Manager App: `http://localhost:3000/manager`
   - Health Check: `http://localhost:3000/api/health`

4. **TypeScript Check:**
   ```bash
   npm run lint
   ```

---

## Production Deployment (Permanent Server)

1. **Build all four web targets (`dist`, `dist-customer`, `dist-driver`, `dist-manager`):**
   ```bash
   npm run build:all-apps
   ```

2. **Set production environment variables:**
   Ensure `.env` (or your host environment such as Cloud Run, Railway, Render, Fly.io, or VPS systemd/PM2) sets:
   - `NODE_ENV=production`
   - `PORT=3000` (or platform-assigned port)
   - `SESSION_SECRET=<strong-random-64-char-hex-secret>`
   - `APP_URL=https://your-domain.com`
   - `GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>`
   - `VITE_GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>`

3. **Start the production server:**
   ```bash
   NODE_ENV=production npm start
   ```
   Or with PM2 on a Linux VPS:
   ```bash
   NODE_ENV=production pm2 start "npx tsx server.ts" --name waselha-server
   ```

4. **Database Persistence Note:**
   Persist the `data/` directory across deployments (e.g., mounted volume on `/app/data`) so `data/waselha-db.json`, `data/backups/`, and `data/uploads/` survive container restarts, alongside your Firebase Firestore rules deployed via Firebase CLI (`firebase deploy --only firestore:rules`).

---

## Uploading to GitHub & Deploying to Vercel

This project includes `vercel.json`, `api/index.ts`, `.gitignore`, and `.env.example` so you can push directly to GitHub and deploy to Vercel with one click:

1. **Upload to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "WASHELA ready for GitHub and Vercel"
   git branch -M main
   git remote add origin https://github.com/<your-username>/WASHELA.git
   git push -u origin main
   ```

2. **Deploy on Vercel:**
   - Go to [vercel.com/new](https://vercel.com/new) and import your `WASHELA` GitHub repository.
   - Vercel automatically reads `vercel.json`:
     - Build Command: `npm run build:vercel`
     - Output Directory: `dist`
     - Serverless API Function: `api/index.ts` (`/api/*`, `/uploads/*`, `/downloads/*`)
   - Under **Settings → Environment Variables**, add:
     - `SESSION_SECRET`: random 64-character secret
     - `GOOGLE_MAPS_API_KEY`: your Google Maps API Key
     - `VITE_GOOGLE_MAPS_API_KEY`: your Google Maps API Key
     - `APP_URL`: your `https://<your-app>.vercel.app` URL
   - Click **Deploy**. After deployment:
     - Main Hub: `https://<your-app>.vercel.app/`
     - Customer App: `https://<your-app>.vercel.app/customer`
     - Driver App: `https://<your-app>.vercel.app/driver`
     - Manager App: `https://<your-app>.vercel.app/manager`

> **Note for Vercel Serverless Storage:** Vercel serverless functions store runtime writes inside `/tmp/waselha-data` seeded from `data/waselha-db.json`, which resets on cold starts. For permanent database persistence across Vercel serverless cold starts, keep Firebase Firestore active (already configured in `src/firebase.ts` and `firestore.rules`) or host the Node server on a persistent Node host like **Railway**.

---

## Deploying to Railway (Permanent Cloud Server + Database)

This repository includes `railway.json` and `Procfile` so Railway automatically builds all 4 targets (`npm run build:all-apps`) and launches `server.ts` on `process.env.PORT` instead of static-only hosting:

1. Push the repository to GitHub.
2. In Railway, connect your GitHub repository.
3. Add environment variables in Railway **Variables**:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<random-64-char-hex-secret>`
   - `GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>`
   - `VITE_GOOGLE_MAPS_API_KEY=<your-google-maps-api-key>`
   - `APP_URL=https://wsse-production.up.railway.app`
4. Mount a Railway **Volume** at `/app/data` (or `<workdir>/data`) so `waselha-db.json`, `backups/`, and `uploads/` persist across redeployments.
5. Verify `/api/health`, `/`, `/customer`, `/driver`, and `/manager` all return HTTP `200`.

---

## Backup Recovery Notes

- **Recovered directly from `waselha-project-backup.tar.gz`**: `server.ts`, `src/**`, `public/**`, `mobile/**`, `data/waselha-db.json`, `data/backups/**`, `dist-customer/**`, `dist-driver/**`, `dist-manager/**`, `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `metadata.json`, `firebase-applet-config.json`, `firebase-blueprint.json`, `firestore.rules`, `security_spec.md`.
- **Included project files & GitHub preparation**: `eslint.config.js`, `capacitor.config.ts`, `bun.lock`, `.gitignore`, `.env.example`, and this `README.md`.
- **Excluded intentionally for security**: `data/.session-secret`, any local `.env` files, `node_modules/`, and `.gmp_cache/`.
