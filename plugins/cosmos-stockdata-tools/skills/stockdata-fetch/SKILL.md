---
name: stockdata-fetch
description: >-
  Incrementally build, test, run, and extend China stock-market data scripts in
  each user's durable external stockdata workspace under a user-chosen shared
  Cosmos workspace root, choosing sources in strict priority
  order: SuperMind, then baostock, then AKShare. Use when Codex needs to add,
  change, or execute reusable A-share, index, fund, sector, financial,
  valuation, factor, trading, or security-metadata capabilities. Use the
  bundled generic SuperMind token/JupyterHub runtime, but accumulate business
  scripts only in the external workspace and only as users request them,
  without a fixed full extraction or universal schema.
---

# Stockdata Fetch

Grow one persistent stock-data implementation for each user from their successive requirements. Keep the installed skill immutable; create and evolve business scripts in a durable workspace outside the plugin. Use the bundled generic runtime only for SuperMind authentication, JupyterHub execution, file download, and exact kernel cleanup. Use the bundled references as read-only implementation guidance, never as a fixed extraction contract.

## Read the implementation references

Read `<skill-dir>/references/implementation-architecture.md` completely before creating the first workspace business capability or changing module boundaries. It defines the contract-to-delivery flow, module responsibilities, failure semantics, provenance, and minimum verification matrix without prescribing a universal schema.

Read `<skill-dir>/references/supermind-api-patterns.md` completely before writing or changing a SuperMind adapter or capability probe. It records previously validated API shapes, batching and completeness patterns, delayed-data handling, and known research-environment constraints. Treat each pattern as evidence for implementation shape, not authorization for its example dataset, field, limit, or output.

Do not copy either reference into the user workspace. Apply only the sections relevant to the accepted requirement. When the reference does not establish an exact endpoint, field, date range, permission, or financial meaning, verify it through official documentation, the user's existing research environment, or one minimal capability probe.

## Configure the per-user runtime

Treat the plugin cache, installed skill directory, and marketplace snapshot as read-only, replaceable distribution artifacts. Never store generated scripts, tests, mutable dependencies, runtime configuration, credentials, or retrieved data in them. The generic `<skill-dir>/scripts/supermind_runtime.py`, its pinned `requirements.txt`, and the implementation references are versioned, read-only infrastructure and guidance; they are not the user's evolving extraction program.

On first use, collect and confirm these two values together in a single setup:

1. `<cosmos-workspace-root>`: a user-chosen, durable absolute root shared by the Cosmos plugin family. Derive `<stockdata-workspace>` exactly as `<cosmos-workspace-root>/stockdata`; never accept another child name or an independently chosen stockdata path.
2. `<token-file>`: a user-chosen absolute file containing that user's own SuperMind token. Keep it outside the workspace and plugin, and require mode `600` on POSIX systems.

The Python environment is not a choice: every Cosmos plugin runs Python in the micromamba environment `cosmos` and installs packages with `uv pip`. Record `cosmos` as the environment in the binding; do not ask the user for another name.

Never infer either value or read another plugin's binding as a substitute. Never ask for or accept the token content in chat. Persist only schema version, plugin identity, normalized workspace-root and derived workspace paths, token-file path, and environment name in the canonical local per-user metadata file `~/.config/cosmos-stockdata-tools/runtime.json`; the token content must never appear in `runtime.json`. Keep this plugin's configuration separate from `cosmos-sources-tools` even when both record the same root. The configuration is local to one user and machine and stays outside the plugin, marketplace snapshot, and shared workspace root.

After the user confirms both values, validate that the root and token file exist, create only the derived `stockdata/` child when needed, then configure atomically before creating or running business scripts:

```bash
micromamba run -n cosmos python <skill-dir>/scripts/supermind_runtime.py configure \
  --workspace-root <absolute-cosmos-workspace-root> \
  --token-file <absolute-token-file> \
  --micromamba-env cosmos
```

Treat the binding as identity, not as a convenience default:

- Read `runtime.json` at the start of every later task and verify the root, derived workspace, token file, and environment regardless of the current directory.
- Invoke Python only as `micromamba run -n cosmos python ...`; the runtime rejects execution from a different active environment.
- Change the root, workspace, token-file path, or environment only after the user explicitly authorizes reconfiguration. Preserve the old workspace and token file; never move, merge, copy, overwrite, or delete them implicitly. Only then rerun `configure` with `--reconfigure`; the runtime refuses a conflicting replacement without that flag.
- If request-supplied values conflict with `runtime.json`, stop and show the paths or environment names instead of choosing silently.
- Require `schema_version` to equal `1`. Reject a missing, unknown, or unsupported schema and stop without using that configuration.

Reject any workspace root inside the installed skill, a plugin cache, a marketplace snapshot, an OS temporary directory, or another user's project. Each user owns an independent `<stockdata-workspace>`; their extensions are not automatically shared with other installations.

Inspect `<stockdata-workspace>` and its project instructions before planning:

- For the first requirement, create the smallest reusable `scripts/` implementation and tests in `<stockdata-workspace>`.
- For every later requirement, read its existing entry points, source adapters, tests, dependencies, contracts, and project documents, then extend them without duplicating or discarding accepted capabilities.
- Preserve existing interfaces and behavior unless the user explicitly changes them. Refactor when necessary to keep the cumulative implementation clear.

Marketplace updates must preserve the binding and workspace. Marketplace, plugin, and Skill installation or update must never invoke `configure`, rewrite `runtime.json`, or create, migrate, move, overwrite, or delete `<stockdata-workspace>` content. Updates replace capability code only; the marketplace does not own the user's settings or data. If a capability should become shared by all users, handle that as a separate, explicitly authorized upstream contribution and versioned marketplace release; never treat edits to one installed cache as shared state.

## Establish the requested contract

Confirm the material boundaries of the current requirement:

- instruments or universe;
- fields and their financial definitions, units, and currency;
- frequency, date range, trading calendar, and `Asia/Shanghai` boundary;
- price-adjustment convention where relevant;
- output interface, schema, storage location, and update mode;
- acceptance checks for coverage, freshness, missing values, and duplicates.

Ask only when a missing boundary would materially change the result. Do not invent future requirements, a universal schema, or an all-market full extraction. Treat the user's current request as authorization to implement that requested capability; do not ask again merely because the source ladder reaches baostock or AKShare.

## Follow the source ladder

Evaluate sources at the dataset or field level, in this order:

1. **SuperMind:** Start here. Use official documentation, the user's existing research environment, or one minimal capability probe to verify the exact endpoint, field, date range, and semantics required.
2. **baostock:** Use it only for the portion SuperMind demonstrably cannot supply. First distinguish a real coverage gap from authentication, permissions, rate limits, network failures, or temporary service errors.
3. **AKShare:** Use it only when both SuperMind and baostock cannot cover that portion. Treat web-scraping-backed interfaces as more change-prone and validate them accordingly.

Do not query later sources for routine duplication when an earlier source already meets the contract. A workflow may combine sources, but each dataset or field must have one declared primary source. Never hide a source change behind a common column name.

## Extend the workspace by one vertical slice

For a well-defined change, work test-first:

1. Add contract tests under `<stockdata-workspace>` for the requested fields, dates, identifiers, null behavior, and output shape.
2. Create or extend source-specific adapters under `<stockdata-workspace>/scripts/`; do not replace the cumulative script suite with a new one-off program.
3. Extend the shared entry point and normalize only the fields needed by accepted requirements.
4. Validate a small real sample, including representative instruments, a non-trading day or empty response, and the relevant date and adjustment boundaries.
5. Write retrieved data to a user-selected durable location. Keep the interface reusable through parameters or configuration rather than machine-specific constants; decide deliberately whether generated data belongs in the workspace's `.gitignore`.
6. Run the workspace tests, linter, and build. Update its architecture, changelog, gotchas, and decisions where applicable.

Keep source adapters separate from normalization and delivery. When combining sources, define code mappings, trading-calendar handling, units, adjustment conventions, precedence, and conflict behavior explicitly. Fail visibly when a required source or field is unavailable; do not silently return partial data.

Record enough provenance to reproduce each dataset:

- source and endpoint or function;
- retrieval time and requested market-time range;
- material parameters and adjustment convention;
- source columns and normalization rules;
- source-library version when it can affect behavior.

## Execute SuperMind workspace scripts

Keep SuperMind business logic in `<stockdata-workspace>/scripts/`. Do not copy the generic runtime into the workspace or edit the installed copy. Run a workspace script through the configured per-user token and environment:

```bash
micromamba run -n cosmos python <skill-dir>/scripts/supermind_runtime.py exec-file \
  <absolute-workspace-script> --timeout <seconds>
```

`exec-file` sends the workspace script source but does not pass business arguments or `argv`. Keep a reusable local workspace entry point responsible for validating contract parameters and rendering the smallest remote business script with those values. Allow-list and type-check values, use safe deterministic literal serialization, and never concatenate raw input into executable source. Do not make the generic runtime aware of symbols, fields, dates, output schemas, or other business parameters.

Use `status`, `start-server`, `stop-server`, and `exec` only for generic runtime operations. Use `download <remote-path> --output <absolute-durable-path>` to retrieve a file created remotely; never overwrite an existing local file unless the user explicitly authorizes `--force`. Even with `--force`, the runtime must never overwrite the token file, `runtime.json`, or its sibling binding metadata. The runtime dynamically discovers the JupyterHub account from the user's token, rejects HTTP and WebSocket redirects, redacts token values from errors and output, and always attempts to delete the exact kernel it created.

Business entry points must never call `stop-server`; the Jupyter server is shared account state, while the generic runtime already deletes the exact kernel it creates. Reserve server-control commands for explicit operator requests.

The runtime is transport infrastructure, not a data contract. Never add fields, datasets, dates, workbook sheets, thresholds, or source-selection policy to it. Add those only to cumulative workspace scripts in response to accepted user requirements.

## Resolve runtime and credentials at implementation time

Use the environment recorded in `runtime.json`. Install every approved Python package with `micromamba run -n cosmos uv pip install ...`; never use bare `pip`, `conda`, or `micromamba install`. Before first SuperMind execution, verify the pinned generic runtime dependency and, if installation is authorized and needed, use `micromamba run -n cosmos uv pip install -r <skill-dir>/requirements.txt`. Add a separate workspace-local dependency declaration only when the first business implementation needs it, then maintain it as scripts evolve.

Use each user's own source accounts and project-specific authentication method. Never ask the user to paste credentials into chat. Never place tokens, cookies, account IDs, or downloaded private data in this skill, source control, examples, persistent logs, published datasets, or output metadata. `configure` and `show-config` may display the confirmed workspace path, token-file path, and environment name only to the current user for local binding verification; these commands must never read or display token content, and their output must not be published or persisted as a run log.

## Hard rules

- Do not recreate or assume the removed full-extraction notebook, runner, workbook validator, fixed sheet set, or fixed coverage thresholds.
- Keep only generic, immutable SuperMind transport infrastructure and read-only, contract-neutral implementation references in the installed Skill. Never write runtime state, tokens, executable business scripts, fixed business contracts, or retrieved data into the plugin cache or marketplace snapshot.
- On first use, configure `<cosmos-workspace-root>` and the token-file path together with the fixed micromamba environment `cosmos`, derive `<stockdata-workspace>` as `<cosmos-workspace-root>/stockdata`, then persist only the binding metadata externally. On later uses, reuse and verify the complete binding; never infer replacements from the current directory or host environment.
- Never let marketplace, plugin, or Skill installation or update invoke configuration or alter user-owned runtime metadata, workspace files, credentials, or data.
- Accept only `runtime.json` with `schema_version` equal to `1`; reject missing, unknown, or unsupported schemas.
- Begin each user's `<stockdata-workspace>` with no extraction script. Create its `scripts/` for the first requirement, then evolve those existing scripts for every later requirement.
- Implement only the current requirement, but preserve all previously accepted capabilities in the cumulative skill implementation.
- Preserve the source priority `SuperMind -> baostock -> AKShare` for every dataset or field.
- Distinguish unsupported data from operational failure with empirical evidence.
- Keep China-market dates and trading sessions explicit in `Asia/Shanghai`.
- State the source of every delivered dataset and disclose any mixed-source result.
- Never weaken an agreed acceptance check or present partial output as complete.
- Never claim that one user's workspace changes are automatically shared with other users.
- Share reusable capability across all users only through a separate upstream review and versioned release.
- Do not commit, merge, push, publish, install dependencies, or change unrelated files without the user's authorization. The sole exception is `$fix-report` operating on its independently configured repository for the specified report-only commit and push.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available and run its bundled local readiness preflight, `node "<fix-report-skill-dir>/scripts/publish-report.mjs" preflight --repo "<cosmos-workspace-root>/fix-reports"`; the preflight contacts no network. If the Skill is unavailable, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently. If the preflight fails, stop before modifying packaged content and give the user the exact prerequisite it reports. If this run changes any file distributed with the Cosmos Plugins marketplace, invoke `$fix-report` after validation and before the final response. Pass the already resolved `<cosmos-workspace-root>` when available. Do not invoke `$fix-report` for changes confined to an external workspace, including generated output, retrieved data, runtime configuration, or user-owned business scripts. The report-only commit and push performed by `$fix-report` never authorizes committing or pushing the modified marketplace source repository. After repair validation, `$fix-report` runs automatically, without additional approval or request, for its report-only commit and push.
