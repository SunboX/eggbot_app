<!--
SPDX-FileCopyrightText: 2026 André Fiedler

SPDX-License-Identifier: CC-BY-SA-4.0
-->

# Getting Started

## Local run

```bash
npm install
cp .env.example .env
npm start
```

Open [http://localhost:3000/](http://localhost:3000/).

## Typical workflow

1. Pick a preset (`Punkte`, `Strahlen`, `Wabe`, `Wolfszähne`, `Kiefernzweig`, `Feder/Raute`).
2. Adjust symmetry, density, bands, line width, and colors.
3. Click **Re-generate** until you like the design.
4. Rotate and inspect the result on the 3D egg.
5. Save, share, or store locally.
6. Connect EggBot and press **Draw**.

## Browser requirements

- WebGL enabled browser
- Web Serial capable browser (Chromium-based)
- Secure context (`https://` or `http://localhost`)

## Analytics

- The app loads the centralized cookieless tracker from `https://analytics.andrefiedler.de/tracker.js`.
- The public site key is `eggbot_app`.
- Register each deployed browser origin in the Analytics `analytics_sites` table or dashboard before expecting events. The production row should use the deployed app origin and public key `eggbot_app`.

```sql
INSERT INTO analytics_sites (name, allowed_origin, public_key, active, created_at)
VALUES ('EggBot App', 'https://your-eggbot-app-origin.example', 'eggbot_app', 1, UTC_TIMESTAMP());
```
