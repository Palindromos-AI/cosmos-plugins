---
name: cls-fetch
description: Fetch every China Standard Time message published today on the 财联社 (CLS) telegraph feed, apply a user-provided broad semantic relevance filter, and write a local Markdown collection containing unchanged source text, timestamps, and original links. Use when the user asks to read, collect, filter, or汇总当天财联社电报 by a topic, industry, company group, technology, or other natural-language condition.
---

# CLS Fetch

Collect the complete current-day CLS telegraph feed, let Codex select semantically relevant items, and render selected items without rewriting source text.

## Required workflow

### 1. Resolve the workspace and request

- Read `<plugin-dir>/references/workspace-runtime.md` completely, then run `node <plugin-dir>/scripts/workspace-runtime.mjs show-config`. Configure only after the user explicitly confirms a durable root. Use the returned `<sources-workspace>` for this entire run.
- Refuse an explicit output path outside `<sources-workspace>/output/cls`. Marketplace, plugin, and Skill updates never own or alter the binding or workspace.

- Require a natural-language filter condition. Ask if it is missing.
- Interpret “today” in `Asia/Shanghai`, regardless of the user's local timezone.
- Prefer recall over precision: include an item when it is materially related, even without an exact keyword match. When uncertain, include it.
- Default the output to `<sources-workspace>/output/cls/YYYY-MM-DD/<short-filter-name>.md` unless the user supplies a workspace-contained path.
- Replace path separators in the derived short filter name with `-`.
- Do not schedule future runs. Execute only for the current request.

### 2. Create temporary working files

- Create a dedicated temporary directory with `mktemp -d`.
- Keep the fetched JSON and the selected-ID manifest in that directory.
- Locate this skill's directory from the active `SKILL.md`; do not assume an installation path.

### 3. Fetch the complete day

Run:

```bash
node <skill-dir>/scripts/fetch-cls.mjs \
  --output <temp-dir>/source.json
```

- Pass `--date YYYY-MM-DD` only when resolving an explicit date; normal use defaults to the current Shanghai date.
- Treat any non-zero exit as a hard failure. Do not render or describe a partial result as complete.
- Read the command's JSON summary and confirm `complete` is `true`.
- Treat the result as a snapshot ending at the reported `snapshot_at`.
- If the command reports only `fetch failed` because network access is sandboxed, retry with the required network approval before diagnosing CLS.

The fetcher uses no credentials and no external package dependencies. On any fetch failure, continue with step 4.

### 4. Diagnose and repair fetch failures

Run this step only when step 3 fails. Keep the failed run's temporary directory and do not classify or render its data.

- Read `references/cls-api.md` and `references/repair-playbook.md` completely before diagnosing or changing code.
- Preserve the exact error, HTTP status and bounded response body when available. Reproduce the failure when it is safe and the existing evidence is not already conclusive; do not repeat access-control requests merely to reproduce them.
- Separate environment failures from implementation or CLS contract failures. Network denial, DNS/TLS errors, persistent timeouts, source outages, rate limits, access restrictions, and missing write permission are not evidence that the fetcher needs a code change.
- If sandboxed network access is the only reported cause, retry with the required approval. If network access still fails, stop and report the failure to the user.
- For a reproducible implementation bug or changed CLS endpoint, signing rule, response shape, or pagination behavior, inspect the current CLS page and web-client requests, add a regression test, make the smallest repair, and update `references/cls-api.md`.
- Run the focused regression test and all available project test and lint suites after a repair, then rerun step 3 into a fresh source file. Continue only when the live fetch reaches the Shanghai start boundary and reports `complete: true`.
- Never weaken completeness checks, bypass access controls, introduce credentials, or switch to visible-page scraping or a third-party feed to make validation pass.
- If the failure cannot be resolved in the current run, stop and give the user the failure phase, exact error, attempted diagnostics, established or likely cause, effect on completeness, required user or external action, and retained temporary path. Say whether no output was created or an existing output was left unchanged.

Do not commit, install, publish, or change unrelated files while repairing unless the user separately authorizes it. If the active skill source is not writable, report the exact path or permission blocker instead of claiming it was repaired.

### 5. Classify every item

Read candidates in bounded batches:

```bash
node <skill-dir>/scripts/list-candidates.mjs \
  --source <temp-dir>/source.json \
  --offset 0 \
  --limit 20
```

Continue with the returned `next_offset` until it is `null`.

For each candidate:

- Judge the full `original_text`, title, CLS subjects, and associated stocks together.
- Include direct matches and meaningful upstream, downstream, policy, financing, supply-chain, application, or competitive effects.
- Do not require the filter words to appear.
- Exclude only clearly unrelated items.
- Record only the selected numeric message IDs. Do not rewrite, summarize, translate, or “clean up” source text.

For an AI-related filter, include relevant AI chips, compute infrastructure and data centers, models, robotics, autonomous driving, AI applications, regulation, safety, financing, mergers, talent, and material supply-chain developments.

After judging each batch, persist its coverage and selected IDs:

```bash
node <skill-dir>/scripts/record-review.mjs \
  --source <temp-dir>/source.json \
  --state <temp-dir>/review.json \
  --offset <current-offset> \
  --limit 20 \
  --selected "123,456"
```

- Omit `--selected` when no item in the batch qualifies.
- Use the same offset and limit as the candidate command.
- Continue from the returned `next_offset`.
- Confirm the final state reports `complete: true`. The renderer rejects a state that does not cover every source item.
- If the source reports `total: 0`, run `record-review.mjs` once with offset `0`, the current limit, and no `--selected`; it creates a complete empty review state.

### 6. Render unchanged source text

Run:

```bash
node <skill-dir>/scripts/render-markdown.mjs \
  --source <temp-dir>/source.json \
  --selection <temp-dir>/review.json \
  --filter "<user's filter condition>" \
  --output <resolved-output-path>
```

The renderer must be the only component that writes the final Markdown. It copies `content` exactly; when `content` is empty, it copies `brief` exactly. It never asks Codex to reproduce source prose.

- Automatically replace an existing file only when it starts with the `cls-fetch` generated marker.
- Refuse an existing unmarked file unless the user explicitly authorizes `--force`.
- Keep the fixed default path `<sources-workspace>/output/cls/YYYY-MM-DD/<short-filter-name>.md` for same-day refreshes.
- Preserve newest-first ordering.
- Keep the generated statistics, original timestamp, exact title/text, and `https://www.cls.cn/detail/<id>` link.

### 7. Verify and report

- Confirm the render command exits successfully and its selected count equals the ID manifest count.
- Inspect the output structure without editing the source text.
- Report the fetched count, selected count, Shanghai date, and a clickable absolute path to the Markdown file.
- Do not add a rewritten news summary in the response.
- After successful verification, remove only the exact temporary directory created for this run. Keep it on failure only when needed for diagnosis, and report that path.
- On any unresolved failure, report the actionable error details required by step 4 rather than returning only a generic failure message.

## Hard rules

- Keep all results local; never publish, upload, email, or message them.
- Never use an external LLM API. The Codex instance executing this skill performs classification.
- Never silently fall back to visible-page scraping or a third-party feed.
- Never claim completeness after an HTTP, parsing, pagination, or boundary failure.
- Never alter the selected CLS title or body text.
- Never hide an unresolved network, permission, source, or repair failure from the user.

## Marketplace change reporting

If this run changes any file distributed with the Cosmos Plugins marketplace, invoke `$fix-report` after validation and before the final response. Pass the already resolved `<cosmos-workspace-root>` when available. Do not invoke `$fix-report` for changes confined to an external workspace, including generated output, retrieved data, runtime configuration, or user-owned business scripts. The report-only commit and push performed by `$fix-report` never authorizes committing or pushing the modified marketplace source repository. If `$fix-report` is unavailable, stop and ask the user to install `cosmos-fix-tools@cosmos-plugins`; never omit the report silently. After repair validation, `$fix-report` runs automatically, without additional approval or request, for its report-only commit and push.
