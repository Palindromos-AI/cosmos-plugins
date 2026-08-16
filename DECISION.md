# Decisions

## 2026-08-16 — Automatically repair resumable ZSXQ collector defects

- **Clarification:** A reproducible ZSXQ browser-contract or collector-internal runtime defect no longer waits for the user to reply “修复”. Authentication, browser disconnection, permission, invalid input, and external-service failures remain direct blockers rather than repair targets.
- **Context:** The collector already produces a content-redacted diagnostic handoff, retains browser and runner checkpoints, requires evidence-driven adapter changes, and validates repairs before resuming. The approval pause added latency without adding a distinct safety boundary for this narrow in-scope repair.
- **Decision:** Return `automatic-repair-required`, notify the user with a non-blocking progress update, follow the repair playbook immediately, validate the smallest evidence-backed change, and resume from retained checkpoints. This does not authorize commits, merges, pushes, publishing, dependency installation, access-control bypass, scope expansion, or unrelated changes.
- **Context:** Existing fail-closed completeness checks, immutable adapter versioning, diagnostic redaction, and separate version-control authorization remain unchanged.

## 2026-08-15 — Use the official ZSXQ member download before declaring a PDF inaccessible

- **Clarification:** A protected Knowledge Planet PDF may block inline reading while still exposing an official `下载文件` control to signed-in members.
- **Context:** The live 健康星球 file preview displayed the protection notice and a download button; clicking it emitted a browser download event and produced the complete 763,849-byte PDF. The earlier App-only conclusion was therefore false.
- **Decision:** Add immutable adapter `zsxq-web-angular-v5`. Match the exact inventoried topic-local file card and preview filename, require one visible exact download control, capture the official browser download event, and extract the copied local PDF. Declare an access failure only when no official download and no other complete representation exists; never substitute private API reverse engineering.
- **Context:** This preserves source association and platform access controls while distinguishing viewing restrictions from an allowed member download.

## 2026-08-15 — Bind ZSXQ timestamps and lower boundaries to owned UI evidence

- **Clarification:** ZSXQ timestamp extraction must exclude metadata nested inside the date container, and a planet's exact absolute-end marker may prove that no older topics exist when the target date contains the entire finite timeline.
- **Context:** The live Angular UI nested `阅读人数 N` under `.info > .date`, causing strict timestamp parsing to reject visually valid dates. The same newly created planet contained only target-day topics and exposed one direct `.no-more` marker, so requiring an older topic could never complete despite stronger end-of-stream evidence.
- **Decision:** Add immutable adapter `zsxq-web-angular-v4`. Require one direct `.readed-count` child and parse only the date container's owned text node. Accept either an older topic or one exact direct `没有更多了` marker as the lower-bound proof; include the marker in stabilization and preserve v1-v3 unchanged for rollback.
- **Context:** This narrows extraction to explicit UI ownership and strengthens rather than weakens completeness: ambiguous, absent, duplicated, or text-mismatched end markers remain non-proof.

## 2026-08-13 — Encode validated SuperMind runtime constraints without adding a business contract

- **Clarification:** The stock-data skill may record validated API shapes and research-runtime constraints, but it must not hardcode an index, field set, output layout, or trading-day policy from one extraction.
- **Context:** The first real index extraction exposed constraints that the generic guidance did not cover: single-symbol `get_price` return shape, compile-time input rejection, legacy pandas behavior, absent Parquet engines, and shared-server ownership.
- **Decision:** Record these as observed compatibility guidance, not universal guarantees. Use pandas CSV/JSON writers only as temporary remote transport when the requested final writer is unavailable, preserve index-based keys, then validate and convert locally. Acknowledge that runtime download does not delete remote files and `exec-file` does not pass business arguments; local workspace orchestration owns validated parameter rendering and must stop when unverified remote retention violates the privacy contract. Reusable business entry points never stop the shared Jupyter server; the runtime cleans up only its exact kernel. Release the backward-compatible guidance update as `cosmos-stockdata-tools` `0.2.3`.

## 2026-08-13 — Package contract-neutral stockdata implementation references

- **Clarification:** `stockdata-fetch` may preserve architecture and source-call knowledge proven by an earlier implementation, but must not restore that implementation's fixed market scope, datasets, fields, workbook sheets, thresholds, runner lifecycle, or executable extraction program.
- **Context:** Removing the predetermined extractor also removed reliable SuperMind API shapes, batching rules, completeness checks, delayed-data semantics, and failure classifications. Agents then had to rediscover those implementation facts while writing each requirement-driven workspace script.

- **Decision:** Bundle two immutable read-only references: one for the contract-to-delivery workspace architecture and one for previously validated SuperMind implementation patterns. Route the Skill to read the relevant reference before creating or changing business code. Treat examples as evidence for implementation shape only; the accepted user requirement remains the sole source of business scope and validation thresholds. Keep all executable business scripts, mutable dependencies, credentials, retrieved data, and accepted contracts in the user's durable external workspace.
- **Context:** This refines rather than reverses the requirement-driven decision below. Packaged source may contain account-neutral transport code and contract-neutral reference documentation; it may not contain a predetermined business program or universal schema.

## 2026-08-13 — Build stock-data capabilities from user requirements

- **Clarification:** `stockdata-fetch` must not carry a predetermined full-market extractor, fixed workbook, universal schema, speculative field set, or mutable user business scripts. It must retain generic SuperMind execution infrastructure so external workspace scripts remain runnable. Installed plugin directories are versioned caches and are not durable shared state.
- **Context:** The previous bundled extractor encoded one large contract before users had asked for it, while writing later user extensions into an installed Skill would isolate them per machine and risk losing them on reinstall or version replacement.

- **Decision:** Bundle an immutable generic SuperMind runtime limited to per-user configuration, token authentication, JupyterHub server control, code execution, file download, redaction, and exact owned-kernel cleanup. On first use, require each user to choose a durable external `<stockdata-workspace>`, personal token-file absolute path, and micromamba environment together; atomically persist only those paths and the environment name in external local `runtime.json`, never the token content. `runtime.json` is the sole supported binding format; do not read or migrate older workspace-binding files. Later tasks must verify and reuse all three instead of inferring them from the current directory or host. Reconfiguration requires explicit authorization and must preserve the old workspace and token file. Create the smallest reusable business scripts and tests in the workspace, then extend it while preserving accepted capabilities. Marketplace updates must not write to this workspace. Choose sources at field or dataset level in the order `SuperMind -> baostock -> AKShare`. Share a business capability across installations only through a separate authorized upstream review and versioned release.
- **Context:** This supersedes the fixed SuperMind extraction program, workbook contract, business-specific driver lifecycle, thresholds, implicit token-path defaults, and skill-local business-script accumulation decisions. User workspaces, token files, runtime metadata, credentials, and private data remain external; only account-neutral transport code and contract-neutral reference documentation enter a marketplace release.

## 2026-08-11 — Distributed chat skills resolve user-specific runtime bindings

- **Clarification:** Keep `Asia/Shanghai` collection boundaries and source-verification rules fixed, but resolve workspace root, app target, display timezone, and Node executable from each user's active task environment. Accept explicit overrides and never package machine paths, bundle identifiers, screen coordinates, or executable locations.
- **Context:** `dingding-fetch` and `feishu-fetch` are distributed to users whose workspace layouts, localized app names, installation identifiers, host timezones, and runtime locations differ. These values are deployment bindings, not plugin behavior.

- **Decision:** Package the four named placeholders `<workspace-root>`, `<app-target>`, `<display-timezone>`, and `<node-executable>` in both skill contracts while preserving the existing default output namespaces and Beijing-day semantics.
- **Context:** Run-time resolution keeps each skill portable without making correctness-critical scope and completeness rules configurable.

## 2026-08-11 — Package Dingding and Feishu Fetch in Cosmos Sources Tools

- **Clarification:** Add the existing `dingding-fetch` and `feishu-fetch` skills to `cosmos-sources-tools` without redesigning their read-only desktop, Beijing-window, source-preservation, image-reading, or fail-visible completeness contracts.
- **Context:** Both skills retrieve daily source material from signed-in collaboration apps and therefore belong beside the existing source-retrieval skills rather than in the knowledge-management or stock-data plugins.

- **Decision:** Preserve the user-requested `dingding-fetch` and `feishu-fetch` identifiers and their complete source trees, expose them through the plugin's existing `./skills/` path, and raise the plugin's base version from `0.2.1` to `0.3.0` as a backward-compatible capability addition.
- **Context:** Keeping each skill's instructions, metadata, references, and publisher together preserves its tested behavior and invocation while the existing marketplace entry continues to discover the parent plugin.

## 2026-08-10 — Keep distributed stock-data credentials per user (superseded 2026-08-13)

- **Clarification:** `stockdata-fetch` is distributed to multiple users; the publisher's SuperMind token, account ID, and machine-specific absolute path must never become plugin defaults or packaged content.
- **Context:** Every installation authenticates against the user's own SuperMind research account. The proven local configuration uses `~/.config/supermind/token`, which is portable as a home-relative convention without embedding a publisher-specific absolute path.

- **Decision:** Default to the current user's `~/.config/supermind/token`, allow `SUPERMIND_TOKEN_FILE` and explicit `--token-file` path overrides, and retain `SUPERMIND_TOKEN` for ephemeral secret injection. Require skill instructions to state that every user provides their own token and that no token or publisher-home absolute path may enter the plugin, output, version control, examples, marketplace metadata, or chat.
- **Context:** This preserves the proven local setup while keeping the distributed artifact account-neutral and preventing publisher credentials from propagating to users.

## 2026-08-10 — Separate index-catalog completeness from quote coverage (superseded 2026-08-13)

- **Clarification:** `indexes_all` represents the complete SuperMind index catalog for the requested date, not a promise that every catalog entry exposes a daily quote.
- **Context:** Across 2026-08-04, 2026-08-07, and 2026-08-10, catalog size was 23,307–23,637 while non-null closes were 4,076, 17,174, and 4,108. Some source families consistently exposed no daily quotes through this endpoint.

- **Decision:** Validate at least 20,000 catalog rows, at least 4,000 rows with a non-null close, and exact agreement between `has_quote` and close availability. Define both floors once in the packaged notebook and read them into the offline validator.
- **Context:** This catches broad quote loss without falsely treating metadata-only index families as failed extraction.

## 2026-08-10 — Preflight runtime and require durable stock-data output (superseded 2026-08-13)

- **Clarification:** Local configuration failures must occur before any SuperMind mutation, and retained results must not default to a disposable filesystem location.
- **Context:** The first live test pushed the notebook and created a kernel before discovering a missing websocket dependency; the cleaned failure still left stale `submitting` state, and the successful workbook landed inside a temporary worktree.

- **Decision:** Import command-specific dependencies and verify their pinned versions and required APIs before remote work. Record a failed run as `aborted` only after both its owned kernel and canonical cloud notebook are confirmed safe. Record either unresolved condition as `cleanup_failed`, preserve both errors independently, block later runs even if the kernel appears idle or absent, and require the explicit `recover` command to restore the canonical notebook and delete the exact recorded kernel. Reject temporary `run` and `fetch` destinations unless the caller explicitly opts into a disposable test.
- **Context:** These boundaries prevent avoidable cloud changes, make recovery state truthful, and keep successful results durable by default.

## 2026-08-10 — Prefer Baostock for approved stock-data fallbacks (superseded 2026-08-13)

- **Clarification:** SuperMind remains the first-choice source for every new `stockdata-fetch` requirement. A minimal capability probe must confirm a real coverage gap before any fallback is proposed, and the user must approve the exact fallback extension before implementation.
- **Context:** An operational failure such as a timeout, permission error, or temporary platform outage does not prove that SuperMind lacks the requested data.

- **Decision:** For an approved fallback, use baostock whenever it covers the requirement; use akshare only when baostock cannot cover it or the user explicitly requests akshare. Keep fallback scripts separate from the SuperMind notebook and identify the source in their output.
- **Context:** Baostock provides a free API with a higher expected request success rate. Akshare depends more heavily on web scraping and upstream page structures, so its endpoints have a higher failure risk.

## 2026-08-10 — Package a self-contained SuperMind stock-data plugin (superseded 2026-08-13)

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
