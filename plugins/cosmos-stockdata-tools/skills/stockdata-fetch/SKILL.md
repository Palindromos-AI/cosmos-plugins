---
name: stockdata-fetch
description: Fetch, download, validate, inspect, or extend daily China A-share and index data through the bundled SuperMind extraction runtime. Use when the user asks to 获取、更新、下载、检查或补充 A 股、指数、行情、情绪、概念板块、融资融券、估值或证券元数据，or needs to operate or troubleshoot SuperMind stock-data extraction. Supports the latest completed Beijing trading day and explicit historical trading dates; interpret every date boundary in Asia/Shanghai.
---

# Stockdata Fetch

Use the bundled SuperMind notebook, portable JupyterHub driver, and local workbook validator. Do not depend on an external project checkout.

## Resolve the runtime

1. Locate this skill directory from the active `SKILL.md`; never assume an installation path.
2. Set these conceptual paths:

```text
RUNNER=<skill-dir>/scripts/run_extract.py
VALIDATOR=<skill-dir>/scripts/validate_workbook.py
REQUIREMENTS=<skill-dir>/requirements.txt
```

3. Use a user-designated Python 3.10+ environment. If none has been designated, ask before selecting or creating one.
4. The driver imports command-specific local dependencies, verifies their pinned distribution versions and required APIs, and does so before any remote mutation. Before installing missing packages, ask for approval and install `REQUIREMENTS` with the environment's required package manager.
5. Resolve output to an absolute, durable directory. Default to `<current-project>/data/supermind` unless the user supplies another location. `run` and `fetch` reject OS temporary directories; use the global `--allow-temporary-output` option only for an explicitly disposable test.

Every user needs their own SuperMind research account and JupyterHub API token. The distributed plugin never provides, shares, or inherits the publisher's token. Do not ask a user to paste a token into chat. By default, read that user's token from `~/.config/supermind/token`, where `~` is the current user's home directory. The user should create the directory with mode `700` and the token file with mode `600`.

Resolve credentials in this order:

1. `SUPERMIND_TOKEN`, for an ephemeral value injected by the user's environment or secret manager.
2. An explicit global `--token-file <path>` option.
3. The path in `SUPERMIND_TOKEN_FILE`.
4. The per-user default `~/.config/supermind/token`.

Every token file must remain outside both the installed plugin and output directory. Never place credentials inside the plugin, output tree, command output, version control, examples, or marketplace metadata. The driver discovers the authenticated SuperMind user ID from the user's token. Jupyter websocket authentication includes the token in the connection query because that is the verified SuperMind transport; the remote service or an intervening proxy may therefore record it in access logs. Use a revocable token and rotate it after suspected exposure.

## Resolve the request

- Distinguish inspecting status, downloading an existing cloud result, running a fresh full extraction, and probing a new field.
- Treat “today,” relative dates, trading-day boundaries, filenames, and reports as `Asia/Shanghai`, regardless of the host timezone.
- Default an unspecified extraction date to the latest completed Beijing trading day. The bundled notebook applies a 15:05 Beijing cutoff.
- Keep all results local unless the user separately authorizes publishing or messaging them.

## Use the SuperMind workflow

Run global options before the command:

```bash
<python> "$RUNNER" --output-dir "<absolute-output-dir>" status
```

Available commands:

- `status`: show server, kernel, cloud workbook, and last-trigger state. Cloud files are listed only when the research server is running.
- `start-server` / `stop-server`: manage the research server.
- `run [--date YYYY-MM-DD]`: push an in-memory run copy and submit the full extraction. Omit `--date` for the latest completed trading day.
- `watch [--seconds 2400]`: stream subsequent output until the kernel is idle or the timeout expires.
- `fetch [--date YYYY-MM-DD] [--allow-existing]`: download a workbook and automatically run the bundled local validator. Without `--allow-existing`, it must be newer than the cloud-file baseline recorded by the latest submitted run.
- `exec "CODE" [--timeout 120]`: execute one minimal capability probe.
- `push`: restore the packaged default notebook to the cloud without launching an extraction.
- `recover`: resolve a recorded `cleanup_failed` run by restoring the packaged default notebook and deleting that run's exact recorded kernel. Both actions must be confirmed before another `run` is allowed.
- `pull --output <path>`: save a stripped cloud notebook snapshot outside the plugin; it never overwrites the packaged notebook.

Global `--allow-temporary-output` permits `run` or `fetch` under an OS temporary directory only for a disposable test. Put it before the command, and never use it for a result the user expects to retain.

### Download an existing result

1. Run `status` once.
2. If the server is stopped, run `start-server`, then run `status` again.
3. Confirm the requested date exists in a cloud filename.
4. Run `fetch --allow-existing --date YYYY-MM-DD` once. `--allow-existing` is explicit because this branch intentionally has no fresh-run baseline.
5. Accept the result only when `fetch` exits zero and prints `VALIDATION PASSED`.

### Run a fresh extraction

1. Run `status` to inspect current state. `run` also rejects observed `busy`, `starting`, or `restarting` kernels and serializes same-account submissions started on the same machine. SuperMind does not expose a cross-host atomic lock, so the status check still matters when another machine can use the same account.
2. If no equivalent job or valid cloud result exists, run `run` once. Add `--date YYYY-MM-DD` only for an explicit historical trading date.
3. Do not edit the packaged notebook to select a date. The driver applies the date in memory, submits it, and immediately restores the cloud notebook to `TARGET_DATE = None`. Its failure path performs the same restoration and removes a partially submitted kernel. It records `aborted` only after both required cleanup actions are confirmed. An unconfirmed kernel deletion or cloud-notebook restoration records `cleanup_failed`, preserves each failure independently, and blocks every later `run` until `recover` succeeds.
4. Attach `watch --seconds 2400`; keep the terminal session alive and provide periodic user updates rather than triggering another run.
5. After the kernel becomes idle, run `fetch` for the target date without `--allow-existing`. The driver parses cloud timestamps as absolute UTC instants and requires the result to be strictly newer than both the saved baseline and this run's start time. Treat the local validator as the final authority even when the console output appeared successful.

If cleanup reports `cleanup_failed`, stop. Run `recover` once; do not launch another extraction unless it confirms both the canonical cloud notebook and exact-kernel deletion.

## Validate fail-closed

`fetch` validates a uniquely named temporary download before replacing any local workbook. When validation fails, it leaves an `.invalid-<UTC timestamp>.xlsx` diagnostic beside the intended output, preserves any prior valid local file, and exits non-zero. It checks:

- workbook readability and all nine expected sheets;
- the filename/content Beijing date;
- stock-row and full-index-row minimums;
- at least 4,000 indexes with a non-null close, with `has_quote` exactly matching close availability;
- exact packaged common-index count;
- `high >= low` for non-null stock rows;
- industry and concept coverage;
- non-empty theme membership, margin-financing, and valuation data.

The validator reads `INDEX_CODES`, `MIN_ALL_INDEXES`, and `MIN_QUOTED_INDEXES` from the packaged notebook, so those contracts cannot silently drift. Never weaken a threshold, accept a missing valuation sheet, or present a retained failed workbook as complete.

To revalidate an already-downloaded file without any network call, run:

```bash
<python> "$VALIDATOR" "/absolute/path/supermind_full_YYYYMMDD.xlsx"
```

## Handle new data requirements

1. Use one minimal `exec` probe to determine whether SuperMind exposes the required function or field.
2. If supported, propose the exact packaged notebook sheet or field change and wait for scope confirmation before editing plugin source.
3. If unsupported, explain the confirmed SuperMind coverage gap and ask whether the user wants a fallback script. Do not silently switch sources or treat a transient SuperMind failure as a coverage gap.
4. After the user approves a fallback extension, check baostock coverage first. Prefer baostock whenever it can satisfy the requirement because it provides a free API with a higher expected request success rate. Use akshare only when baostock cannot cover the requirement or the user explicitly directs otherwise; disclose that akshare's web-scraping-dependent endpoints have a higher failure risk when upstream pages change.
5. Propose the exact fallback script, output provenance, and validation changes, then wait for the user's explicit approval before editing plugin source. Keep fallback code separate from the SuperMind notebook so every result's source remains explicit.
6. Treat `<skill-dir>/scripts/extract_daily.ipynb` in the marketplace source repository as the sole trusted SuperMind extraction program. If the installed plugin cache is not writable source, report its path instead of patching it in place.

Do not perform routine cross-source validation. Use a temporary cross-source spot check only when output is abnormal or extraction logic changed.

## Failure handling

- `401` or `403`: ask the user to issue a new SuperMind token; never expose the old token.
- Server cannot start: stop then start once. If it still fails, report likely platform maintenance rather than looping.
- `InputRejected` immediately: treat it as compile-time review rejection. Rewrite forbidden constructs such as `import sys`, `DataFrame.eval`, or `DataFrame.query`; retrying identical code will not help.
- Kernel idle with no current workbook: report the captured error and cloud timestamp; never fetch an older file as success.
- Fresh `fetch` reports that the cloud workbook is unchanged: treat the run as failed or incomplete. Use `--allow-existing` only when the user explicitly asked to retrieve a pre-existing result.
- Validation fails because valuation is empty: explain that SuperMind valuation data is normally populated later that evening and wait for a later rerun.
- Network, websocket, permission, or dependency error: surface the exact non-zero path. Do not hide it behind a fallback.
- Missing local dependency: the command must fail before pushing a notebook or creating a kernel. Ask before installing the pinned requirements, then retry once after installation.
- Run state reports `cleanup_failed`: the driver refuses every new `run`, even if the recorded kernel appears idle or absent. Run `recover`; it restores the canonical cloud notebook and deletes only the exact recorded kernel, treating `404` as confirmed absence. Continue only after recovery exits zero.

## Hard rules

- Keep Beijing time explicit in commands, filenames, validation, and reports.
- Keep the packaged notebook as the sole executable source of truth for SuperMind extraction.
- Never copy, print, commit, or bundle a token.
- Never launch duplicate full extractions or repeatedly probe a failing source.
- Never weaken validation or report partial output as complete.
- Never write a retained result under an OS temporary directory; require a durable output path unless the user explicitly requested a disposable test.
- Do not add fallback code until a SuperMind coverage gap is confirmed and the user approves the exact extension.
- For an approved fallback, use baostock when it covers the requirement; use akshare only when baostock does not cover it or the user explicitly requests akshare.
- Do not commit, merge, push, install, publish, or change unrelated files unless the user separately authorizes that action.
