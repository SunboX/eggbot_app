# Architecture

## Frontend modules

- `src/main.mjs`: app controller and UI event orchestration.
- `src/PatternGenerator.mjs`: deterministic stroke generation.
- `src/PatternRenderer2D.mjs`: texture rendering on 2D canvas.
- `src/EggScene.mjs`: Three.js 3D egg preview and orbit controls.
- `src/EggBotSerial.mjs`: Web Serial command streaming for EggBot EBB.
- `src/ProjectIoUtils.mjs`: project normalization and serialization.
- `src/ProjectUrlUtils.mjs`: share URL encoding/decoding.
- `src/WebMcpBridge.mjs`: WebMCP tool registration and declarative form adapters.
- `src/PatternComputeWorkerClient.mjs`: worker transport for generated-stroke compute and SVG export string build.
- `src/PatternRenderWorkerClient.mjs`: worker transport for OffscreenCanvas texture rasterization.
- `src/EggBotPathWorkerClient.mjs`: worker transport for EggBot draw-path preprocessing.

## Backends

- Local Node backend: `src/server.mjs` (static hosting + optional `/api/chat`).
- Shared-hosting PHP backend: `api/chat.php` (All-Inkl compatible endpoint).

## Worker boundaries

- Main thread:
    - DOM updates, file pickers, clipboard, localStorage.
    - Three.js scene rendering in `src/EggScene.mjs`.
    - Web Serial command I/O in `src/EggBotSerial.mjs`.
- Compute/export worker:
    - `src/workers/pattern-compute.worker.mjs` runs generated-pattern math and SVG export string build.
- Render worker:
    - `src/workers/pattern-render.worker.mjs` owns OffscreenCanvas texture rasterization when supported.
    - Falls back to main-thread `PatternRenderer2D` when worker path is unavailable or fails.
- Import worker:
    - `src/workers/pattern-import.worker.mjs` parses imported SVG files.
- EggBot path worker:
    - `src/workers/eggbot-path.worker.mjs` preprocesses UV strokes into step-space draw paths.
    - Command streaming still runs on main thread.

## WebMCP integration

- Runtime bootstrap is in `src/index.html`.
- `window.__webModelContextOptions` configures `transport.tabServer.allowedOrigins = ['*']`.
- `@mcp-b/global` IIFE initializes `navigator.modelContext` for native-first/fallback usage.
- Imperative tool coverage is registered from `src/WebMcpBridge.mjs` against command callbacks in `src/main.mjs`.
- Declarative forms are present in `src/index.html` and wired through submit handlers in `src/WebMcpBridge.mjs`.
- Tool responses follow a normalized contract:
    - `content`
    - `structuredContent` with `{ ok, action, message, data?, state? }`
    - `isError` for failures and confirmation refusals
- `inkscapeSvgCompatMode` remains in tool schemas as a deprecated compatibility input and does not switch runtime draw mode.

## Data flow

1. User edits settings.
2. Generator/import parser produces stroke list (worker-backed where available).
3. Texture renderer rasterizes 2D texture map (worker-backed OffscreenCanvas with fallback).
4. 3D renderer applies texture to egg mesh.
5. Optional draw run preprocesses path geometry (worker-backed with fallback) and streams commands to EggBot via Web Serial.
6. Optional WebMCP clients call imperative/declarative tools through `navigator.modelContext`.

Persistence detail:

- Project payloads use `schemaVersion: 2` and can include `resumeState` draw checkpoints.
- Imported SVG metadata tracks document dimensions in pixels (`documentWidthPx`, `documentHeightPx`) for v281-aligned step mapping.
