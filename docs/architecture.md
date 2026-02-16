# Architecture

## Frontend modules

- `src/main.mjs`: app controller and UI event orchestration.
- `src/PatternGenerator.mjs`: deterministic stroke generation.
- `src/PatternRenderer2D.mjs`: texture rendering on 2D canvas.
- `src/EggScene.mjs`: Three.js 3D egg preview and orbit controls.
- `src/EggBotSerial.mjs`: Web Serial command streaming for EggBot EBB.
- `src/ProjectIoUtils.mjs`: project normalization and serialization.
- `src/ProjectUrlUtils.mjs`: share URL encoding/decoding.

## Backends

- Local Node backend: `src/server.mjs` (static hosting + optional `/api/chat`).
- Shared-hosting PHP backend: `api/chat.php` (All-Inkl compatible endpoint).

## Data flow

1. User edits settings.
2. Generator produces stroke list.
3. 2D renderer draws texture map.
4. 3D renderer applies texture to egg mesh.
5. Optional draw run streams commands to EggBot via Web Serial.
