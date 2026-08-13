# Gotchas

## Distributed skills cannot inherit the developer's runtime bindings

- **Symptom:** An installed skill works on the packaging machine but cannot locate another user's app, output directory, display timezone, or runtime.
- **Root cause:** Machine-specific paths, bundle identifiers, host assumptions, or executable locations were encoded as universal plugin settings.
- **How to avoid:** Keep business invariants fixed, but resolve `<workspace-root>`, `<app-target>`, `<display-timezone>`, and `<node-executable>` for each run. Accept explicit overrides, stop on ambiguous required values, and keep resolved settings out of the packaged skill and reader report.

## The official plugin validator requires PyYAML before validation begins

- **Symptom:** `validate_plugin.py` exits with `ModuleNotFoundError: No module named 'yaml'` and reports no plugin findings.
- **Root cause:** The helper imports PyYAML at process startup, while the host `python3` may not provide that package.
- **How to avoid:** Run the validator in a user-designated micromamba environment that already includes PyYAML. If none is designated, ask the user to create or select one; do not install into or silently choose another environment, and do not describe the startup failure as a manifest validation failure.

## A fixed full extractor turns guesses into permanent data contracts

- **Symptom:** The stockdata skill ships many datasets, fields, thresholds, and output sheets that a user never requested, while the next real requirement still requires redesign.
- **Root cause:** One observed extraction workflow was generalized into a universal packaged program instead of treating user requirements as the source of scope.
- **How to avoid:** Keep `stockdata-fetch` instruction-only. Create the first reusable scripts in the user's durable external stockdata workspace only when they ask for a concrete capability, then extend that implementation as requirements arrive, using `SuperMind -> baostock -> AKShare` at field or dataset level.

## An installed Skill is not durable user storage

- **Symptom:** A user's accumulated stockdata scripts disappear after reinstalling or upgrading the plugin, and other users never receive those local edits.
- **Root cause:** A versioned plugin cache was mistaken for shared, persistent storage.
- **How to avoid:** Treat installed plugins and marketplace snapshots as read-only and replaceable. Keep each user's evolving scripts, tests, dependencies, configuration, and data in a durable external `<stockdata-workspace>`. Use an explicit upstream release when a generic capability should be shared across installations.

## Inferring the workspace from the current directory silently forks it

- **Symptom:** A later request extends a second stockdata codebase because Codex was invoked from a different project.
- **Root cause:** The external workspace was treated as a per-call guess rather than persistent user identity.
- **How to avoid:** Require an explicit absolute path on first use, persist it outside the plugin through `STOCKDATA_WORKSPACE` or `~/.config/cosmos-stockdata-tools/workspace`, and verify and reuse it thereafter. Stop on conflicting bindings; require explicit migration authorization before changing the path, and preserve the old workspace.

## A publisher's source credentials are not distributable plugin state

- **Symptom:** A distributed skill works only on the publisher's machine, or worse, exposes one shared SuperMind credential to every installer.
- **Root cause:** A personal absolute path, token value, or account ID was treated as part of the plugin instead of per-user runtime configuration.
- **How to avoid:** Resolve authentication from the user's project and source environment at implementation time; never bundle credentials, fixed credential paths, account IDs, or `/Users/<name>` paths.

## A timestamp's written date is not necessarily its Beijing date

- **Symptom:** A timezone-explicit topic such as `2026-08-03T16:00:00Z` is rejected from the `2026-08-04` ZSXQ archive even though it is exactly Beijing midnight.
- **Root cause:** Comparing the first ten timestamp characters uses the written offset's calendar instead of the plugin's fixed `Asia/Shanghai` boundary. Passing unchecked text directly to JavaScript `Date.parse` also normalizes some nonexistent dates and interprets timezone-less values through the host timezone.
- **How to avoid:** Strictly require a real ISO-8601 date-time with `Z` or a numeric offset, convert the represented instant through the bundled Beijing-date helper before validating membership, and cover invalid dates plus both sides of Beijing midnight with UTC and non-Beijing offsets.

## Marketplace plugin source paths resolve from the repository root

- **Symptom:** A custom validation script looked for a plugin under `.agents/plugins/plugins/<name>` and reported that its manifest was missing.
- **Root cause:** The script resolved `source.path` relative to the directory containing `marketplace.json`; this repository's local marketplace paths are relative to the marketplace repository root.
- **How to avoid:** Resolve each local `./plugins/<name>` marketplace path from the repository root, consistent with the plugin scaffold and Codex marketplace loader.
