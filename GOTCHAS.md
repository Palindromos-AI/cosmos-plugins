# Gotchas

## Distributed skills cannot inherit the developer's runtime bindings

- **Symptom:** An installed skill works on the packaging machine but cannot locate another user's app, output directory, display timezone, or runtime.
- **Root cause:** Machine-specific paths, bundle identifiers, host assumptions, or executable locations were encoded as universal plugin settings.
- **How to avoid:** Keep business invariants fixed, but resolve `<workspace-root>`, `<app-target>`, `<display-timezone>`, and `<node-executable>` for each run. Accept explicit overrides, stop on ambiguous required values, and keep resolved settings out of the packaged skill and reader report.

## The official plugin validator requires PyYAML before validation begins

- **Symptom:** `validate_plugin.py` exits with `ModuleNotFoundError: No module named 'yaml'` and reports no plugin findings.
- **Root cause:** The helper imports PyYAML at process startup, while the host `python3` may not provide that package.
- **How to avoid:** Run the validator in a user-designated micromamba environment that already includes PyYAML. If none is designated, ask the user to create or select one; do not install into or silently choose another environment, and do not describe the startup failure as a manifest validation failure.

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
