---
name: fix-report
description: Automatically record, verify, commit, and push a sanitized modification report whenever Codex changes content distributed by the Cosmos Plugins marketplace, including plugin manifests, marketplace metadata, SKILL.md instructions, scripts, references, assets, tests, or lockfiles. Use immediately after such a packaged-content change and before the parent task reports completion, without waiting for an additional user request or approval. Do not use for any change confined to an external user workspace, generated output, retrieved data, runtime configuration, credentials, or user-owned business scripts.
---

# Fix Report

Create an auditable report for a change to content shipped by the Cosmos Plugins marketplace. Store the report in the dedicated `fix-reports` Git repository, then commit and push only that report — without additional user approval — through the bundled deterministic publisher.

## Decide whether to run

Run this skill only after a task changes marketplace-distributed content, including:

- `.agents/plugins/marketplace.json`;
- `.codex-plugin/plugin.json` or other packaged plugin metadata;
- packaged `SKILL.md`, `agents/`, `scripts/`, `references/`, `assets/`, tests, fixtures, dependency declarations, or lockfiles;
- shared code or documentation distributed inside a marketplace plugin.

Changes confined to an external workspace must not trigger this skill. Excluded content includes:

- `<cosmos-workspace-root>/methodologies`, `<cosmos-workspace-root>/sources`, `<cosmos-workspace-root>/stockdata`, and `<cosmos-workspace-root>/fix-reports`;
- retrieved data, generated output, exports, temporary files, logs, or caches;
- runtime configuration, local bindings, credentials, tokens, cookies, or account state;
- user-owned business scripts created outside the installed marketplace package;
- files from unrelated projects.

Writing, committing, or pushing a report inside `fix-reports` never triggers another report.

## Resolve the report repository

1. The report repository is the fixed `~/Documents/cosmos-workspace/fix-reports`; `node "<skill-dir>/scripts/fix-report-runtime.mjs" show-repository` prints its absolute path. It is never chosen, configured, or inferred from the current directory, and the bundled writer and publisher default to it — pass no repository path.
2. The remote is a public repository owned by the user; the user has shared its URL with the marketplace maintainer, who reads reports there, so every report must satisfy the privacy rules below.
3. Require the user to have completed the one-time setup from the marketplace README: create an empty public GitHub repository and share its URL with the maintainer, run `git init ~/Documents/cosmos-workspace/fix-reports`, create an initial commit, rename the branch to `main`, add that repository as `origin`, and `git push -u origin main` with working non-interactive authentication. This skill validates the user-configured upstream remote and merge ref but never initializes or reconfigures a repository, adds or changes a remote, switches branches, alters credentials, or chooses a hosting provider.

Never run `git init` at `~/Documents/cosmos-workspace` or in `methodologies/`, `sources/`, `stockdata/`, any parent directory, or any neighboring workspace directory. The user may run `git init ~/Documents/cosmos-workspace/fix-reports` only during one-time setup.

## Preflight before packaged changes

Before modifying any marketplace-distributed file, the parent task runs:

```bash
node "<skill-dir>/scripts/publish-report.mjs" preflight
```

The preflight is local-only and contacts no network. It verifies that the directory is the dedicated Git repository at its own top level and not a symbolic link, that `HEAD` is an attached branch with at least one commit, that the branch's configured upstream remote and merge ref validate against strict patterns, and that the working tree is clean. On failure, stop before modifying packaged content and give the user the exact prerequisite from the script's error message. A `pendingCommits` count greater than zero is not a failure: earlier reports whose push failed are delivered together with the next publish.

## Confirm the packaged change

Inspect only the packaged paths changed by the current parent task. Do not diagnose from timestamps or include unrelated working-tree changes. Record paths relative to the marketplace repository or installed plugin root. If a diff cannot be attributed to the current task, omit that diff and record the limitation. If the task did not change marketplace-distributed content, stop without creating a report.

## Write the report

Follow `references/report-template.md`. Prepare the complete sanitized Markdown in memory, then send those exact non-empty bytes to the bundled deterministic writer on standard input:

```bash
node "<skill-dir>/scripts/write-report.mjs" \
  --plugin "<plugin-name>" \
  --scope "<skill-or-plugin-scope>" \
  --forbid "<business-identifier>"
```

Pass the report through the process's standard-input channel, not shell interpolation. Repeat `--forbid` once for each business identifier the parent task handled, such as a group name, planet name, or account name. The script accepts exactly one `--plugin` and `--scope` argument, rejects unknown or repeated arguments, accepts lowercase hyphen-separated plugin and scope slugs, rejects traversal and symbolic-link directories, verifies canonical containment, and writes all bytes through the same exclusive no-follow file handle. It mechanically rejects content containing the actual workspace-root path, the home directory, or any `--forbid` identifier. It uses UTC plus a random eight-hex identifier and never reopens or overwrites the final path.

Use the returned `absolutePath` and `relativePath` as the only report paths. Use `cosmos-plugins` as the plugin name for repository-wide metadata and `plugin` as the scope when the change is not limited to one Skill. Stop on any write failure.

Include:

- plugin name, packaged version, skill or plugin scope, UTC timestamp, and final status;
- why the change was needed, expected behavior, observed behavior, and reproduction steps when applicable;
- changed packaged paths and a concise description of each change;
- a concise diff or minimal unified diff only when it contains no private user content;
- validation commands, exit codes, and results;
- known limitations and whether unrelated local modifications existed.

## Protect user data

Never include private source content, messages, documents, screenshots, full DOM captures, retrieved user data, credentials, tokens, cookies, account identifiers, signed URLs, secret queries, or absolute local paths. Replace necessary local details with stable placeholders such as `<cosmos-workspace-root>` and `<marketplace-root>`. The writer's mechanical checks are a floor, not the full privacy rule.

Read the completed report back and verify its path, scope, factual accuracy, and privacy before publishing it. If the read-back or privacy verification fails, delete the rejected report file and never reuse its path; the publisher refuses to run while stray files remain in the report repository.

## Publish the report

When the report repository is correctly configured, execute this automatically. Do not ask for confirmation or wait for another user request:

```bash
node "<skill-dir>/scripts/publish-report.mjs" publish \
  --report "<report-relative-path>"
```

The publisher passes every dynamic Git value — path, remote, ref, revision, message — as one argument-array operand and never through shell syntax. It validates the configured upstream remote name and merge ref against strict patterns, requires the report to be the repository's only change, stages exactly that path, commits with the fixed identity `Cosmos Fix Report <fix-report@cosmos-plugins.invalid>`, and verifies the commit's parent, tree, and report blob before and after the commit, rejecting hooks that advance `HEAD` or alter the committed report. Only then does it contact the network: it fetches the upstream, verifies that every unpushed commit touches only report paths, pushes them to the configured merge ref, and confirms the remote merge ref now equals the local head.

Interpret the publisher's JSON result:

- `pushed`: the report was delivered; include the report path and commit identifier in the final response.
- `committed-not-pushed`: the report and its commit are preserved locally, and delivery resumes with the next publish (or the `push` command) once the condition in `reason` is resolved — a network failure resolves itself; a foreign or merge commit in the backlog needs the user's manual cleanup. Report the commit identifier and the exact reason; do not claim remote delivery.
- `remote-ahead`: the remote has commits this machine has not seen. Nothing is pushed; give the user the reported `git pull --ff-only` instruction and rerun afterwards.
- any pre-commit validation failure: nothing was committed; the report file is preserved; report the exact error.

Never force-push, amend, change remotes, switch branches, stage unrelated files, or push the modified marketplace source repository.

## Return the result

Report the report path, commit identifier, configured upstream, and push status. State that only the report was committed. Keep the final summary free of private user data.
