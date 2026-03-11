# EggBot WiFi Relay Design

Status: approved

Date: 2026-03-11

## Summary

The existing direct browser-to-device Wi-Fi transport is replaced with a PHP-safe relay that runs on shared hosting. The browser never opens a WebSocket to the EggDuino. Instead, the browser talks to a same-origin PHP endpoint, the EggDuino polls the same PHP endpoint for work, and SQLite stores presence, sessions, queued commands, and recent results.

This design exists because All-Inkl shared hosting cannot run a persistent WebSocket server process. The relay preserves the user-visible workflow:

- choose `WiFi` next to `Serial` and `BLE`
- enter the Tasmota-style chip ID
- show `connected` only after a live round-trip to the device succeeds
- otherwise show the last connection timestamp when the device is known
- otherwise show `could not connect`
- route draw commands through the server to the device
- drop back to `disconnected` when the device stops responding

## Constraints

- Production must run on the existing All-Inkl PHP shared-hosting setup.
- No long-running server-side WebSocket process is available.
- The user-facing device identifier is the Tasmota-style chip ID derived from the lower 24 bits of the ESP32 efuse MAC.
- The firmware may store a pre-shared device secret.
- Server-side persistence uses SQLite.
- Frontend behavior must fit the existing `EggBotTransportController` and draw pipeline.

## Goals

- Add a third connection transport called `WiFi`.
- Allow the browser to target an EggDuino by chip ID.
- Authenticate the EggDuino without exposing the device secret to the browser.
- Confirm a live back channel before reporting `connected`.
- Queue draw and manual commands through the relay while the device is online.
- Preserve existing Serial and BLE behavior.
- Document the firmware-side client contract in Markdown.

## Non-Goals

- Running a real WebSocket server on shared hosting.
- Browser-to-device direct LAN connections by host or IP.
- End-user pairing flows that require entering the device secret into the browser on each connection.

## Recommended Approach

Use short-poll HTTPS relay with `chip_id + pre-shared secret` authentication.

- The browser identifies the target device only by chip ID.
- The EggDuino authenticates to the server with HMAC signatures derived from its stored secret.
- The browser creates a short-lived relay session, asks the server to probe the device, and waits for probe acknowledgement.
- The EggDuino polls for work, executes commands, and posts acknowledgements.

This keeps the UX simple while preventing device impersonation based on chip ID alone.

## Architecture Overview

### Actors

- Browser frontend
- PHP relay endpoint
- SQLite database
- EggDuino firmware client

### High-Level Flow

1. The user selects `WiFi`, enters a chip ID, and clicks connect.
2. The browser calls `client_connect`.
3. The server creates a browser session, queues a probe command, and waits briefly for a matching acknowledgement.
4. The EggDuino polls `device_poll`, receives the probe command, executes it, and posts `device_ack`.
5. The server marks the session as live.
6. The browser shows `connected`.
7. During draw and manual control, the browser queues EBB commands through the same session.
8. If device freshness expires or command acknowledgement stops, the frontend transport switches back to `disconnected`.

## Data Model

### `devices`

Tracks device identity and latest presence metadata.

- `chip_id`
- `device_secret_hash`
- `last_seen_at`
- `last_ip`
- `last_user_agent`
- `last_status`
- `last_version`
- `last_error`
- `connected_session_id`
- `updated_at`

### `device_sessions`

Tracks one browser-side connection attempt and its liveness window.

- `session_id`
- `chip_id`
- `created_at`
- `expires_at`
- `last_probe_sent_at`
- `last_probe_ack_at`
- `last_command_seen_at`
- `closed_at`

### `device_commands`

Tracks queued probe, manual, and draw commands.

- `id`
- `chip_id`
- `session_id`
- `command_text`
- `command_kind`
- `status`
- `response_text`
- `created_at`
- `delivered_at`
- `acked_at`
- `expires_at`

### `device_events`

Append-only event log for traceability.

- `id`
- `chip_id`
- `session_id`
- `event_kind`
- `payload_json`
- `created_at`

## HTTP API

All actions are served through one same-origin endpoint, for example:

- `POST /api/eggbot-relay.php?action=client_connect`
- `POST /api/eggbot-relay.php?action=client_poll`
- `POST /api/eggbot-relay.php?action=client_disconnect`
- `POST /api/eggbot-relay.php?action=client_queue_command`
- `POST /api/eggbot-relay.php?action=device_poll`
- `POST /api/eggbot-relay.php?action=device_ack`

### Browser actions

#### `client_connect`

Input:

- `chipId`

Behavior:

- validates chip ID
- creates a short-lived session
- queues a probe command
- waits for probe acknowledgement for a bounded window
- returns one of:
  - `connected`
  - `last_seen`
  - `could_not_connect`

#### `client_poll`

Returns current session status and the latest device freshness information.

#### `client_disconnect`

Closes the current browser session without deregistering the device.

#### `client_queue_command`

Queues one EBB command for the active session and chip ID.

### Device actions

#### `device_poll`

Input:

- `chipId`
- `timestamp`
- `nonce`
- `signature`
- optional firmware metadata

Behavior:

- authenticates the device
- updates `last_seen_at`
- returns pending commands in FIFO order

#### `device_ack`

Input:

- authenticated device envelope
- one or more command results
- optional latest device status/version

Behavior:

- marks commands as acknowledged or failed
- updates device/session liveness
- records recent version or error text

## Connection Semantics

### Connected

Show `connected` only when the frontend session receives a live probe acknowledgement from the requested chip ID within the connect timeout.

### Last connected

If live probe acknowledgement fails but the server has a known `last_seen_at` for the chip ID, show the timestamp of that last server-side device contact.

### Could not connect

If there is no live probe acknowledgement and no useful known device record, show `could not connect`.

### Disconnected

If the device stops polling, a session freshness window expires, or queued commands time out during a draw, the WiFi transport drops back to `disconnected`.

## Frontend Integration

### Transport changes

- Add `wifi` to `EGGBOT_TRANSPORTS`.
- Replace the current direct-host Wi-Fi behavior in `src/EggBotWifi.mjs` with relay-backed `fetch` requests.
- Keep the transport interface compatible with the existing controller:
  - `connect`
  - `connectForDraw`
  - `disconnect`
  - `sendCommand`
  - `drawStrokes`

### UI changes

- Add `WiFi` as a third transport option in the machine panel.
- Replace the current Wi-Fi host/port fields with a chip-ID field for relay mode.
- Keep draw/manual control buttons unchanged.
- Surface relay-specific statuses in the existing status area.

### Persisted state

`drawConfig` gains:

- `connectionTransport: 'serial' | 'ble' | 'wifi'`
- `wifiChipId: string`

Legacy `wifiHost`, `wifiPort`, and `wifiSecure` may remain readable for compatibility but are not used by the relay workflow.

### WebMCP

Update tool schemas and state patching to accept:

- `connectionTransport: 'wifi'`
- `wifiChipId`

## Authentication

The chip ID is only the routing key. Device trust comes from an HMAC signature built from a pre-shared device secret.

Recommended signed fields:

- `chipId`
- `timestamp`
- `nonce`
- SHA-256 of the raw JSON body payload

The server rejects:

- unknown devices
- signature mismatch
- timestamp skew outside the allowed window
- replayed nonces

The browser never sends or stores the device secret.

## EggDuino Client Contract

### Stored configuration

- relay base URL
- `chipId`
- device secret
- firmware version

### Polling behavior

- idle poll: about every 1500 ms
- active draw poll: about every 200 ms
- network failure backoff: exponential up to about 10000 ms

### Command execution

- process commands in order
- acknowledge each command with success or error text
- include the current firmware version when available

### Startup behavior

- authenticate immediately after Wi-Fi comes up
- accept a probe command so browser connect can succeed

## Failure Handling

- Missing chip ID in browser: validation error before connect.
- Offline but known device: return `last_seen_at`.
- Device auth failure: record event and reject the request.
- Device lost mid-draw: fail the active command, flip transport to disconnected, and preserve resume checkpoint when possible.
- Stale acknowledgements from an old session: ignore them by `session_id`.

## Testing Strategy

### Frontend tests

- transport normalization and persistence
- WiFi relay connect success
- fallback to last-seen state
- connect failure without live probe
- command round-trip waiting
- disconnect detection during draw
- WebMCP schema acceptance of `wifi` and `wifiChipId`

### PHP integration tests

Run from `npm test` by spawning a temporary PHP built-in server and a temp SQLite database:

- `client_connect` queues a probe
- `device_poll` returns the probe
- `device_ack` marks the session connected
- queued commands are delivered in order
- stale or expired sessions return disconnected state

### Verification

- `npm test`
- `php -l` across new PHP files

## Deployment Notes

- Keep SQLite outside the web root when possible, or deny direct access explicitly.
- Add configurable env values for database path, clock skew window, session TTL, command TTL, and connect timeout.
- Use same-origin requests from the frontend to avoid CORS complexity.

## Open Implementation Notes

- Local `npm start` development may need either a PHP sidecar or a friendly Node-side 501/proxy response for `/api/eggbot-relay.php`.
- Existing direct WebSocket Wi-Fi examples become historical references only and should be updated or clearly marked as legacy.
