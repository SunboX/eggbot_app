# EggBot Connection

## Supported connection mode

The app uses Web Serial directly from the browser.

## EBB commands used

- `SC,4,<value>`: servo up calibration slot
- `SC,5,<value>`: servo down calibration slot
- `SP,<0|1>`: pen up/down switching
- `EM,<m1>,<m2>`: enable/disable steppers
- `SM,<duration>,<axis1>,<axis2>`: timed move command

## Draw mapping

- `u` (horizontal wrap) maps to EggBot rotation motor steps.
- `v` (vertical) maps to pen carriage motor steps.
- `stepsPerTurn` and `penRangeSteps` control scaling.

## Safety and calibration

1. Test with a disposable egg first.
2. Verify pen up/down values before full draws.
3. Start with lower complexity patterns.
4. Keep one hand near emergency stop in UI.
5. Re-check mechanical zero after each failed run.
