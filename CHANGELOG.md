# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `dingding-fetch` and `feishu-fetch` in `cosmos-sources-tools`, with read-only signed-in desktop collection, frozen Beijing-time windows, complete group-message coverage, semantic source selection, image-content extraction, and content-bound atomic Markdown publication.
- Packaging/discovery smoke tests for both added skill trees, plus publisher behavior tests and verification of the existing marketplace connection.
- Standalone `cosmos-stockdata-tools` plugin with a requirement-driven `stockdata-fetch` skill that cumulatively grows scripts in each user's durable external workspace through `SuperMind -> baostock -> AKShare`.
- `zsxq-fetch` in `cosmos-sources-tools`, with authenticated Chrome collection, fail-closed daily coverage, deterministic checkpointing and rendering, image/PDF content verification, and content-only Markdown output.
- Standalone `cosmos-sources-tools` plugin containing the `cls-fetch` complete current-day CLS retrieval and semantic-filtering skill.
- Marketplace, installation, runtime, and architecture documentation for `cosmos-sources-tools`.

### Changed

- Rebuilt `stockdata-fetch` around successive user data contracts, durable per-user workspaces outside replaceable plugin caches, source-specific adapters, explicit provenance, and contract-specific validation; bumped `cosmos-stockdata-tools` to `0.2.0` for the breaking workflow change.
- Made both distributed chat skills environment-portable by resolving workspace root, localized app target, display timezone, and Node executable per run instead of embedding developer-machine settings.
- Expanded `cosmos-sources-tools` metadata, documentation, and base version to `0.3.0` for DingTalk and Feishu group-message retrieval.
- Bumped `cosmos-sources-tools` to `0.2.1` for the fixed Beijing-date boundary contract.
- Expanded `cosmos-sources-tools` metadata and documentation to cover both bundled source-retrieval skills, and bumped the plugin version to `0.2.0`.

### Fixed

- Validate ZSXQ topic membership after strictly parsing explicit timestamp offsets and converting the represented instant to Beijing time instead of comparing the timestamp's textual date prefix.

### Removed

- Removed the stockdata full-extraction notebook, JupyterHub runner, fixed workbook validator, pinned runtime requirements, and their implementation-specific tests. The Skill now remains instruction-only; future requirements create and extend scripts in user-owned external workspaces.
