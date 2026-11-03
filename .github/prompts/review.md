Review the supplied Lattice change for actionable defects. Report findings with
severity, file, line where available, trigger, and consequence. Prioritize:

- Correctness: autosave ordering, stale builds, project/tab state, editor
  selections, PDF coordinates, SyncTeX, async failures and recovery.
- Security: renderer Node access, IPC allow lists, project path and symlink
  traversal, recognized write formats, bounded child processes, disabled TeX
  shell escape, native-only credentials, AI edits remaining proposals.
- Architecture: renderer → Electron → Rust contracts, serialization, errors,
  and deterministic browser-demo behavior.
- Performance: main-thread work, overlapping builds, eager page conversion,
  unbounded output, resource cleanup and cancellation.
- Tests: regression cases, boundary/rejection cases and cross-layer contracts;
  preserve existing passing expectations unless the contract explicitly changes.

Do not nitpick style. Do not invent defects from omitted context. Say when no
actionable findings are visible, and mention relevant verification gaps.
