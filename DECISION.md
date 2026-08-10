# Decisions

## 2026-08-10 — Package a self-contained SuperMind stock-data plugin

- **Clarification:** Add `stockdata-fetch` in a standalone `cosmos-stockdata-tools` plugin, separate from knowledge-management and source-archival plugins.
- **Context:** Daily A-share and index extraction is an independent operational workflow that must be distributable to users who do not have Jason's local `panda` project, environment, paths, or SuperMind account ID.

- **Decision:** Make the plugin's packaged notebook and scripts the sole maintained execution source. Bundle the stable SuperMind extraction path, dynamically discover each token's account ID, keep credentials and output external, and defer akshare/baostock until a confirmed SuperMind coverage gap creates a concrete requirement.
- **Context:** A self-contained plugin is portable and testable. Historical dates are injected only into an in-memory notebook copy, while the bundled file remains `TARGET_DATE = None`; both normal and failed submissions restore the cloud copy to that default.

## 2026-08-10 — ZSXQ dates always use Beijing time

- **Clarification:** Package `zsxq-fetch` with a fixed `Asia/Shanghai` (`UTC+08:00`) day boundary for explicit dates and “today”; never derive the collection day from the host, browser, user-location, or publisher timezone.
- **Context:** The collector already interpreted displayed times as `+08:00`, while the runner previously checked the timestamp's textual date prefix. The shared Beijing-date helper now converts every explicit offset before date validation, so the packaged contract and implementation agree.

- **Decision:** Bump `cosmos-sources-tools` from `0.2.0` to `0.2.1` as a backward-compatible boundary-correctness fix.
- **Context:** The skill name and invocation remain unchanged; only the previously implicit time policy becomes explicit and consistently enforced.

## 2026-08-09 — Package ZSXQ Fetch in Cosmos Sources Tools

- **Clarification:** Add the existing Codex-native `zsxq-fetch` skill to the marketplace's `cosmos-sources-tools` plugin without changing its authenticated-browser, completeness, privacy, or output contracts.
- **Context:** Knowledge Planet archival is a source-retrieval workflow and belongs beside `cls-fetch`; preserving the already-tested skill tree avoids divergence between development and packaged behavior.

- **Decision:** Keep the bundled skill named `zsxq-fetch` and expand `cosmos-sources-tools` from version `0.1.0` to `0.2.0`.
- **Context:** The stable skill name preserves `$zsxq-fetch` invocation, while the minor version reflects a new independently usable capability.

## 2026-07-29 — Package CLS Fetch in Cosmos Sources Tools

- **Clarification:** Add the current `cls-fetch` skill to the `cosmos-plugins` marketplace in a new `cosmos-sources-tools` plugin, without placing it in or modifying `cosmos-knowledge-tools`.
- **Context:** CLS feed retrieval is independent of the Cosmos knowledge-management workflows and should be installable separately.

- **Decision:** Name the plugin `cosmos-sources-tools` while keeping its bundled skill named `cls-fetch`.
- **Context:** The plugin name identifies a broader source-tool package, while retaining the skill name preserves the precise `$cls-fetch` invocation.
