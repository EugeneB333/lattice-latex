---
name: lattice-bugfix
description: Diagnose and fix a Lattice defect with regression coverage. Use when correcting broken or previously supported frontend, Electron, or backend behavior.
---

# Lattice bug-fix workflow

Restore the intended behavior without weakening existing contracts or tests.

## Reproduce and protect

Trace the smallest affected path and identify the test suite that should have caught the defect. Add a regression test before changing the implementation when practical, and confirm that it fails for the reported reason rather than an unrelated setup error.

The regression coverage must include:

- the smallest input or interaction that reproduces the defect;
- the expected observable result;
- relevant boundary, negative, state-transition, and error cases; and
- behaviorally distinct combinations that could reach the same failure through another mode or layer.

Prefer a deterministic unit or component test. If the defect depends on Electron, TeX Live, Poppler, process timing, or a live provider and cannot be reproduced reliably at that level, test the narrowest deterministic boundary and state the remaining runtime verification explicitly.

## Fix without regression

Make the smallest coherent correction in the owning layer. Do not delete, skip, relax, or rewrite passing tests to accommodate the fix. Existing tests must pass unchanged unless the user explicitly changes the old contract; in that case, explain the conflict and update only the superseded expectations.

If the defect crosses the renderer, Electron, and Rust boundary, also use the `lattice-native-workflow` skill and cover success, rejection, serialization, and error propagation at the affected interfaces.

## Completion

Run the new regression test and adjacent focused tests first. Then run `npm test`, `npm run backend:test`, and `npm run build`. The fix is complete only when the regression test demonstrates the corrected behavior, all previous tests pass, all relevant states and combinations are covered, and any unavailable external-runtime check is reported clearly.
