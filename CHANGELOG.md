# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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

- Added the immutable ZSXQ Angular v5 adapter and official UI download workflow so a protected PDF with a visible member download control is downloaded and extracted locally instead of being misreported as App-only.
- Added the immutable ZSXQ Angular v4 browser adapter so nested read-count text no longer contaminates topic timestamps, and so an exact absolute timeline-end marker can prove the lower collection boundary for a newly created planet with no older topic.
- Excluded ignored Python bytecode caches from the stockdata packaged-file assertion so running runtime tests does not make the marketplace test fail.
- Clarified that reusable stock-data business entry points must not stop the shared SuperMind Jupyter server; the runtime cleans up only the exact kernel it creates.
- Made the runtime's business-argument and remote-file-retention boundaries explicit so workspace orchestration does not mistake source submission or download for parameter passing or remote cleanup.
- Validate ZSXQ topic membership after strictly parsing explicit timestamp offsets and converting the represented instant to Beijing time instead of comparing the timestamp's textual date prefix.

### Removed

- Removed compatibility with the superseded one-line stockdata workspace binding; `runtime.json` is now the only supported per-user binding format.
- Removed the stockdata full-extraction notebook, business-specific runner, fixed workbook validator, fixed workbook dependency, and their implementation-specific tests. Future requirements create and extend business scripts in user-owned external workspaces; the plugin retains only generic SuperMind transport and contract-neutral read-only references.
