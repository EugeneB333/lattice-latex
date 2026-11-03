# GitHub automation

The workflows target Linux (`ubuntu-24.04`). They use explicit token permissions,
immutable action commits, timeouts, lockfile installs, and concurrency groups
that cancel superseded runs. Dependabot maintains action pins. CI runs on every
pull request, including documentation changes, so required checks always appear.

| Workflow | Trigger | Work |
| --- | --- | --- |
| CI | PR, push to `main`, manual | Tests and browser build on Node 22 and 24; Rust tests, Clippy, and build; actionlint and automation tests |
| Native integration | PR, push to `main`, manual | Real pdfLaTeX/XeLaTeX/LuaLaTeX builds in on-demand and background modes, Poppler SVG, SyncTeX, diagnostics, recovery, and rejected RPC requests |
| CodeQL | PR, push to `main`, Tuesday 07:23 UTC, manual | JavaScript/TypeScript, Rust, and GitHub Actions code scanning |
| Dependency review | PR | Reject newly introduced dependencies with high or critical advisories |
| Dependency audit | Tuesday 07:43 UTC, manual | Full npm audit and RustSec audit, including existing vulnerabilities |
| AI assistance | Trusted, non-draft PR updates, when enabled | One advisory review comment and one suggested-description comment, updated on subsequent commits |

The browser artifact is a development demo, not a packaged desktop release.
Native integration exercises the Rust sidecar through JSON-RPC; it does not
launch an Electron window or call a live AI provider. Existing Electron boundary
tests run in the renderer suite. Desktop packaging and deployment are future work.

## Dependency updates and security

Dependabot checks npm (including the isolated Copilot CLI), Cargo, and GitHub
Actions each Monday at 08:00 Europe/London. Minor and patch updates are grouped;
major updates remain separate. Updates require review and are never auto-merged.

Full audits can fail on pre-existing advisories unrelated to a PR. At initial
setup, the npm lockfile reported eight advisories (three critical, four high,
one moderate). This is a snapshot, not an allow list: the scheduled audit keeps
reporting all current findings. Dependency review separately compares each PR
against its base. Do not weaken checks to conceal an advisory.

Enable the dependency graph, Dependabot alerts/security updates, secret scanning,
push protection, and private vulnerability reporting in repository security
settings. Vulnerabilities can be reported through the link in `SECURITY.md`.

## Optional AI assistance

AI assistance is disabled unless the repository Actions variable
`AI_ASSISTANCE_ENABLED` is exactly `true`. Before enabling it:

1. Create an Actions secret `COPILOT_PAT` with access to Copilot CLI inference
   (a fine-grained token with Copilot Requests permission and an eligible account).
2. Optionally set the Actions variable `AI_MODEL`; the default is `gpt-4.1`.
3. Set `AI_ASSISTANCE_ENABLED=true`.

The workflow skips forks, Dependabot PRs, drafts, and authors without owner,
member, or collaborator association. Missing credentials produce a notice.
Inference failures are advisory and do not gate CI. Copilot usage can consume
the account's allowance; no machine credentials are copied into Actions.

`pull_request_target` checks out only the trusted default branch. It reads a
bounded first page of changed files through GitHub's API and passes patches as
untrusted data to a model with tools disabled. Large/binary patches may be
incomplete. No PR checkout, dependency install from PR code, or model-authored
code execution occurs in this privileged job. Only the credential availability
check and inference steps receive the Copilot credential. Suggestions never approve or merge changes or overwrite
the author's PR description. Stale results are discarded after a head change,
closure, or transition to draft. Humans review all output.

## Local checks

```sh
npm test
npm run backend:test
npm run build
node --test .github/scripts/ai-tests.cjs
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12
```

With the native tools listed in the README installed:

```sh
npm run backend:build
LATTICE_BACKEND=/dev/shm/lattice-backend-target/debug/lattice-backend \
  python3 .github/scripts/native_smoke.py -v
```

## Branch rules

For `main`, the stable check names are `Renderer (Node 22)`, `Renderer (Node 24)`,
`Rust sidecar`, `Workflow validation`, `TeX, PDF, and SyncTeX`, and
`New dependency vulnerabilities`. These are suitable required checks after their
first successful runs. CodeQL findings appear under Security/code scanning.
AI output and scheduled full audits should not be required PR checks.

`CODEOWNERS` routes reviews to the maintainer; it does not enforce a rule by
itself. Select the repository's desired branch protection policy separately,
especially for a single-maintainer project where mandatory approvals can block
the owner. No branch rule is silently enabled by these files.
