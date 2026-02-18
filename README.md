# EggBot App - Sorbische Eier Werkstatt

Web-based generator for Sorbian-style Easter egg decorations with:

Live app: [https://eggbot.app/](https://eggbot.app/)

- configurable motifs and complexity
- configurable color count and palette
- deterministic auto-generation with seed control
- adjustable drawable zone (safe top/bottom margins)
- project save/load/share
- SVG export of current visible pattern
- local project storage
- rotatable 3D egg preview
- direct EggBot drawing via Web Serial (EBB command stream)

## Project Structure

- `src/`: frontend app and local Node server
- `api/`: PHP backend endpoint for All-Inkl style hosting
- `docs/`: usage and architecture docs
- `tests/`: unit tests for core generators and URL utilities
- `sorbische_muster/`: source material provided in this thread

## Run Locally

```bash
npm install
cp .env.example .env
npm start
```

Open [http://localhost:3000/](http://localhost:3000/).

## Core Workflow

1. Select a pattern preset.
2. Adjust settings and color palette.
3. Re-generate until design fits.
4. Adjust pattern height/drawable zone for your egg geometry.
5. Inspect the texture on the 3D egg.
6. Save/store/share project or export SVG.
7. Connect EggBot and draw.

## EggBot Notes

- Uses Web Serial API in browser.
- Uses EBB commands `SC`, `SP`, `EM`, and `SM`.
- Calibrate `servo up/down` values and motion mapping before production runs.
- Start with test eggs and simple patterns.

## Local Node Server

`src/server.mjs` serves:

- static app files
- `/node_modules` for import map modules
- `/docs` static docs
- optional `/api/chat` endpoint (OpenAI Responses API)

## PHP Backend (All-Inkl)

Use `api/chat.php` when deploying on shared hosting with PHP.

Environment expected:

- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`
- optional docs-context settings from `.env.example`

## Test

```bash
npm test
```
# eggbot_app
