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
- direct EggBot drawing via Web Serial or BLE (EBB command stream)
- v281-aligned SVG import and draw behavior (96dpi units, compact segments, resume checkpoints)
- WebMCP tool surface with full imperative and declarative coverage
- worker-backed compute/render/import/draw-prep paths with automatic fallback

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

- Supports Web Serial and Web Bluetooth (BLE) transport modes.
- Uses EBB commands `SC`, `SP`, `EM`, `SM`, and `QB`.
- Calibrate `servo up/down` values and motion mapping before production runs.
- Draw stream follows the EggBot extension v281 structure (`SP` with delay argument, `SM` move timing from diagonal distance, `QB` polling after moves, `SM,10,0,0` tail wait).
- Runtime defaults for extension-like behavior: `reversePenMotor=true`, `reverseEggMotor=true`, `penUpSpeed=400`, `penDownSpeed=300`, `penRaiseDelayMs=200`, `penLowerDelayMs=400`, `returnHome=true`.
- BLE debug mode on localhost: append `?bleDebugScan=1&bleDebugLog=1` to show all nearby BLE devices and print staged logs in DevTools.
- Start with test eggs and simple patterns.

## WebMCP Notes

- The frontend exposes app functionality through `navigator.modelContext` tools.
- Runtime is native-first with `@mcp-b/global` fallback bridge loaded from `/node_modules/@mcp-b/global/dist/index.iife.js`.
- Bridge transport is enabled with wildcard origins (`allowedOrigins: ['*']`).
- Dangerous actions (`serial connect/disconnect/draw/stop`, local delete) require `confirm: true`.
- Content-based tools are provided for project JSON, share URL, and SVG export (no file-picker requirement).
- Declarative forms are provided for all WebMCP operations (state reads, design/color/motif/draw config patches, import/export, local storage actions, machine actions, and locale updates).
- Declarative form fields include `toolparamdescription` metadata to improve generated schema quality for agents.
- `inkscapeSvgCompatMode` is accepted for backward compatibility in WebMCP/project payloads but is now a deprecated no-op (v281 behavior is always active).
- Chrome WebMCP early-preview reference was updated on **February 10, 2026** and documents the experimental native API behind `chrome://flags/#enable-webmcp-testing`.

## Project Format Notes

- Project JSON now uses `schemaVersion: 2`.
- Schema v2 adds persistent `resumeState`, so paused draw checkpoints survive save/load/share flows.
- Imported SVG parse results also track document pixel size metadata (`documentWidthPx`, `documentHeightPx`) based on SVG units converted to `px@96dpi`.
- `importHeightScale` remains available as an extra scale factor and defaults to `1.0`.

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
