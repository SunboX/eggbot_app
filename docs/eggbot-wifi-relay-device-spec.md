# EggDuino WiFi Relay Client Specification

Status: draft for implementation

Date: 2026-03-11

## Purpose

This document specifies the EggDuino firmware client that communicates with the EggBot App through the PHP relay hosted on the same website. The relay uses HTTPS polling, not WebSockets.

## Terminology

- `chipId`: upper-case hexadecimal string built from the lower 24 bits of the ESP32 efuse MAC
- `device secret`: pre-shared secret stored on the EggDuino and known to the server
- `sessionId`: browser connection session created by the relay for one connect attempt
- `commandId`: unique queued command identifier created by the relay

## Device Identity

The firmware must derive and store a six-character upper-case hexadecimal chip ID.

Example:

```text
8FA12C
```

The chip ID is used for routing and display. It is not sufficient for authentication by itself.

## Stored Configuration

The firmware must persist:

- relay base URL, for example `https://eggbot.app/api/eggbot-relay.php`
- `chipId`
- device secret
- optional firmware version string
- Wi-Fi credentials

## Authentication

Every device-originated request must include:

- `chipId`
- `timestamp`
- `nonce`
- `signature`

The signature must be:

```text
hex(hmac_sha256(deviceSecret, chipId + "\n" + timestamp + "\n" + nonce + "\n" + sha256(rawJsonBody)))
```

### Timestamp

- Format: ISO 8601 UTC, for example `2026-03-11T12:34:56Z`
- The firmware clock does not need to be perfect, but it should stay within the server skew window.

### Nonce

- At least 16 random bytes, hex-encoded
- Must be unique per request

## Endpoint

All requests use the same endpoint with an action query parameter.

```text
POST /api/eggbot-relay.php?action=device_poll
POST /api/eggbot-relay.php?action=device_ack
```

Content type:

```text
application/json
```

## Request and Response Shapes

### `device_poll`

Request body:

```json
{
  "chipId": "8FA12C",
  "timestamp": "2026-03-11T12:34:56Z",
  "nonce": "2a4f9d1b6c9e4c4e9bb8f5d2b2f23d1f",
  "signature": "3b0d...",
  "firmwareVersion": "1.0.0",
  "deviceStatus": {
    "machineState": "idle",
    "error": ""
  }
}
```

Successful response body:

```json
{
  "ok": true,
  "chipId": "8FA12C",
  "serverTime": "2026-03-11T12:34:56Z",
  "pollAfterMs": 1500,
  "commands": [
    {
      "commandId": 17,
      "sessionId": "sess_01JQ...",
      "commandKind": "probe",
      "commandText": "v",
      "expiresAt": "2026-03-11T12:35:06Z"
    }
  ]
}
```

Behavior:

- The firmware must process commands in the order returned.
- If `commands` is empty, the firmware waits for `pollAfterMs` before the next poll.
- While a draw is active or commands are being consumed, the firmware may clamp `pollAfterMs` to a faster local interval.

### `device_ack`

Request body:

```json
{
  "chipId": "8FA12C",
  "timestamp": "2026-03-11T12:34:57Z",
  "nonce": "6f4b0f2c1d2e95e1f7d81c2a1b9955a7",
  "signature": "f6b8...",
  "results": [
    {
      "commandId": 17,
      "sessionId": "sess_01JQ...",
      "status": "ok",
      "responseText": "EBBv13.0"
    }
  ],
  "deviceStatus": {
    "machineState": "idle",
    "error": ""
  },
  "firmwareVersion": "1.0.0"
}
```

Successful response body:

```json
{
  "ok": true,
  "chipId": "8FA12C",
  "serverTime": "2026-03-11T12:34:57Z",
  "pollAfterMs": 1500
}
```

## Polling Cadence

Recommended intervals:

- startup reconnect: poll immediately after Wi-Fi comes up
- idle: 1000 to 1500 ms
- active command stream: 150 to 300 ms
- repeated network failures: exponential backoff up to 10000 ms

The firmware should jitter its next poll slightly to avoid synchronized bursts.

## Command Handling

### Supported relay command kinds

- `probe`
- `manual`
- `draw`

### Execution rules

- Execute commands strictly in order.
- Stop executing further commands if local transport to the EggDuino core is unavailable.
- Preserve the server-provided `sessionId` and `commandId` in the acknowledgement.
- If the command expires before execution starts, skip it locally and acknowledge with:
  - `status: "expired"`

### Response text

`responseText` should contain the raw EBB response when meaningful.

Examples:

- `EBBv13.0`
- `OK`
- `ERR: timeout`

## Connection Semantics

The browser only shows `connected` after a probe command completes successfully for the active `sessionId`.

Firmware requirements:

- accept probe commands even when otherwise idle
- return the normal version response for `v`
- keep polling while connected so the browser can detect freshness

## Error Handling

### Authentication failure

- If the server returns `401` or `403`, log locally and back off before retrying.
- Do not clear the stored chip ID or secret automatically.

### Temporary server or network failure

- Treat `5xx`, DNS failure, or timeout as temporary.
- Retry with exponential backoff.

### Command execution failure

If a command cannot be executed:

- send `status: "error"`
- include a short machine-readable or operator-readable `responseText`

## Version Reporting

The firmware should send `firmwareVersion` when available. The relay may surface the last known version to the browser when showing last-seen device information.

## Recommended Main Loop

```text
boot
  -> connect Wi-Fi
  -> derive chipId
  -> load device secret
  -> start poll loop

poll loop
  -> POST device_poll
  -> for each returned command:
       execute command against local EggDuino logic
       POST device_ack with result
  -> sleep for pollAfterMs or local active interval
```

## Security Notes

- Never expose the device secret over BLE, serial console, or the browser.
- Generate a fresh nonce for every request.
- Use TLS in production.
- Reject or rotate compromised device secrets server-side.

## Compatibility Notes

- The browser-facing identifier is always the Tasmota-style chip ID.
- The relay does not require the browser to know the device secret.
- This spec intentionally replaces the old direct WebSocket Wi-Fi model.
