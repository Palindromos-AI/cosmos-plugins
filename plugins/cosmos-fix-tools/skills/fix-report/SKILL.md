---
name: fix-report
description: Automatically record, verify, commit, and push a sanitized modification report whenever Codex changes content distributed by the Cosmos Plugins marketplace, including plugin manifests, marketplace metadata, SKILL.md instructions, scripts, references, assets, tests, or lockfiles. Use immediately after such a packaged-content change and before the parent task reports completion, without waiting for an additional user request or approval. Do not use for any change confined to an external user workspace, generated output, retrieved data, runtime configuration, credentials, or user-owned business scripts.
---

# Fix Report

Create an auditable report for a change to content shipped by the Cosmos Plugins marketplace. Store the report in the dedicated `fix-reports` Git repository, then automatically commit and push only that report without additional user approval.

## Decide whether to run

Run this skill only after a task changes marketplace-distributed content, including:

- `.agents/plugins/marketplace.json`;
- `.codex-plugin/plugin.json` or other packaged plugin metadata;
- packaged `SKILL.md`, `agents/`, `scripts/`, `references/`, `assets/`, tests, fixtures, dependency declarations, or lockfiles;
- shared code or documentation distributed inside a marketplace plugin.

Changes confined to an external workspace must not trigger this skill. Excluded content includes:

- `<cosmos-workspace-root>/sources`, `<cosmos-workspace-root>/stockdata`, and `<cosmos-workspace-root>/fix-reports`;
- retrieved data, generated output, exports, temporary files, logs, or caches;
- runtime configuration, local bindings, credentials, tokens, cookies, or account state;
- user-owned business scripts created outside the installed marketplace package;
- files from unrelated projects.

Writing, committing, or pushing a report inside `fix-reports` never triggers another report.

## Resolve the report repository

1. Reuse the shared Cosmos workspace root already resolved by the parent skill or task.
2. If no root is available, ask the user for it. Do not infer one from unrelated paths.
3. Use exactly `<cosmos-workspace-root>/fix-reports` as the report repository.
4. Require the user to have created that exact directory, initialized only it as a dedicated Git repository, and completed its user-configured remote, branch, upstream, and authentication setup once before automatic reporting begins.
5. Run `git -C "<cosmos-workspace-root>/fix-reports" rev-parse --show-toplevel` and require its canonical result to equal exactly `<cosmos-workspace-root>/fix-reports`.
6. Require an attached current branch and resolve its already configured upstream remote and merge ref. Do not infer or create either value. Validate the remote name against `^[A-Za-z0-9][A-Za-z0-9._-]*$`; validate that the merge ref starts with `refs/heads/` and passes `git check-ref-format`.
7. Run `git -C "<cosmos-workspace-root>/fix-reports" fetch <upstream-remote>`, then run `git -C "<cosmos-workspace-root>/fix-reports" rev-list --left-right --count HEAD...@{upstream}` and require exactly `0 0`. This prevents an earlier local commit or an unseen remote commit from being included in the report push.
8. Run `git -C "<cosmos-workspace-root>/fix-reports" status --porcelain` and require the report repository to be clean before writing.

Pass every Git operand through an argument-array API when one is available. If the execution tool accepts only a shell command string, shell-quote every dynamic path, remote, ref, revision, and commit message as one data argument. Never concatenate resolved Git values into shell syntax or execute them through `eval`.

Never run `git init` at `<cosmos-workspace-root>` or in `sources/`, `stockdata/`, any parent directory, or any neighboring workspace directory. The user may run `git init "<cosmos-workspace-root>/fix-reports"` only during one-time setup. This skill does not initialize or reconfigure a repository, add or change a remote, switch branches, alter credentials, or choose a hosting provider. If setup is missing, stop and give the user the exact prerequisite; after setup exists, do not request further approval.

## Confirm the packaged change

Inspect only the packaged paths changed by the current parent task. Do not diagnose from timestamps or include unrelated working-tree changes. Record paths relative to the marketplace repository or installed plugin root. If a diff cannot be attributed to the current task, omit that diff and record the limitation. If the task did not change marketplace-distributed content, stop without creating a report.

## Write the report

Prepare the complete sanitized Markdown in memory, then send those exact non-empty bytes to the bundled deterministic writer on standard input:

```bash
node "<skill-dir>/scripts/write-report.mjs" \
  --repo "<cosmos-workspace-root>/fix-reports" \
  --plugin "<plugin-name>" \
  --scope "<skill-or-plugin-scope>"
```

Pass the report through the process's standard-input channel, not shell interpolation. The script accepts exactly one `--repo`, `--plugin`, and `--scope` argument, rejects unknown or repeated arguments, accepts lowercase hyphen-separated plugin and scope slugs, rejects traversal and symbolic-link directories, verifies canonical containment, and writes all bytes through the same exclusive no-follow file handle. It uses UTC plus a random eight-hex identifier and never reopens or overwrites the final path.

Use the returned `absolutePath` and `relativePath` as the only report paths. Use `cosmos-plugins` as the plugin name for repository-wide metadata and `plugin` as the scope when the change is not limited to one Skill. Stop on any write failure. Before staging, require the report to remain a regular non-symbolic-link file under the same canonical report repository and require it to be non-empty.

Include:

- plugin name, packaged version, skill or plugin scope, UTC timestamp, and final status;
- why the change was needed, expected behavior, observed behavior, and reproduction steps when applicable;
- changed packaged paths and a concise description of each change;
- before and after commit identifiers when available;
- a concise diff or minimal unified diff only when it contains no private user content;
- validation commands, exit codes, and results;
- known limitations and whether unrelated local modifications existed.

## Protect user data

Never include private source content, messages, documents, screenshots, full DOM captures, retrieved user data, credentials, tokens, cookies, account identifiers, signed URLs, secret queries, or absolute local paths. Replace necessary local details with stable placeholders such as `<cosmos-workspace-root>` and `<marketplace-root>`.

Read the completed report back and verify its path, scope, factual accuracy, and privacy before staging it.

## Commit and push the report

When the report repository is correctly configured, execute this final workflow automatically. Do not ask for confirmation or wait for another user request:

1. Run `git -C "<cosmos-workspace-root>/fix-reports" status --porcelain` and require the new report to be the repository's only change.
2. Record `<base-commit>` from `git -C "<cosmos-workspace-root>/fix-reports" rev-parse HEAD` and `<expected-report-blob>` from `git -C "<cosmos-workspace-root>/fix-reports" hash-object -- <report-relative-path>` after the report's read-back and privacy verification.
3. Stage the exact relative path with `git -C "<cosmos-workspace-root>/fix-reports" add -- <report-relative-path>`.
4. Run `git -C "<cosmos-workspace-root>/fix-reports" diff --cached --name-only` and require exactly that one report path. Require `git -C "<cosmos-workspace-root>/fix-reports" rev-parse :<report-relative-path>` to equal `<expected-report-blob>`.
5. Run `git -C "<cosmos-workspace-root>/fix-reports" commit -m "Add <plugin-name> <scope> fix report"`.
6. Require `git -C "<cosmos-workspace-root>/fix-reports" rev-list --count <base-commit>..HEAD` to equal `1` and `git -C "<cosmos-workspace-root>/fix-reports" rev-parse HEAD^` to equal `<base-commit>`, then record the current commit as `<report-commit>`. This rejects hooks that advance `HEAD` by another commit.
7. Run `git -C "<cosmos-workspace-root>/fix-reports" diff-tree --no-commit-id --name-only -r <report-commit>` and require exactly the report path. Require `git -C "<cosmos-workspace-root>/fix-reports" rev-parse <report-commit>:<report-relative-path>` to equal `<expected-report-blob>`. These checks reject hooks that alter the committed report.
8. Immediately before pushing, require `git -C "<cosmos-workspace-root>/fix-reports" rev-parse HEAD` to equal `<report-commit>` and `git -C "<cosmos-workspace-root>/fix-reports" status --porcelain` to be empty.
9. Run `git -C "<cosmos-workspace-root>/fix-reports" push <upstream-remote> <report-commit>:<upstream-merge-ref>` to push only the verified report commit to the preverified upstream branch. Use `git -C "<cosmos-workspace-root>/fix-reports" ls-remote <upstream-remote> <upstream-merge-ref>` to verify the remote merge ref resolves to `<report-commit>` before reporting success.

Never force-push, amend, change remotes, switch branches, stage unrelated files, or push the modified marketplace source repository.

Surface failures explicitly:

- If writing fails, do not commit.
- If committing fails, preserve the report and return its path plus the exact error.
- If any post-commit parent, path, blob, HEAD, or working-tree verification fails, do not push and return the local commit identifier plus the exact mismatch.
- If pushing fails, preserve the local commit and return its commit identifier plus the exact error. Do not claim remote delivery.

## Return the result

Report the report path, commit identifier, configured upstream, and push result. State that only the report was committed. Keep the final summary free of private user data.
