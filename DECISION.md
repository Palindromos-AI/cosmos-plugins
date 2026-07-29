# Decisions

## 2026-07-29 — Package CLS Fetch in Cosmos Sources Tools

- **Clarification:** Add the current `cls-fetch` skill to the `cosmos-plugins` marketplace in a new `cosmos-sources-tools` plugin, without placing it in or modifying `cosmos-knowledge-tools`.
- **Context:** CLS feed retrieval is independent of the Cosmos knowledge-management workflows and should be installable separately.

- **Decision:** Name the plugin `cosmos-sources-tools` while keeping its bundled skill named `cls-fetch`.
- **Context:** The plugin name identifies a broader source-tool package, while retaining the skill name preserves the precise `$cls-fetch` invocation.
