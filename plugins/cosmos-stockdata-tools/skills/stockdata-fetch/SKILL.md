---
name: stockdata-fetch
description: >-
  Incrementally build, test, run, and extend China stock-market data scripts in
  each user's durable external workspace, choosing sources in strict priority
  order: SuperMind, then baostock, then AKShare. Use when Codex needs to add,
  change, or execute reusable A-share, index, fund, sector, financial,
  valuation, factor, trading, or security-metadata capabilities. Keep the
  installed skill instruction-only and accumulate only the capabilities that
  user actually requests, without a fixed full extraction or universal schema.
---

# Stockdata Fetch

Grow one persistent stock-data implementation for each user from their successive requirements. Keep the installed skill immutable; create and evolve scripts in a durable workspace outside the plugin.

## Resolve the persistent workspace

Treat the plugin cache, installed skill directory, and marketplace snapshot as read-only, replaceable distribution artifacts. Never store generated scripts, tests, dependencies, configuration, credentials, or retrieved data in them.

Resolve `<stockdata-workspace>` before implementation:

1. Collect every available candidate: an absolute path explicitly supplied in the current request, `STOCKDATA_WORKSPACE` if configured, and the current user's binding file at `~/.config/cosmos-stockdata-tools/workspace`. The binding file contains one absolute workspace path and no credentials.
2. Normalize and compare every candidate. If multiple candidates disagree, stop and show their resolved paths; do not apply priority or choose one silently.
3. On first use, if no candidate exists, require the user to explicitly choose a durable absolute path. Never infer it from the current directory or nearby stockdata files.
4. If the binding file does not exist, take the confirmed candidate whether it came from an explicit path, `STOCKDATA_WORKSPACE`, or the answer to the first-use question; validate it, then atomically write that same resolved path to the binding file before creating or running scripts. Creating the binding's parent directory is part of this disclosed first-use setup.
5. If the binding file exists, require every other supplied candidate to match it before proceeding.

Treat the binding as identity, not as a convenience default:

- Resolve symlinks where possible and verify that the bound directory exists before every change or run.
- Reuse the recorded binding across later tasks, regardless of the current directory.
- Change the binding only after the user explicitly authorizes rebinding or migration. Before rebinding, inspect both locations and preserve the old workspace; never merge, move, copy, or delete it implicitly.
- Write or replace the binding atomically. The binding is local per-user state and must remain outside the plugin, marketplace snapshot, and workspace itself.

Reject any workspace inside the installed skill, a plugin cache, a marketplace snapshot, an OS temporary directory, or another user's project. Each user owns an independent `<stockdata-workspace>`; their extensions are not automatically shared with other installations.

Inspect `<stockdata-workspace>` and its project instructions before planning:

- For the first requirement, create the smallest reusable `scripts/` implementation and tests in `<stockdata-workspace>`.
- For every later requirement, read its existing entry points, source adapters, tests, dependencies, contracts, and project documents, then extend them without duplicating or discarding accepted capabilities.
- Preserve existing interfaces and behavior unless the user explicitly changes them. Refactor when necessary to keep the cumulative implementation clear.

Marketplace updates must preserve `<stockdata-workspace>` because the marketplace does not own or write it. If a capability should become shared by all users, handle that as a separate, explicitly authorized upstream contribution and versioned marketplace release; never treat edits to one installed cache as shared state.

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

## Resolve runtime and credentials at implementation time

Use the environment designated for `<stockdata-workspace>`. For Python work, require a user-designated micromamba environment and install approved packages with `micromamba run -n <env> uv pip install ...`. If no environment is designated, ask the user to create or select one. Add a workspace-local dependency declaration only when the first implementation needs it, then maintain it as scripts evolve.

Use each user's own source accounts and project-specific authentication method. Never ask the user to paste credentials into chat, and never place tokens, cookies, account IDs, machine-specific paths, or downloaded private data in this skill, source control, examples, logs, or output metadata.

## Hard rules

- Do not recreate or assume the removed full-extraction notebook, runner, workbook validator, fixed sheet set, or fixed coverage thresholds.
- Keep the installed Skill instruction-only. Never write runtime state into the plugin cache or marketplace snapshot.
- On first use, require an explicit workspace choice and persist its external binding. On later uses, reuse and verify that binding; never infer another workspace from the current directory.
- Begin each user's `<stockdata-workspace>` with no extraction script. Create its `scripts/` for the first requirement, then evolve those existing scripts for every later requirement.
- Implement only the current requirement, but preserve all previously accepted capabilities in the cumulative skill implementation.
- Preserve the source priority `SuperMind -> baostock -> AKShare` for every dataset or field.
- Distinguish unsupported data from operational failure with empirical evidence.
- Keep China-market dates and trading sessions explicit in `Asia/Shanghai`.
- State the source of every delivered dataset and disclose any mixed-source result.
- Never weaken an agreed acceptance check or present partial output as complete.
- Never claim that one user's workspace changes are automatically shared with other users.
- Share reusable capability across all users only through a separate upstream review and versioned release.
- Do not commit, merge, push, publish, install dependencies, or change unrelated files without the user's authorization.
