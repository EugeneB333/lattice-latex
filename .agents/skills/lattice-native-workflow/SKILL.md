---
name: lattice-native-workflow
description: Implement Lattice changes that cross the renderer, Electron bridge, and Rust sidecar. Use for native commands, project files, LaTeX/PDF/SyncTeX, or AI edit flows.
---

# Lattice native workflow

Use this workflow only when a change touches a native capability or crosses process boundaries. Handle isolated renderer styling and ordinary TypeScript utilities without loading this workflow.

## Follow the command path

Trace only the affected path through these layers:

1. The typed renderer-facing functions in `src/lib/desktop.ts` and related types in `src/types.ts`.
2. The narrow preload surface in `electron/preload.cjs` and the allow-listed command handling in `electron/main.cjs`.
3. The corresponding JSON-RPC command and implementation in `backend/src/main.rs`.

Keep browser-demo behavior aligned with the renderer contract when the UI must also work without the native backend. Do not duplicate filesystem, compiler, or provider logic in the demo.

## Preserve boundaries

- Keep Node.js, filesystem, process execution, and secrets out of the renderer.
- Validate native commands and paths at the trusted boundary. Project reads and writes must stay inside the selected root, and writes must stay limited to supported source formats.
- Keep TeX engine choice enumerated, shell escape disabled, and compiler/process time bounded unless the task explicitly changes one of those policies.
- Keep `OPENAI_API_KEY` in the Rust process. Provider output is a structured proposal, not an implicit write; retain `store: false` unless explicitly asked to change the privacy policy.

Read [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) when the change affects these boundaries or the end-to-end command flow. Update that document only when the architecture itself changes.

## Finish the slice

Carry the requested behavior through every affected layer, including contract types, error handling, comprehensive tests, and user documentation where behavior changed. For each changed command, cover renderer and backend success, invalid or rejected input, serialization, backend-error propagation, and browser-demo behavior when applicable. Exercise meaningful combinations of command inputs with table-driven tests.

Keep existing tests unchanged and passing unless the user explicitly changes the contract. Run the focused tests while iterating, then run every check required by the repository `AGENTS.md`. Fix failures caused by the change and distinguish unavailable external-tool verification from a passing automated test.
