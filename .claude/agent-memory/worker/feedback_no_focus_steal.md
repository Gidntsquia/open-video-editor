---
name: feedback-no-focus-steal
description: User does not want the app test window opened over their other windows
metadata:
  type: feedback
---

Don't open the Electron app on top of the user's other windows during testing.

**Why:** the user works on the machine while the worker runs (stated 2026-09-30).

**How to apply:** launch tests with `OVE_INACTIVE=1` (window uses showInactive, no focus steal). Drive via CDP, not real input.
