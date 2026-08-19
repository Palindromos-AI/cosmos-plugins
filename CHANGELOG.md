# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- A proprietary `LICENSE` for the marketplace and a README license section; third-party-derived portions stay under their own licenses.
- README setup steps for the fix-report channel: the customer creates a public GitHub repository, shares its URL with the maintainer, and connects `<cosmos-workspace-root>/fix-reports` to it with an initial commit and upstream.
- README prerequisites for the fixed Python environment: micromamba, uv, and a one-time `micromamba create -n cosmos python=3.12`.
- A dependency-free `fix-report` writer with slug and CLI validation, canonical containment, symbolic-link rejection, and same-handle exclusive no-clobber writes.
- Standalone `cosmos-fix-tools` plugin with the `fix-report` Skill, strict packaged-content scope, privacy-safe reports under `<cosmos-workspace-root>/fix-reports`, synchronized-upstream checks, and automatic report-only commit/push without an additional approval gate.
- Explicit automatic `$fix-report` invocation guidance and missing-plugin handling in every existing marketplace Skill, while excluding changes confined to external workspaces, runtime configuration, generated output, retrieved data, and user-owned business scripts.
- A shared Cosmos workspace-root convention with independently configured `<root>/sources` and `<root>/stockdata` subtrees, plus a deterministic sources workspace manager, canonical output confinement, and offline binding-safety tests.
- One-attempt automatic repair workflows for `dingding-fetch` and `feishu-fetch`, with atomic per-run repair state, evidence-driven playbooks, direct-failure boundaries, and a hard no-reset limit that prevents repeated repair loops and excess token use.
- Contract-neutral stockdata implementation references covering the workspace processing architecture and previously validated SuperMind API, batching, completeness, delayed-data, and failure-classification patterns.
- A generic SuperMind token/JupyterHub runtime for executing external workspace scripts, downloading remote results, redacting credentials, and cleaning up the exact kernel it creates.
- Atomic per-user runtime binding for the external stockdata workspace, personal token-file path, and user-selected micromamba environment, without storing token contents.
- `dingding-fetch` and `feishu-fetch` in `cosmos-sources-tools`, with read-only signed-in desktop collection, frozen Beijing-time windows, complete group-message coverage, semantic source selection, image-content extraction, and content-bound atomic Markdown publication.
- Packaging/discovery smoke tests for both added skill trees, plus publisher behavior tests and verification of the existing marketplace connection.
- Standalone `cosmos-stockdata-tools` plugin with a requirement-driven `stockdata-fetch` skill that cumulatively grows scripts in each user's durable external workspace through `SuperMind -> baostock -> AKShare`.
- `zsxq-fetch` in `cosmos-sources-tools`, with authenticated Chrome collection, fail-closed daily coverage, deterministic checkpointing and rendering, image/PDF content verification, and content-only Markdown output.
- Standalone `cosmos-sources-tools` plugin containing the `cls-fetch` complete current-day CLS retrieval and semantic-filtering skill.
- Marketplace, installation, runtime, and architecture documentation for `cosmos-sources-tools`.

### Changed

- Bumped `cosmos-fix-tools` to `0.1.3` and `cosmos-sources-tools` to `0.4.5` for the symlinked CLI entry-point, temporary-root, and canonical-path fixes.
- Bumped `cosmos-fix-tools` to `0.1.2`, `cosmos-knowledge-tools` to `0.1.3`, `cosmos-sources-tools` to `0.4.4`, and `cosmos-stockdata-tools` to `0.3.3` for the report-channel, fixed-environment, and developer-reference cleanup.
- Fixed every Python-running Skill (`llm-wiki`, `raw-to-markdown`, `stockdata-fetch`) to the micromamba environment `cosmos` with `uv pip`; `stockdata-fetch` no longer asks the user to choose an environment and records `cosmos` in its binding.
- `fix-report` now states that the report remote is a public repository owned by the user and read by the maintainer, and its missing-setup message lists the exact setup commands.
- Removed developer-specific references from distributed files and repository docs: the `defuddle` Skill no longer names another agent's fetch tool, `llm-wiki` no longer names a specific vault plugin or "this vault", the `zsxq-fetch` default prompt uses a `<星球名称>` placeholder, the `cls-fetch` repair playbook no longer names a development project package, and DECISION.md refers to the maintainer's test planet generically.
- Relaxed the pinned plugin-version assertions in `tests/cosmos-fix-tools.test.mjs`, `tests/cosmos-sources-tools.test.mjs`, and `tests/cosmos-stockdata-tools.test.mjs` to any semantic version, so version bumps no longer break the wiring tests; the stockdata test now requires the fixed `micromamba run -n cosmos python` launcher and rejects a user-chosen `<env>`.
- Defined `cosmos-fix-tools` as the mandatory companion for every installed business plugin while keeping the three business plugins independently optional; each Skill now preflights that companion before a packaged modification, and missing-plugin recovery installs or upgrades only it before restarting the repair in a new task.
- Bumped `cosmos-knowledge-tools` to `0.1.2`, `cosmos-fix-tools` to `0.1.1`, `cosmos-sources-tools` to `0.4.3`, and `cosmos-stockdata-tools` to `0.3.2` for the companion-installation, report-path, and authorization-boundary fixes.
- Preserved caller Skills' general commit, merge, push, and publish authorization rules while adding one narrow exception for the independently configured report-only commit/push.
- Bumped `cosmos-knowledge-tools` to `0.1.1`, `cosmos-sources-tools` to `0.4.2`, and `cosmos-stockdata-tools` to `0.3.1` for the marketplace-change reporting handoff.
- Bumped `cosmos-sources-tools` to `0.4.1`; `zsxq-fetch` now uses the immutable Angular v6 adapter for joined-planet timestamp compatibility.
- Bumped `cosmos-sources-tools` to `0.4.0`; all four source Skills now require the plugin's durable external sources workspace and keep final reports under its `output/` namespace.
- Bumped `cosmos-stockdata-tools` to `0.3.0`; configurations accept a shared root, derive the stockdata subtree, and require the single versioned schema without alternate layout compatibility.
- Made marketplace, plugin, and Skill update isolation explicit: capability updates never configure, migrate, move, overwrite, or delete user settings and workspace data.
- Changed `zsxq-fetch` browser-contract and collector-runtime failures from a user-approval repair gate to automatic evidence-driven diagnosis, repair, validation, and checkpoint resume; commit, merge, push, dependency installation, access-control bypass, and unrelated changes still require their own authorization.
- Bumped `cosmos-stockdata-tools` to `0.2.3` and documented validated SuperMind research-runtime constraints: exact daily-price call shapes, compile-time input rejections, legacy pandas compatibility, and key-preserving CSV/JSON transport fallback when Parquet engines are unavailable.
- Bumped `cosmos-stockdata-tools` to `0.2.2` for the backward-compatible implementation-reference addition.
- Routed `stockdata-fetch` through the relevant read-only architecture and SuperMind implementation references before creating or changing workspace business code, without restoring any fixed extractor or data contract.
- Corrected `stockdata-fetch` version `0.2.1` to retain immutable SuperMind execution infrastructure while keeping all evolving business scripts outside the replaceable plugin cache.
- Rebuilt `stockdata-fetch` around successive user data contracts, durable per-user workspaces outside replaceable plugin caches, source-specific adapters, explicit provenance, and contract-specific validation; bumped `cosmos-stockdata-tools` to `0.2.0` for the breaking workflow change.
- Made both distributed chat skills environment-portable by resolving workspace root, localized app target, display timezone, and Node executable per run instead of embedding developer-machine settings.
- Expanded `cosmos-sources-tools` metadata, documentation, and base version to `0.3.0` for DingTalk and Feishu group-message retrieval.
- Bumped `cosmos-sources-tools` to `0.2.1` for the fixed Beijing-date boundary contract.
- Expanded `cosmos-sources-tools` metadata and documentation to cover both bundled source-retrieval skills, and bumped the plugin version to `0.2.0`.

### Fixed

- Made all 13 packaged CLI entry points recognize themselves when invoked through a symbolic-link path: the entry guard now compares the realpath of `process.argv[1]` with `import.meta.url` instead of exiting 0 silently. Added `tests/cli-entry-points.test.mjs`, which runs every CLI both directly and through a symlinked directory.
- Made the sources workspace manager compare canonical temporary roots, so on macOS a workspace root under `os.tmpdir()` (`/var/folders/...` → `/private/var/...`) or `/var/tmp` is rejected as originally intended; the test suite now exercises the default temporary-root list.
- Made `write-report.mjs` accept a report repository whose ancestor is a symbolic link (macOS `/tmp`, synced folders) and use the canonical path, while still rejecting a symlinked `fix-reports` directory itself; the `fix-report` SKILL step 5 now treats Git's canonical top-level path as authoritative.
- Made `fix-report` reject unsafe or symbolic-link report paths, require shell-safe validated Git operands, and expose `interface.defaultPrompt` with the specified string-array type.
- Made the ZSXQ collector return the runner's exact `{ "topics": [...] }` inventory envelope, preventing live collection from failing at `record-inventory` after coverage succeeds.
- Allowed zero or one direct ZSXQ read-count child while still rejecting duplicates and extracting only the timestamp container's owned text, so joined planets without that node remain collectable.
- Added the immutable ZSXQ Angular v5 adapter and official UI download workflow so a protected PDF with a visible member download control is downloaded and extracted locally instead of being misreported as App-only.
- Added the immutable ZSXQ Angular v4 browser adapter so nested read-count text no longer contaminates topic timestamps, and so an exact absolute timeline-end marker can prove the lower collection boundary for a newly created planet with no older topic.
- Excluded ignored Python bytecode caches from the stockdata packaged-file assertion so running runtime tests does not make the marketplace test fail.
- Clarified that reusable stock-data business entry points must not stop the shared SuperMind Jupyter server; the runtime cleans up only the exact kernel it creates.
- Made the runtime's business-argument and remote-file-retention boundaries explicit so workspace orchestration does not mistake source submission or download for parameter passing or remote cleanup.
- Validate ZSXQ topic membership after strictly parsing explicit timestamp offsets and converting the represented instant to Beijing time instead of comparing the timestamp's textual date prefix.

### Removed

- Removed compatibility with the superseded one-line stockdata workspace binding; `runtime.json` is now the only supported per-user binding format.
- Removed the stockdata full-extraction notebook, business-specific runner, fixed workbook validator, fixed workbook dependency, and their implementation-specific tests. Future requirements create and extend business scripts in user-owned external workspaces; the plugin retains only generic SuperMind transport and contract-neutral read-only references.
