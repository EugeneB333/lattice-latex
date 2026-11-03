# Lattice repository guidance

Lattice is a Linux-first LaTeX workspace with a React/TypeScript renderer, an Electron bridge, and a Rust sidecar. Keep ordinary project folders interoperable and keep model-authored edits reviewable before they are written.

## Work in the relevant surface

- Renderer and browser-demo behavior live in `src/`.
- Native windowing and the allow-listed IPC bridge live in `electron/`.
- Filesystem access, child processes, LaTeX builds, SyncTeX, and provider calls live in `backend/`.
- Use `docs/ARCHITECTURE.md` when changing a security boundary, native command flow, build pipeline, or AI edit flow. It is not prerequisite reading for isolated UI, test, or documentation edits.
- Update `README.md` when a user-facing capability, setup step, shortcut, or runtime requirement changes.

Preserve the native boundary: renderer code must not gain direct Node.js, filesystem, process, or credential access. AI output remains a proposal until the author accepts and saves it. Keep project-path constraints, recognized source-file limits, bounded child processes, and disabled TeX shell escape intact unless the task explicitly changes those policies.

## Testing and regression policy

Frontend and backend behavior must be covered extensively with automated tests. Treat tests as part of the implementation, not as optional follow-up work.

- Cover every behaviorally distinct case: normal paths, boundaries, empty values, malformed input, failures, recovery, and state transitions.
- Cover every user-visible or interactive element and each supported interaction. Assert observable behavior, accessibility state, and disabled, loading, success, and error states where they exist.
- Cover every meaningful combination of independent inputs, modes, and states. Prefer table-driven or parameterized tests. When a finite Cartesian product produces distinct behavior, exercise the full product; when cases are equivalent, use explicit equivalence classes and boundary values rather than duplicate tests that prove nothing new.
- Test contracts at both sides of a boundary. Renderer/Electron/Rust changes need success, rejection, serialization, error-propagation, and browser-demo coverage wherever those behaviors apply.
- Keep tests deterministic and isolated. Mock provider/network calls and external programs at the narrow boundary; use temporary directories and fixtures for filesystem behavior.

Before changing implementation, identify the existing tests that protect the affected behavior. New work must preserve the old contract: do not delete, weaken, skip, or rewrite passing tests merely to make a feature or fix pass. Existing tests should pass unchanged. The only exception is an explicitly requested contract change; explain the superseded expectation and change only the tests that encode it.

Every new feature must add tests for all new behavior, elements, branches, states, and meaningful combinations. Every bug fix must add a regression test that fails for the reported defect before the fix and passes afterward. Include adjacent boundary or negative cases when they could allow the same defect to return through another path.

For any code behavior change, run the focused tests while iterating, then complete all repository checks before stopping:

```sh
npm test
npm run backend:test
npm run build
```

Documentation-only changes do not require the application suites. Features that depend on TeX Live, Poppler, Electron UI interaction, or a live provider should also be exercised when the dependency is available; otherwise, report the unverified runtime path clearly.

Local edits, builds, and tests use local or disposable data and do not need confirmation. Carry an implementation through the affected layers, fix failures caused by the requested change, and rerun affected and full regression checks before stopping. Do not expand a task into an item from the future roadmap unless the user asks for it.
