# Gotchas

## A blocklist protects only the destinations someone thought of

- **Symptom:** stockdata `download --force` could overwrite `~/.zshrc`, another Cosmos plugin's `runtime.json`, or any file sitting next to the token file; only the exact token path, this plugin's config directory, and the plugin tree were protected.
- **Root cause:** Output protection enumerated known-dangerous destinations instead of allowing only the intended output area, so everything not on the list was writable.
- **How to avoid:** Confine generic transport output to the configured workspace by default and demand an explicit flag for anything outside it; keep unconditional refusals only for credential and configuration directories that must never be written even with every flag set.

## Echoing a provider field can leak an account identifier the fixture never showed

- **Symptom:** stockdata `status` printed JupyterHub's `server` field, which is `/user/<account>/` and therefore contains the account name, violating the no-account-identifiers rule; the test passed because its fixture used `server: None`.
- **Root cause:** Provider-returned values were printed verbatim, and the test fixture did not mirror the real API response shape, so the assertion could never encounter the leak.
- **How to avoid:** Print derived state (`running`/`stopped`) instead of provider payload fields, build fixtures from real response shapes, and assert that the sensitive value is absent from the output.

## A safety check patched out in setUp is never actually tested

- **Symptom:** The temporary-directory rejection in the stockdata runtime had zero real coverage: `setUp` patched `is_temporary_workspace` to `False` for every test because fixtures live under the OS temporary directory.
- **Root cause:** A global convenience patch silently disabled the behavior under test in the whole suite, and no test restored it.
- **How to avoid:** Keep a module-level reference to the real function before any patching and dedicate tests that re-patch it back in, covering both the unit predicate and the integration path that relies on it.

## Near-copy skills drift apart one fix at a time

- **Symptom:** A rule fixed in one chat skill (a forwarded-message clause, a repair-contract clarification) silently never reaches its twin; the two SKILL.md files and their per-skill script copies accumulate small behavioral differences.
- **Root cause:** `dingding-fetch` and `feishu-fetch` were maintained as ~95% verbatim copies with no mechanism forcing edits to land in both.
- **How to avoid:** Keep shared behavior in one parameterized plugin-level script (`chat-publish-report.mjs`, `chat-repair-state.mjs`) and let `tests/chat-skill-drift.test.mjs` fail on any SKILL.md divergence outside the whitelisted Feishu-specific capabilities; extend the whitelist deliberately, never by weakening the test.

## A hand-rolled YAML subset silently corrupts valid frontmatter

- **Symptom:** Pages written by Obsidian or other tools lose their aliases and draw error-level lint findings (`missing-tag`, `missing-source-citation`) even though the frontmatter is valid YAML; the model then "repairs" correct pages.
- **Root cause:** The frontmatter parser required indented sequence items (`^\s+-`), while column-0 `- item` is equally valid YAML and common in the wild; a BOM prefix also made the frontmatter block invisible to the opening-fence regex.
- **How to avoid:** When parsing a format subset by hand, test against what real tools emit (column-0 lists, BOM, quoted scalars), not only against what this codebase writes; strip the BOM before matching and accept both indentation forms.

## Checking report readiness after the repair loses the record

- **Symptom:** A packaged repair succeeds, but the report repository turns out to be missing, unborn, or out of sync; the report is never written, or one failed push leaves every later report permanently blocked behind a "synchronized branch" requirement.
- **Root cause:** Readiness and synchronization were verified only at reporting time, after the packaged change already existed, and the sync check required exactly `0 0` so a locally preserved commit from an earlier push failure could never be delivered.
- **How to avoid:** Run the local-only `publish-report.mjs preflight` before modifying any packaged file and stop on its exact prerequisite; always commit the report locally before contacting the network; treat "ahead of upstream" as deliverable backlog (after verifying every unpushed commit touches only report paths), and only "behind upstream" as a stop condition.

## A CLI invoked through a symbolic link exits 0 and does nothing

- **Symptom:** `node <symlinked-dir>/scripts/<tool>.mjs ...` prints nothing and exits 0; the same command through the real path works. Codex's own plugin cache and user checkouts can be symlinked.
- **Root cause:** The "run as main module" guard compared `process.argv[1]` (kept exactly as typed) with `import.meta.url` (which Node resolves through symbolic links), so the script decided it was being imported as a library.
- **How to avoid:** Every entry guard uses the shared `isMainModule()` shape: accept the entry if either the typed `process.argv[1]` or its `realpathSync` result matches the module's own path (compared in path space via `fileURLToPath`, or in URL space via `pathToFileURL`, whichever the file already imports; accepting both forms also keeps `--preserve-symlinks-main` working). `tests/cli-entry-points.test.mjs` runs every CLI through a symlinked directory and must stay in sync when a CLI is added. Apply the same rule to any path comparison: compare canonical with canonical (see the sources temporary-root check).

## Maintainer-machine names leak into distributed files and repository docs

- **Symptom:** A customer's Codex is told to run Python in an environment named after the maintainer's own vault, to prefer Defuddle over another agent product's fetch tool, to archive the maintainer's own Knowledge Planet by name, or to skip a specific vault plugin—none of which exist on the customer's machine—and repository docs cloned by `codex plugin marketplace add` name the maintainer's private planet.
- **Root cause:** Skills were written and tested against the maintainer's environment, and copied Skills kept wording aimed at a different agent product; nothing scanned distributed text for machine-, account-, or product-specific names before release.
- **How to avoid:** Fix shared conventions once (Python environment `cosmos`, `uv pip`) instead of naming ad-hoc environments; use placeholders such as `<星球名称>` in default prompts; describe fixtures generically in DECISION/GOTCHAS; grep the tree for environment names, planet or group names, tool names from other agents, and development-project package names before every release.

## A fix report can escape its repository, capture unrelated state, or push source code

- **Symptom:** A report is generated for ordinary user data changes, lands outside `fix-reports`, contains unrelated local content, or a repair workflow pushes the modified marketplace source repository.
- **Root cause:** The reporting boundary was inferred from the active task instead of its changed packaged paths, report components were concatenated without traversal or symbolic-link checks, dynamic Git operands were treated as shell syntax, or the report repository and source repository were treated as one Git operation.
- **How to avoid:** Preflight `fix-report` before modifying marketplace-distributed files so a missing companion stops before any unattributable change; invoke it only for packaged files changed by the current parent task, write every report through `write-report.mjs` standard input and its single exclusive handle, exclude every external workspace and runtime artifact, initialize only `<cosmos-workspace-root>/fix-reports`, and publish through the bundled deterministic publisher, which passes every dynamic Git operand as argument-array data, requires a clean repository (unpushed report commits are deliverable backlog), verifies the report path and blob before and after the automatic commit, pushes only verified report-only commits to the preverified upstream branch, and never commits or pushes the modified marketplace source repository. The only authorization exception is the separately scoped report-only commit.

## A collector result can be semantically correct but use the wrong runner envelope

- **Symptom:** Timeline coverage and topic discovery succeed, but `record-inventory` rejects the collector result with `inventory: must be an object`.
- **Root cause:** The collector returned the topic array directly while the runner contract requires a top-level `{ "topics": [...] }` object.
- **How to avoid:** Treat the collector-to-runner boundary as a strict integration contract, return the complete runner-ready object, and test the actual successful collector result through `normalizeInventory` rather than testing only an array-mapping helper.

## Joined planets may omit the direct read-count node

- **Symptom:** Collection stops with `TOPIC_FIELD_MISMATCH` or `DETAIL_FIELD_MISMATCH` even though the visible timestamp is valid.
- **Root cause:** The adapter required exactly one `.readed-count` child based on a page variant that is not present in every joined planet.
- **How to avoid:** In v6 accept zero or one direct read-count child, keep owned-text timestamp extraction, reject duplicates, and never add a planet-ownership branch for this structural difference.

## Updating capability code must not become a workspace migration

- **Symptom:** Installing or upgrading a marketplace plugin changes a user's configured path, rewrites runtime metadata, or moves/deletes files in `sources/` or `stockdata/`.
- **Root cause:** Replaceable plugin files were treated as the owner of external user state, or a new path/schema convention was applied automatically during update.
- **How to avoid:** Keep one independent external `runtime.json` per plugin, require the current versioned schema, require explicit authorization for rebinding, reject missing or unsupported schemas, and never invoke configuration or workspace mutation from marketplace, plugin, or Skill installation/update flows.

## A successful repair must not reset the run's repair budget

- **Symptom:** DingTalk or Feishu collection repairs one group successfully, then repeatedly repairs later failures and consumes unbounded tokens.
- **Root cause:** The repair counter was scoped to a group, phase, or failure instead of the whole frozen run, or its state was deleted after a successful resume.
- **How to avoid:** Create one atomic `repair-state.json` per run, consume its only attempt before changing procedure or code, keep it through every group and thread, and treat `repair-limit-reached`, missing-after-use, corrupt, replaced, or conflicting state as a hard stop for further repair.

## Automatic repair does not broaden task authority

- **Symptom:** A ZSXQ browser-contract failure is treated as permission to commit, install dependencies, bypass access controls, change unrelated files, or redesign the collector.
- **Root cause:** Automatic authorization for the narrow repair-and-resume workflow was confused with authorization for other repository, environment, or remote-system mutations.
- **How to avoid:** Automatically diagnose and repair only reproducible adapter or collector defects, preserve the fail-closed and checkpoint contracts, and request any separately required authorization for commits, merges, pushes, publishing, dependency installation, access-control changes, or unrelated edits.

## A protected PDF viewer can still provide an official member download

- **Symptom:** A ZSXQ PDF is reported as “仅允许在 App 查看” even though its web file-detail dialog visibly offers `下载文件`.
- **Root cause:** Inline-view protection was incorrectly treated as proof that every web acquisition route was blocked.
- **How to avoid:** Open the exact inventoried file card, verify the preview filename and one visible official download control, wait for the browser download event, then copy and extract that exact artifact locally. Do not guess duplicate filenames or use undocumented private APIs.

## A timestamp container can acquire visible metadata children without changing its selector

- **Symptom:** ZSXQ collection stops with `TIMESTAMP_FORMAT_MISMATCH` even though the screenshot visibly shows `YYYY-MM-DD HH:mm`.
- **Root cause:** The `.info > .date` element gained a direct `.readed-count` child, so `innerText` combined the timestamp and `阅读人数 N` even though the timestamp element itself still matched the old selector.
- **How to avoid:** Version the adapter and read only the timestamp element's owned text node. Historical v4 requires exactly one direct read-count child; active v6 accepts zero or one and rejects duplicates. Preserve older adapters unchanged for fixtures and rollback.

## A new planet may reach the absolute timeline end before showing an older date

- **Symptom:** Daily coverage cannot exit pagination when every topic in a newly created planet belongs to the target date and the UI already shows `没有更多了`.
- **Root cause:** The collector accepted only an older visible topic as a lower boundary and ignored the platform's exact absolute-end marker.
- **How to avoid:** Treat one exact direct `.no-more` marker with the expected text as a stronger lower-bound proof, include it in stabilization, and continue to fail closed when the marker is absent or structurally ambiguous.

## Package file assertions must ignore generated Python bytecode caches

- **Symptom:** The stockdata marketplace test fails after otherwise successful Python unit tests because `__pycache__` appears in the source tree.
- **Root cause:** The file assertion enumerated ignored runtime artifacts even though `.gitignore` excludes Python bytecode from the packaged source contract.
- **How to avoid:** Exclude `__pycache__` directories and `.pyc`, `.pyo`, and `.pyd` files when asserting the exact distributable skill tree.

## SuperMind research kernels can reject ordinary local-Python patterns before execution

- **Symptom:** A script that is valid locally is rejected by remote input review, fails on a newer pandas alias, or cannot write Parquet.
- **Root cause:** The observed research runtime rejected selected imports, reflection, and direct file access; its pandas lacked `DataFrame.isna()`; and neither `pyarrow` nor `fastparquet` was installed.
- **How to avoid:** Follow `supermind-api-patterns.md`: keep remote code explicit, use compatible pandas operations, treat the rejection list as observed rather than exhaustive, preserve index-based business keys as named columns, and use pandas CSV/JSON writers as temporary transport before local validation and conversion.

## A business extractor does not own the shared SuperMind Jupyter server

- **Symptom:** Cleaning up one extraction disrupts unrelated work by stopping the account-level Jupyter service.
- **Root cause:** Server state was mistaken for a resource created and owned by the extraction.
- **How to avoid:** Business entry points never call `stop-server`. The generic runtime deletes only the exact kernel it creates; server-control commands remain explicit operator actions.

## Downloading a remote transport file is not remote cleanup

- **Symptom:** Temporary result files remain in the shared research environment after a successful local delivery, or concurrent runs reuse one remote name.
- **Root cause:** The generic runtime downloads files but has no verified remote-file deletion command, and `exec-file` passes source code without business `argv`.
- **How to avoid:** Have the reusable local workspace entry point validate parameters, render a minimal remote script, and choose a collision-resistant output path. Keep transport content minimal, disclose the retention boundary, and stop before extraction when the privacy contract requires verified remote deletion.

## Distributed skills cannot inherit the developer's runtime bindings

- **Symptom:** An installed skill works on the packaging machine but cannot locate another user's app, output directory, display timezone, or runtime.
- **Root cause:** Machine-specific paths, bundle identifiers, host assumptions, or executable locations were encoded as universal plugin settings.
- **How to avoid:** Keep business invariants fixed, but resolve `<workspace-root>`, `<app-target>`, and `<node-executable>` for each run (the display timezone is no longer resolved: every timezone is fixed to Beijing by the 2026-08-19 decision). Accept explicit overrides, stop on ambiguous required values, and keep resolved settings out of the packaged skill and reader report.

## The official plugin validator requires PyYAML before validation begins

- **Symptom:** `validate_plugin.py` exits with `ModuleNotFoundError: No module named 'yaml'` and reports no plugin findings.
- **Root cause:** The helper imports PyYAML at process startup, while the host `python3` may not provide that package.
- **How to avoid:** Run the validator in the micromamba `cosmos` environment with PyYAML installed there via `uv pip`; do not install into or silently choose another environment, and do not describe the startup failure as a manifest validation failure.

## Removing a fixed extractor can also discard proven implementation knowledge

- **Symptom:** Requirement-driven workspace scripts repeatedly rediscover SuperMind call shapes, batching behavior, date handling, and failure boundaries that a previous implementation had already validated.
- **Root cause:** Reusable implementation knowledge was not separated from the fixed fields, market scope, sheets, thresholds, and delivery contract that correctly had to be removed.
- **How to avoid:** Preserve contract-neutral architecture and source-call patterns as read-only references, route the Skill to the relevant reference before implementation, and keep every executable business script and accepted data contract in the user's external workspace.

## Deleting transport with the full extractor leaves workspace scripts unable to run

- **Symptom:** The Skill correctly stores evolving business scripts outside the plugin, but those scripts cannot authenticate to or execute on SuperMind.
- **Root cause:** Immutable generic execution infrastructure was mistaken for the removed fixed extraction program and deleted with it.
- **How to avoid:** Bundle and version only generic SuperMind configuration, authentication, JupyterHub execution, download, redaction, owned-kernel cleanup, and contract-neutral read-only implementation references. Keep every executable dataset implementation, field, date, threshold, workbook, and other mutable business contract in the external workspace.

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
