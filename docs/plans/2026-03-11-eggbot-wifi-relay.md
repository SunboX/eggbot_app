# EggBot WiFi Relay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a PHP-hosted WiFi relay transport that lets the browser target an EggDuino by Tasmota-style chip ID, verify a live back channel, queue draw/manual commands through SQLite-backed polling endpoints, and document the firmware client contract.

**Architecture:** The frontend keeps the existing transport abstraction but replaces direct WebSocket WiFi with a relay-backed `fetch` transport. The browser creates a short-lived session via PHP, the EggDuino authenticates with `chipId + HMAC(secret)` and polls for commands, and SQLite stores device presence, sessions, queued commands, and acknowledgements.

**Tech Stack:** Browser ESM, existing app controller modules, Node test runner, PHP 8.x shared-hosting endpoint, SQLite, `fetch`, same-origin JSON APIs.

---

### Task 1: Persist WiFi relay settings in app state and WebMCP

**Files:**
- Modify: `src/AppControllerShared.mjs`
- Modify: `src/AppRuntimeConfig.mjs`
- Modify: `src/ProjectIoUtils.mjs`
- Modify: `src/WebMcpBridge.mjs`
- Modify: `tests/project-io-utils.test.mjs`
- Modify: `tests/webmcp-tool-handlers.test.mjs`

**Step 1: Write the failing tests**

Add tests that require `wifi` to be accepted as a connection transport and require a new `wifiChipId` field to be preserved as a trimmed upper-case value.

```js
test('ProjectIoUtils should keep WiFi transport and normalized chip ID', () => {
    const normalized = ProjectIoUtils.normalizeProjectState({
        drawConfig: {
            connectionTransport: 'wifi',
            wifiChipId: ' 8fa12c '
        }
    })

    assert.equal(normalized.drawConfig.connectionTransport, 'wifi')
    assert.equal(normalized.drawConfig.wifiChipId, '8FA12C')
})
```

Add a WebMCP schema test that expects `wifi` in the `connectionTransport` enum and `wifiChipId` in the draw config schema.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/project-io-utils.test.mjs tests/webmcp-tool-handlers.test.mjs
```

Expected:

- FAIL because `wifi` is currently normalized back to `serial`
- FAIL because `wifiChipId` is not part of the current persisted schema

**Step 3: Write minimal implementation**

Update the shared transport constants and persisted defaults.

```js
const EGGBOT_TRANSPORTS = ['serial', 'ble', 'wifi']
```

```js
drawConfig: {
    connectionTransport: 'serial',
    wifiChipId: '',
    baudRate: 115200,
    ...
}
```

Normalize `wifiChipId` in `ProjectIoUtils` with a helper like:

```js
static #normalizeWifiChipId(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^0-9A-F]/g, '')
        .slice(-6)
}
```

Extend both imperative and declarative WebMCP draw-config schemas to accept:

```js
connectionTransport: { type: 'string', enum: ['serial', 'ble', 'wifi'] },
wifiChipId: { type: 'string' }
```

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/project-io-utils.test.mjs tests/webmcp-tool-handlers.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/project-io-utils.test.mjs tests/webmcp-tool-handlers.test.mjs src/AppControllerShared.mjs src/AppRuntimeConfig.mjs src/ProjectIoUtils.mjs src/WebMcpBridge.mjs
git commit -m "feat: persist wifi relay draw settings"
```

### Task 2: Replace direct WebSocket WiFi with relay-backed transport behavior

**Files:**
- Modify: `src/EggBotWifi.mjs`
- Modify: `src/EggBotTransportController.mjs`
- Modify: `tests/eggbot-network-transports.test.mjs`

**Step 1: Write the failing tests**

Replace the current WebSocket-specific tests with relay-specific transport tests that mock `fetch`.

```js
test('EggBotWifi should connect through relay and mark session live after probe', async () => {
    const fetchCalls = []
    globalThis.fetch = async (url, options) => {
        fetchCalls.push({ url, options })
        return new Response(JSON.stringify({
            ok: true,
            status: 'connected',
            sessionId: 'sess_1',
            version: 'EBBv13.0'
        }))
    }

    const wifi = new EggBotWifi()
    const version = await wifi.connect({ chipId: '8FA12C' })

    assert.equal(version, 'EBBv13.0')
    assert.equal(wifi.isConnected, true)
})
```

Add tests for:

- missing chip ID validation
- `connect()` falling back to `last_seen`
- `sendCommand()` waiting for command acknowledgement
- poll loop flipping transport to disconnected on stale status

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/eggbot-network-transports.test.mjs
```

Expected:

- FAIL because `EggBotWifi` still expects a browser WebSocket host/port flow

**Step 3: Write minimal implementation**

Refactor `EggBotWifi` around a same-origin relay API.

```js
async connect(options = {}) {
    const chipId = EggBotWifi.#normalizeChipId(options?.chipId)
    if (!chipId) {
        throw new Error('Wi-Fi chip ID is required.')
    }

    const response = await this.#postAction('client_connect', { chipId })
    this.sessionId = response.sessionId || ''
    this.chipId = chipId
    this.connectionState = response.status || 'disconnected'
    this.lastSeenAt = response.lastSeenAt || ''
    this.version = response.version || 'Connected'
    this.#startSessionPoll()

    if (response.status !== 'connected') {
        throw EggBotWifi.#buildConnectStateError(response)
    }

    return this.version
}
```

Make `sendCommand()` queue one relay command and wait for an acknowledged response:

```js
async sendCommand(command, options = {}) {
    const result = await this.#postAction('client_queue_command', {
        sessionId: this.sessionId,
        chipId: this.chipId,
        commandText: EggBotWifi.#withCommandTerminator(command),
        timeoutMs: Number(options.timeoutMs) || 1200
    })
    return String(result.responseText || '').trim()
}
```

Update `EggBotTransportController` to instantiate and manage the WiFi transport alongside serial and BLE.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/eggbot-network-transports.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/eggbot-network-transports.test.mjs src/EggBotWifi.mjs src/EggBotTransportController.mjs
git commit -m "feat: add relay-backed wifi transport"
```

### Task 3: Wire the WiFi chip-ID UX into the machine panel and controller

**Files:**
- Modify: `src/index.html`
- Modify: `src/AppElements.mjs`
- Modify: `src/AppControllerRender.mjs`
- Modify: `src/AppControllerDraw.mjs`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/de.json`
- Modify: `tests/app-elements.test.mjs`
- Create: `tests/eggbot-wifi-ui-state.test.mjs`

**Step 1: Write the failing tests**

Add a markup test for the new chip-ID input:

```js
assert.ok(elements.wifiChipId)
assert.equal(elements.wifiChipId.getAttribute('data-wifi-chip-id'), '')
```

Add a controller behavior test that expects WiFi transport options to return a chip ID instead of host/port:

```js
test('AppControllerDraw should build WiFi connect options from chip ID', () => {
    const controller = {
        serial: { connectionTransportKind: 'wifi' },
        state: { drawConfig: { wifiChipId: '8FA12C', baudRate: 115200 } }
    }

    const options = AppControllerDraw.prototype._buildTransportConnectOptions.call(controller)
    assert.deepEqual(options, { chipId: '8FA12C' })
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/app-elements.test.mjs tests/eggbot-wifi-ui-state.test.mjs
```

Expected:

- FAIL because there is no chip-ID input and WiFi connect options still assume host/port

**Step 3: Write minimal implementation**

Change the machine panel markup to:

- add `<option value="wifi">WiFi</option>`
- replace WiFi host/port controls with a chip-ID field

```html
<label data-machine-wifi-options hidden>
    <span data-i18n="machine.wifiChipId">EggDuino chip ID</span>
    <input type="text" maxlength="6" autocomplete="off" spellcheck="false" data-wifi-chip-id />
</label>
```

Update `AppElements.query()` with `wifiChipId`.

Update controller logic:

- `_resolveConnectionTransportKind()` accepts `wifi`
- `_buildTransportConnectOptions()` returns `{ chipId }` for WiFi
- `_syncConnectionTransportUi()` shows the chip-ID row only for WiFi
- `_formatTransportLabel()` returns localized `WiFi`
- `_connectSerial()` and draw-time connect keep using the active transport interface

Add new status messages for:

- connected by WiFi
- last seen timestamp fallback
- could not connect

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/app-elements.test.mjs tests/eggbot-wifi-ui-state.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/app-elements.test.mjs tests/eggbot-wifi-ui-state.test.mjs src/index.html src/AppElements.mjs src/AppControllerRender.mjs src/AppControllerDraw.mjs src/i18n/en.json src/i18n/de.json
git commit -m "feat: add wifi chip id connection flow"
```

### Task 4: Add PHP relay handshake, authentication, and SQLite bootstrap

**Files:**
- Create: `api/eggbot-relay.php`
- Create: `api/lib/EggBotRelayConfig.php`
- Create: `api/lib/EggBotRelayDatabase.php`
- Create: `api/lib/EggBotRelayRequest.php`
- Create: `api/lib/EggBotRelayAuth.php`
- Create: `api/lib/EggBotRelayRepository.php`
- Create: `api/lib/EggBotRelayService.php`
- Create: `api/lib/EggBotRelayResponse.php`
- Create: `api/sql/eggbot-relay.sql`
- Create: `tests/eggbot-relay-php.test.mjs`

**Step 1: Write the failing test**

Create a Node integration test that boots a temporary PHP built-in server, points it at a temp SQLite file, and proves that `client_connect` only becomes `connected` after a device probe acknowledgement.

```js
test('relay should mark client session connected after probe ack', async () => {
    const harness = await startPhpRelayHarness()
    const connect = await harness.post('client_connect', { chipId: '8FA12C' })
    assert.equal(connect.status, 'pending')

    const poll = await harness.signedPost('device_poll', { chipId: '8FA12C' })
    assert.equal(poll.commands[0].commandKind, 'probe')

    await harness.signedPost('device_ack', {
        chipId: '8FA12C',
        results: [{ commandId: poll.commands[0].commandId, sessionId: poll.commands[0].sessionId, status: 'ok', responseText: 'EBBv13.0' }]
    })

    const state = await harness.post('client_poll', { sessionId: connect.sessionId, chipId: '8FA12C' })
    assert.equal(state.status, 'connected')
})
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/eggbot-relay-php.test.mjs
```

Expected:

- FAIL because the relay endpoint and helper classes do not exist yet

**Step 3: Write minimal implementation**

Build a small PHP action router and supporting classes.

```php
switch ($action) {
    case 'client_connect':
        $response = $service->clientConnect($request->json());
        break;
    case 'device_poll':
        $response = $service->devicePoll($request->json());
        break;
    case 'device_ack':
        $response = $service->deviceAck($request->json());
        break;
    default:
        $response = EggBotRelayResponse::error(404, 'Unknown action.');
        break;
}
```

Create the SQLite schema with:

- `devices`
- `device_sessions`
- `device_commands`
- `device_events`

Implement HMAC verification in `EggBotRelayAuth.php` and create `client_connect`, `device_poll`, and `device_ack` service methods.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/eggbot-relay-php.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/eggbot-relay-php.test.mjs api/eggbot-relay.php api/lib/EggBotRelayConfig.php api/lib/EggBotRelayDatabase.php api/lib/EggBotRelayRequest.php api/lib/EggBotRelayAuth.php api/lib/EggBotRelayRepository.php api/lib/EggBotRelayService.php api/lib/EggBotRelayResponse.php api/sql/eggbot-relay.sql
git commit -m "feat: add php wifi relay handshake"
```

### Task 5: Add queued command delivery, last-seen fallback, and disconnect semantics

**Files:**
- Modify: `api/eggbot-relay.php`
- Modify: `api/lib/EggBotRelayRepository.php`
- Modify: `api/lib/EggBotRelayService.php`
- Modify: `src/EggBotWifi.mjs`
- Modify: `tests/eggbot-relay-php.test.mjs`
- Modify: `tests/eggbot-network-transports.test.mjs`

**Step 1: Write the failing tests**

Add one backend test for last-seen fallback:

```js
test('relay should return last seen timestamp when no live device is available', async () => {
    const harness = await startPhpRelayHarness()
    await harness.seedDevice({ chipId: '8FA12C', lastSeenAt: '2026-03-11T09:15:00Z' })

    const connect = await harness.post('client_connect', { chipId: '8FA12C' })

    assert.equal(connect.status, 'last_seen')
    assert.equal(connect.lastSeenAt, '2026-03-11T09:15:00Z')
})
```

Add one transport test for stale poll disconnect:

```js
test('EggBotWifi should drop to disconnected when relay reports stale device state', async () => {
    ...
    assert.equal(wifi.isConnected, false)
})
```

Add one backend test for FIFO command delivery and acknowledgement.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/eggbot-relay-php.test.mjs tests/eggbot-network-transports.test.mjs
```

Expected:

- FAIL because command queue semantics and last-seen state are not implemented yet

**Step 3: Write minimal implementation**

Implement:

- `client_poll`
- `client_disconnect`
- `client_queue_command`
- command FIFO selection in `device_poll`
- acknowledgement updates in `device_ack`
- session freshness checks
- last-seen fallback in `client_connect`

The PHP service should return browser-facing states such as:

```php
[
    'ok' => true,
    'status' => 'last_seen',
    'sessionId' => $sessionId,
    'lastSeenAt' => $device['last_seen_at'],
]
```

The frontend WiFi transport should map non-live states to:

- a surfaced timestamp for `last_seen`
- a connect error for `could_not_connect`
- a forced disconnect when `client_poll` reports stale or closed state

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/eggbot-relay-php.test.mjs tests/eggbot-network-transports.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/eggbot-relay-php.test.mjs tests/eggbot-network-transports.test.mjs api/eggbot-relay.php api/lib/EggBotRelayRepository.php api/lib/EggBotRelayService.php src/EggBotWifi.mjs
git commit -m "feat: queue wifi relay commands through sqlite"
```

### Task 6: Align local dev server messaging and publish docs/spec updates

**Files:**
- Modify: `src/server.mjs`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/eggbot-connection.md`
- Modify: `docs/eggbot-wifi-relay-device-spec.md`
- Test: `tests/app-elements.test.mjs`

**Step 1: Write the failing test**

Add a server test or controller-facing assertion that expects a friendly local-dev response when `/api/eggbot-relay.php` is unavailable under `npm start`.

```js
test('local server should return a relay-not-configured response for wifi relay endpoint', async () => {
    const response = await fetch(`${baseUrl}/api/eggbot-relay.php`, { method: 'POST' })
    assert.equal(response.status, 501)
})
```

If spinning up the full server in a test is too heavy, create a small targeted route test for the new Express handler.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/server-relay-route.test.mjs
```

Expected:

- FAIL because the local Node server has no relay-specific route or message yet

**Step 3: Write minimal implementation**

Add a clear local development response in `src/server.mjs`:

```js
app.post('/api/eggbot-relay.php', (_req, res) => {
    res.status(501).json({
        ok: false,
        error: 'WiFi relay is served by PHP in production. Configure a PHP sidecar for local relay testing.'
    })
})
```

Update docs:

- README: explain WiFi relay architecture and PHP hosting requirement
- architecture: add browser -> PHP -> SQLite -> EggDuino relay flow
- connection docs: explain connect states and chip-ID workflow
- device spec: keep request and response examples aligned with implementation

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/server-relay-route.test.mjs
```

Expected:

- PASS

**Step 5: Commit**

```bash
git add tests/server-relay-route.test.mjs src/server.mjs README.md docs/architecture.md docs/eggbot-connection.md docs/eggbot-wifi-relay-device-spec.md
git commit -m "docs: document wifi relay deployment and firmware spec"
```

### Task 7: Final verification

**Files:**
- Modify: `package.json`
- Verify: `api/*.php`
- Verify: `src/*.mjs`
- Verify: `tests/*.mjs`

**Step 1: Write the version bump**

Increment `package.json` once after the feature is fully implemented.

```json
{
  "version": "1.3.86"
}
```

Use the next appropriate patch version if other work lands first.

**Step 2: Run automated verification**

Run:

```bash
npm test
```

Expected:

- PASS

**Step 3: Run PHP syntax verification**

Run:

```bash
find api -name '*.php' -print0 | xargs -0 -n1 php -l
```

Expected:

- PASS with `No syntax errors detected` for each PHP file

**Step 4: Run manual smoke checks**

Run:

```bash
npm start
```

Verify manually:

- `WiFi` appears next to Serial and BLE
- chip-ID field appears only for WiFi
- offline known device shows `last connected`
- live device shows `connected`
- draw commands stop and UI resets when device polling stops

**Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add wifi relay transport for eggduino"
```
