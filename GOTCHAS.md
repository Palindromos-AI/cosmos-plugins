# Gotchas

## Distributed skills cannot inherit the developer's runtime bindings

- **Symptom:** An installed skill works on the packaging machine but cannot locate another user's app, output directory, display timezone, or runtime.
- **Root cause:** Machine-specific paths, bundle identifiers, host assumptions, or executable locations were encoded as universal plugin settings.
- **How to avoid:** Keep business invariants fixed, but resolve `<workspace-root>`, `<app-target>`, `<display-timezone>`, and `<node-executable>` for each run. Accept explicit overrides, stop on ambiguous required values, and keep resolved settings out of the packaged skill and reader report.

## The official plugin validator requires PyYAML before validation begins

- **Symptom:** `validate_plugin.py` exits with `ModuleNotFoundError: No module named 'yaml'` and reports no plugin findings.
- **Root cause:** The helper imports PyYAML at process startup, while the host `python3` may not provide that package.
- **How to avoid:** Run the validator in a user-designated micromamba environment that already includes PyYAML. If none is designated, ask the user to create or select one; do not install into or silently choose another environment, and do not describe the startup failure as a manifest validation failure.

## Deleting transport with the full extractor leaves workspace scripts unable to run

- **Symptom:** The Skill correctly stores evolving business scripts outside the plugin, but those scripts cannot authenticate to or execute on SuperMind.
- **Root cause:** Immutable generic execution infrastructure was mistaken for the removed fixed extraction program and deleted with it.
- **How to avoid:** Bundle and version only generic SuperMind configuration, authentication, JupyterHub execution, download, redaction, and owned-kernel cleanup. Keep every dataset, field, date, threshold, workbook, and other mutable business contract in the external workspace.

## Generic transport can still destroy or leak credentials at output and redirect boundaries

- **Symptom:** A forced download replaces a user's token or binding file, or an HTTP/WebSocket redirect forwards authentication to another origin.
- **Root cause:** Generic file and network operations were treated as harmless because they contained no business schema.
- **How to avoid:** Unconditionally protect the configured token and runtime-metadata paths from downloads, including `--force`, and fail closed on all authenticated HTTP and WebSocket redirects.

## A fixed full extractor turns guesses into permanent data contracts

- **Symptom:** The stockdata skill ships many datasets, fields, thresholds, and output sheets that a user never requested, while the next real requirement still requires redesign.
- **Root cause:** One observed extraction workflow was generalized into a universal packaged program instead of treating user requirements as the source of scope.
- **How to avoid:** Keep the bundled runtime generic and create the first reusable business scripts in the user's durable external stockdata workspace only when they ask for a concrete capability. Extend that implementation as requirements arrive, using `SuperMind -> baostock -> AKShare` at field or dataset level.

## An installed Skill is not durable user storage

- **Symptom:** A user's accumulated stockdata scripts disappear after reinstalling or upgrading the plugin, and other users never receive those local edits.
- **Root cause:** A versioned plugin cache was mistaken for shared, persistent storage.
- **How to avoid:** Treat installed plugins and marketplace snapshots as read-only and replaceable. Keep each user's evolving scripts, tests, dependencies, configuration, and data in a durable external `<stockdata-workspace>`. Use an explicit upstream release when a generic capability should be shared across installations.

## Inferring the workspace from the current directory silently forks it

- **Symptom:** A later request extends a second stockdata codebase because Codex was invoked from a different project.
- **Root cause:** The external workspace was treated as a per-call guess rather than persistent user identity.
- **How to avoid:** Require explicit workspace, token-file path, and micromamba environment values together on first use, persist only those metadata values outside the plugin in `runtime.json`, and verify and reuse them thereafter. Do not read older binding formats. Stop on conflicting bindings; require explicit reconfiguration authorization before changing any value, and preserve the old workspace and token file.

## A publisher's source credentials are not distributable plugin state

- **Symptom:** A distributed skill works only on the publisher's machine, or worse, exposes one shared SuperMind credential to every installer.
- **Root cause:** A personal absolute path, token value, or account ID was treated as part of the plugin instead of per-user runtime configuration.
- **How to avoid:** Bind each user's explicitly chosen token-file path in local external metadata while keeping token content only in that file. Never bundle credentials, a publisher's credential path, account IDs, or `/Users/<name>` paths.

## A timestamp's written date is not necessarily its Beijing date

- **Symptom:** A timezone-explicit topic such as `2026-08-03T16:00:00Z` is rejected from the `2026-08-04` ZSXQ archive even though it is exactly Beijing midnight.
- **Root cause:** Comparing the first ten timestamp characters uses the written offset's calendar instead of the plugin's fixed `Asia/Shanghai` boundary. Passing unchecked text directly to JavaScript `Date.parse` also normalizes some nonexistent dates and interprets timezone-less values through the host timezone.
- **How to avoid:** Strictly require a real ISO-8601 date-time with `Z` or a numeric offset, convert the represented instant through the bundled Beijing-date helper before validating membership, and cover invalid dates plus both sides of Beijing midnight with UTC and non-Beijing offsets.

## Marketplace plugin source paths resolve from the repository root

- **Symptom:** A custom validation script looked for a plugin under `.agents/plugins/plugins/<name>` and reported that its manifest was missing.
- **Root cause:** The script resolved `source.path` relative to the directory containing `marketplace.json`; this repository's local marketplace paths are relative to the marketplace repository root.
- **How to avoid:** Resolve each local `./plugins/<name>` marketplace path from the repository root, consistent with the plugin scaffold and Codex marketplace loader.
