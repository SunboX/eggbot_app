# Draw Time Estimation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist one bot-local draw-time profile and use it to show the estimated total draw time of the currently visible motif, including imported SVG patterns.

**Architecture:** Extract shared draw-time estimation into dedicated utilities, keep runtime calibration data in localStorage, and wire the UI to recompute estimates whenever strokes, draw settings, or calibration data change.

**Tech Stack:** ECMAScript modules, node:test, localStorage, existing EggBot path compute utilities

---

### Task 1: Add failing tests for timing utilities and UI wiring

**Files:**
- Create: `tests/draw-time-profile-utils.test.mjs`
- Create: `tests/draw-time-estimator.test.mjs`
- Modify: `tests/eggbot-serial.test.mjs`
- Modify: `tests/app-elements.test.mjs`

**Step 1: Write the failing tests**

- Assert that timing profiles normalize invalid input to defaults.
- Assert that new stroke measurements update the stored duration scale.
- Assert that a calibrated estimate is larger or smaller than the baseline estimate as expected.
- Assert that `EggBotSerial.drawStrokes()` emits one measured-stroke callback.
- Assert that the new total-time UI element is present in the markup.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL in the newly added timing/profile tests because the new utilities and UI selectors do not exist yet.

### Task 2: Implement shared timing profile and estimation utilities

**Files:**
- Create: `src/DrawTimeProfileUtils.mjs`
- Create: `src/DrawTimeEstimator.mjs`
- Modify: `src/AppControllerShared.mjs`

**Step 1: Write minimal implementation**

- Add normalized default timing profile helpers.
- Add one estimator that prepares drawable strokes, estimates baseline motion time, and applies the calibration factor.
- Export the new helpers and one dedicated localStorage key.

**Step 2: Run targeted tests**

Run: `npm test`
Expected: Utility tests progress, but runtime/controller tests still fail.

### Task 3: Wire persistence and live profile updates into controller and serial flow

**Files:**
- Modify: `src/AppControllerCoreControls.mjs`
- Modify: `src/AppControllerRuntime.mjs`
- Modify: `src/AppControllerDraw.mjs`
- Modify: `src/EggBotSerial.mjs`

**Step 1: Write minimal implementation**

- Load and persist the timing profile from localStorage.
- Accept one `onStrokeMeasured` callback from the serial draw loop.
- Update the local timing profile whenever one stroke completes.
- Trigger one draw-time estimate refresh after profile changes.

**Step 2: Run targeted tests**

Run: `npm test`
Expected: Serial and persistence-related tests pass; UI test may still fail.

### Task 4: Add the permanent UI and keep the current motif estimate in sync

**Files:**
- Modify: `src/index.html`
- Modify: `src/AppElements.mjs`
- Modify: `src/AppControllerRender.mjs`
- Modify: `src/i18n/de.json`
- Modify: `src/i18n/en.json`

**Step 1: Write minimal implementation**

- Add one always-visible label for total draw time.
- Recompute the estimate after render completion, SVG import, draw-config changes, and timing-profile changes.
- Reuse the existing duration formatter for the visible value.

**Step 2: Run test to verify it passes**

Run: `npm test`
Expected: PASS

### Task 5: Final verification and version bump

**Files:**
- Modify: `package.json`

**Step 1: Update version**

- Increment the app version for this change.

**Step 2: Run full verification**

Run: `npm test`
Expected: PASS
