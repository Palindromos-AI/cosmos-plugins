# Gotchas

## Distributed skills cannot inherit the developer's runtime bindings

- **Symptom:** An installed skill works on the packaging machine but cannot locate another user's app, output directory, display timezone, or runtime.
- **Root cause:** Machine-specific paths, bundle identifiers, host assumptions, or executable locations were encoded as universal plugin settings.
- **How to avoid:** Keep business invariants fixed, but resolve `<workspace-root>`, `<app-target>`, `<display-timezone>`, and `<node-executable>` for each run. Accept explicit overrides, stop on ambiguous required values, and keep resolved settings out of the packaged skill and reader report.

## The official plugin validator requires PyYAML before validation begins

- **Symptom:** `validate_plugin.py` exits with `ModuleNotFoundError: No module named 'yaml'` and reports no plugin findings.
- **Root cause:** The helper imports PyYAML at process startup, while the host `python3` may not provide that package.
- **How to avoid:** Run the validator in a user-designated micromamba environment that already includes PyYAML. If none is designated, ask the user to create or select one; do not install into or silently choose another environment, and do not describe the startup failure as a manifest validation failure.

## A publisher's working token configuration is not distributable plugin state

- **Symptom:** A distributed skill works only on the publisher's machine, or worse, exposes one shared SuperMind credential to every installer.
- **Root cause:** A personal absolute path, token value, or account ID was treated as part of the plugin instead of per-user runtime configuration.
- **How to avoid:** Resolve the current user's own token from `SUPERMIND_TOKEN`, an explicit/configured token-file path, or `~/.config/supermind/token`; never bundle credentials or `/Users/<name>` paths, and state the per-user ownership contract in `SKILL.md`.

## A complete index catalog can still contain too few usable quotes

- **Symptom:** `indexes_all` passes the 20,000-row minimum even when most rows have no closing price.
- **Root cause:** SuperMind's index catalog contains many active metadata records whose source families do not expose daily quotes through `get_price`; catalog completeness and quote coverage are different contracts. Three observed trading dates contained 23,307–23,637 catalog rows but 4,076, 17,174, and 4,108 quoted rows.
- **How to avoid:** Require at least 20,000 catalog rows and 4,000 non-null closes independently, require `has_quote` to match close availability exactly, and read both floors from the packaged notebook so cloud and local validation cannot drift.

## Local dependency checks must happen before cloud mutation

- **Symptom:** A missing `websocket-client` package is discovered only after the notebook is pushed and a kernel is created.
- **Root cause:** The driver imported the websocket transport only when connecting to the newly created kernel.
- **How to avoid:** Import each command-specific module, verify the pinned distribution version and required APIs, and do so before starting the server, pushing the notebook, creating a kernel, downloading a workbook, or writing run state.

## Kernel cleanup alone does not make failed run state accurate

- **Symptom:** A failed submission deletes its kernel but leaves `.runstate.json` at `phase: submitting`.
- **Root cause:** The driver recorded `aborted` only for a narrow cloud-restoration failure after full submission.
- **How to avoid:** Confirm both cleanup boundaries: delete the owned kernel and restore the canonical cloud notebook after a historical run. Record `phase: aborted` only when both are safe; otherwise record `cleanup_failed`, preserve the two errors independently, block every new run before remote inspection, and require explicit `recover` to resolve the exact recorded run.

## A temporary worktree is not a durable stock-data destination

- **Symptom:** A valid workbook is delivered from `/tmp` or `/private/tmp` and disappears when the disposable worktree is removed.
- **Root cause:** The default output path follows the current working directory, which may itself be temporary.
- **How to avoid:** Reject `run` and `fetch` output under OS temporary roots unless the caller explicitly uses `--allow-temporary-output` for a disposable test; always print the resolved output directory before remote work.

## OpenPyXL requires the temporary download to keep an Excel suffix

- **Symptom:** A valid downloaded workbook fails before validation with `InvalidFileException` when its temporary filename ends in `.part`.
- **Root cause:** OpenPyXL checks the path's final extension before opening the ZIP container; valid Excel bytes do not override an unsupported suffix.
- **How to avoid:** Give validate-before-replace temporary files a unique name that still ends in `.xlsx`, and include a test that opens that exact temporary path with real OpenPyXL rather than mocking the validator completely.

## Kernel cleanup must be tied to explicit run ownership

- **Symptom:** `watch` can attach to and delete an unrelated interactive notebook kernel when the extraction kernel is absent.
- **Root cause:** Falling back to the first active kernel confuses “a kernel exists” with “this workflow owns that kernel.”
- **How to avoid:** Attach and clean up only the kernel ID atomically recorded in the extraction `.runstate`; when it is missing or inactive, never fall back to another kernel.

## A valid same-name workbook may still be stale

- **Symptom:** A rerun fails remotely, but `fetch` downloads an older same-date workbook and its contents pass every structural check, creating a false success.
- **Root cause:** Filename and workbook validation prove the file's shape and date, not that this run created or updated it.
- **How to avoid:** Record every cloud workbook's `last_modified` value before submission, atomically advance the local run state through `preparing`, `submitting`, and `submitted`, parse timestamps as timezone-aware absolute instants, and accept a fresh-run result only when it is strictly newer than both the baseline and run start. Require an explicit `--allow-existing` flag for intentional historical downloads.

## A timestamp's written date is not necessarily its Beijing date

- **Symptom:** A timezone-explicit topic such as `2026-08-03T16:00:00Z` is rejected from the `2026-08-04` ZSXQ archive even though it is exactly Beijing midnight.
- **Root cause:** Comparing the first ten timestamp characters uses the written offset's calendar instead of the plugin's fixed `Asia/Shanghai` boundary. Passing unchecked text directly to JavaScript `Date.parse` also normalizes some nonexistent dates and interprets timezone-less values through the host timezone.
- **How to avoid:** Strictly require a real ISO-8601 date-time with `Z` or a numeric offset, convert the represented instant through the bundled Beijing-date helper before validating membership, and cover invalid dates plus both sides of Beijing midnight with UTC and non-Beijing offsets.

## Marketplace plugin source paths resolve from the repository root

- **Symptom:** A custom validation script looked for a plugin under `.agents/plugins/plugins/<name>` and reported that its manifest was missing.
- **Root cause:** The script resolved `source.path` relative to the directory containing `marketplace.json`; this repository's local marketplace paths are relative to the marketplace repository root.
- **How to avoid:** Resolve each local `./plugins/<name>` marketplace path from the repository root, consistent with the plugin scaffold and Codex marketplace loader.

## A historical-date override must never persist in the cloud notebook

- **Symptom:** A later default extraction unexpectedly reruns an old trading date after an earlier historical submission failed or was interrupted.
- **Root cause:** Uploading a notebook whose `TARGET_DATE` was edited in place can leave that override in the packaged file or cloud copy when failure occurs between upload, kernel creation, websocket connection, and cell submission.
- **How to avoid:** Keep the packaged notebook fixed at `TARGET_DATE = None`; create historical run copies in memory, restore the default cloud notebook immediately after successful submission and in every failure path, delete partially submitted kernels, and cover both success and failure cleanup with offline tests.
