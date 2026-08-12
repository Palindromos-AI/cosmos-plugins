# Decisions

## 2026-08-10 — Keep distributed stock-data credentials per user

- **Clarification:** `stockdata-fetch` is distributed to multiple users; the publisher's SuperMind token, account ID, and machine-specific absolute path must never become plugin defaults or packaged content.
- **Context:** Every installation authenticates against the user's own SuperMind research account. The proven local configuration uses `~/.config/supermind/token`, which is portable as a home-relative convention without embedding a publisher-specific absolute path.

- **Decision:** Default to the current user's `~/.config/supermind/token`, allow `SUPERMIND_TOKEN_FILE` and explicit `--token-file` path overrides, and retain `SUPERMIND_TOKEN` for ephemeral secret injection. Require skill instructions to state that every user provides their own token and that no token or publisher-home absolute path may enter the plugin, output, version control, examples, marketplace metadata, or chat.
- **Context:** This preserves the proven local setup while keeping the distributed artifact account-neutral and preventing publisher credentials from propagating to users.

## 2026-08-10 — Separate index-catalog completeness from quote coverage

- **Clarification:** `indexes_all` represents the complete SuperMind index catalog for the requested date, not a promise that every catalog entry exposes a daily quote.
- **Context:** Across 2026-08-04, 2026-08-07, and 2026-08-10, catalog size was 23,307–23,637 while non-null closes were 4,076, 17,174, and 4,108. Some source families consistently exposed no daily quotes through this endpoint.

- **Decision:** Validate at least 20,000 catalog rows, at least 4,000 rows with a non-null close, and exact agreement between `has_quote` and close availability. Define both floors once in the packaged notebook and read them into the offline validator.
- **Context:** This catches broad quote loss without falsely treating metadata-only index families as failed extraction.

## 2026-08-10 — Preflight runtime and require durable stock-data output

- **Clarification:** Local configuration failures must occur before any SuperMind mutation, and retained results must not default to a disposable filesystem location.
- **Context:** The first live test pushed the notebook and created a kernel before discovering a missing websocket dependency; the cleaned failure still left stale `submitting` state, and the successful workbook landed inside a temporary worktree.

- **Decision:** Import command-specific dependencies and verify their pinned versions and required APIs before remote work. Record a failed run as `aborted` only after both its owned kernel and canonical cloud notebook are confirmed safe. Record either unresolved condition as `cleanup_failed`, preserve both errors independently, block later runs even if the kernel appears idle or absent, and require the explicit `recover` command to restore the canonical notebook and delete the exact recorded kernel. Reject temporary `run` and `fetch` destinations unless the caller explicitly opts into a disposable test.
- **Context:** These boundaries prevent avoidable cloud changes, make recovery state truthful, and keep successful results durable by default.

## 2026-08-10 — Prefer Baostock for approved stock-data fallbacks

- **Clarification:** SuperMind remains the first-choice source for every new `stockdata-fetch` requirement. A minimal capability probe must confirm a real coverage gap before any fallback is proposed, and the user must approve the exact fallback extension before implementation.
- **Context:** An operational failure such as a timeout, permission error, or temporary platform outage does not prove that SuperMind lacks the requested data.

- **Decision:** For an approved fallback, use baostock whenever it covers the requirement; use akshare only when baostock cannot cover it or the user explicitly requests akshare. Keep fallback scripts separate from the SuperMind notebook and identify the source in their output.
- **Context:** Baostock provides a free API with a higher expected request success rate. Akshare depends more heavily on web scraping and upstream page structures, so its endpoints have a higher failure risk.

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
