# Architecture

## Product principles

1. **The build is the truth.** AI changes should ultimately be judged against the same compiler and rendered artifact as human edits.
2. **AI proposes; the author disposes.** A model response becomes a patch preview, never an implicit write.
3. **Normal folders stay normal.** Lattice does not hide source in a database or proprietary bundle.
4. **The desktop boundary is replaceable.** UI state and product interactions live in TypeScript; filesystem, processes, credentials, and future sandboxing live behind typed commands.
5. **TeX is executable input.** Shell escape is off, process lifetime is bounded, file paths are constrained, and future remote builds must use stronger OS isolation.

## Current vertical slice

```text
App.tsx
  │
  ├── Project rail ─────────────── choose_project / read_project_file
  ├── Monaco editor ────────────── write_project_file
  ├── Build + PDF + diagnostics ── compile_project
  ├── PDF preview ↔ Monaco ──────── render_pdf_page / forward_search / inverse_search
  └── Lattice AI patch review ──── propose_ai_edit
                                      │
Electron preload (narrow IPC) ────────┤
                                      │ newline-delimited local JSON-RPC
backend/src/main.rs                   ├── latexmk → selected TeX engine
                                      └── Responses API → JSON patch proposal
```

Electron supplies the Chromium window and owns folder selection. On Linux the main
process prefers a direct GTK `zenity` directory picker with portal delegation disabled,
then falls back to Electron's system dialog if `zenity` is unavailable or fails. Other
platforms use Electron's system dialog. Picker processes are launched without a shell,
have bounded output, and are terminated when the application exits. The renderer has no
Node.js access; context isolation and its preload expose only Lattice's allow-listed
command bridge. The source-checkout launcher detects an unavailable Linux SUID
sandbox helper and can use Electron's development-only `--no-sandbox` fallback;
packaged builds must configure Chromium's OS sandbox. The Rust sidecar owns filesystem
boundaries, child processes, and credentials. The browser fallback implements the
same TypeScript contract using a sample project and remains a UI development surface,
not a second compiler implementation.

## Why `latexmk`

Lattice supervises `latexmk` rather than reimplementing LaTeX's multi-pass build algorithm. Engine choice is an enum and never an arbitrary command. The native core supplies noninteractive, file-line-error, SyncTeX, timeout, and no-shell-escape settings.

The renderer offers on-demand and opt-in live preview modes over the same build command. Live preview is governed by a latest-only scheduler: edits are debounced, compiler runs never overlap, changes made during a build are coalesced into one follow-up run, and results for stale editor revisions are discarded. Live `latexmk` processes use reduced OS priority when `nice` is available and a shorter compiler timeout. A successful backend response contains the source PDF and a version token rather than eagerly rendered copies of every page. PDF.js parses page geometry, destinations, and links in a web worker. When a page nears the viewport, the Rust sidecar validates the version token and runs bounded `pdftocairo` SVG conversion for that page only. The SVG contains the PDF's glyph outlines, avoiding Chromium font substitution while remaining sharp at every zoom. This keeps build completion independent of document length while preserving PDF-point coordinates for zoom and SyncTeX. A background-process failure or hard timeout returns the workspace to on-demand mode; a successful build never silently changes the user's selected mode merely because it took longer than average. Compilation and page conversion remain in the Rust sidecar, so the editor event loop is never used for TeX work.

## AI request boundary

The first provider implementation is intentionally narrow:

- input: active file, optional selected range, author instruction, current structured diagnostics;
- output: summary, explanation, exact replacement;
- mutation: none.

The API key remains in the native process. The request sets `store: false` and demands a strict JSON schema. A later `AiProvider` trait can add other remote or local providers without changing the editor.

## Next milestones

### 0.2 — authoring fundamentals

- Nested folder tree and create/rename file operations.
- Autosave with conflict detection and file watching.
- Incremental build events and cancellation.
- TexLab process supervision and LSP bridge.

### 0.3 — verified AI build mode

- Copy-on-write staging workspaces.
- Multi-file unified patches.
- Project graph for `\\input`, `\\include`, bibliography, graphics, and macro definitions.
- Controlled AI tools: read ranges, project search, diagnostics, staging compile.
- Compile/repair loop capped by time, attempts, and touched files.
- Side-by-side source diff and rendered before/after comparison.

### 0.4 — distributable Linux app

- Build isolation with a dedicated process group and resource controls.
- First-run TeX health check.
- Debian/AppImage packaging, desktop file, icons, update policy.
- Accessibility audit and full keyboard navigation.
- License and third-party notice review.

### Future web version

The React workspace can be reused. Native commands become an authenticated service API, and builds move into disposable, network-restricted containers. Collaboration and accounts should be added only after this isolation boundary exists.
