---
name: cls-fetch
description: Fetch every China Standard Time message published on the 财联社 (CLS) telegraph feed for one Beijing calendar date or one contiguous date range (up to 31 days, today by default), optionally apply a user-provided broad semantic relevance filter (default is the complete unfiltered content), and write a local Markdown collection containing unchanged source text, timestamps, and original links. Use when the user asks to read, collect, filter, or 汇总财联社电报 for a day or period, with or without a topic, industry, company group, technology, or other natural-language condition. Do not use for scheduled or background collection.
---

# CLS Fetch

Collect the complete CLS telegraph feed for the requested Beijing date or date range, let Codex select semantically relevant items when a filter is given (all items otherwise), and render selected items without rewriting source text.

## Required workflow

### 1. Resolve the workspace and request

- Resolve `<plugin-dir>` as the installed plugin directory two levels above this `SKILL.md` (the directory containing `skills/`), and `<skill-dir>` as the directory containing this `SKILL.md`. `<sources-workspace>` is the fixed `~/Documents/cosmos-workspace/sources`; `node <plugin-dir>/scripts/workspace-runtime.mjs show-workspace` prints its absolute path and creates the tree when missing.
- A natural-language filter condition is optional. Without one, collect the complete unfiltered content; do not ask for a filter.
- Interpret “today” and every requested date in `Asia/Shanghai`, regardless of the user's local timezone. Accept one date (default today) or one contiguous range of at most 31 Shanghai calendar days whose end is not in the future; a range whose start equals its end is a single-day request.
- Choose one stable semantic `<scope-key>` and matching `<short-filter-name>` for the requested information requirement. Reuse that key and path when later wording has the same meaning — for example, “AI 相关信息” and “与人工智能有关的信息” are one scope — and choose a new key and file when the required information materially changes. Never use the raw filter sentence as identity; wording alone does not change identity. An unfiltered run always uses the reserved scope key `all` with the fixed wording `全部内容`.
- Default the output to `<sources-workspace>/output/cls/YYYY-MM-DD/<short-filter-name>.md` for a single date and `<sources-workspace>/output/cls/ranges/<start>_to_<end>/<short-filter-name>.md` for a range, unless the user supplies a path in that exact directory. Without a filter, the default filename is `全部内容.md`. Replace path separators in the derived short filter name with `-`.

### 2. Fetch the complete window

Create a dedicated temporary directory with `mktemp -d`, then run:

```bash
node <skill-dir>/scripts/fetch-cls.mjs \
  --output <temp-dir>/source.json
```

- Pass `--date YYYY-MM-DD` only when resolving an explicit date; normal use defaults to the current Shanghai date. For a multi-day range, also pass `--end-date YYYY-MM-DD`; the fetcher walks the whole window in one cursor pass.
- Treat any non-zero exit as a hard failure.
- The rolling telegraph feed retains limited history. A deep historical range can end in a fail-closed short-page or empty-page error; that is an expected source limitation to report, not a defect.
- If the command reports only `fetch failed` because network access is sandboxed, retry with the required network approval before diagnosing CLS.

On an unresolved fetch failure, separate environment failures (network denial, DNS/TLS errors, timeouts, source outages, rate limits) from implementation or CLS contract failures; `references/cls-api.md` documents the endpoint contract. For a reproducible implementation bug or changed CLS behavior, tell the user the confirmed cause and the smallest intended change and ask whether to repair. Only after the user's explicit approval, make the smallest repair and rerun the fetch; if the user declines, change no skill file and report the failure with the exact error and retained temporary path. Never weaken the fetcher's checks, bypass access controls, or introduce credentials.

Do not commit, merge, push, install dependencies, publish, or change unrelated files while repairing unless the user separately authorizes it. The sole exception is `$fix-report` operating on its independently configured repository for the specified report-only commit and push.

### 3. Select items (filtered runs only)

Skip this step without a filter; step 4 renders the complete content with `--all`.

Read the fetched items directly from `<temp-dir>/source.json` and judge each one:

- Judge the full `content` (or `brief`), title, CLS subjects, and associated stocks together.
- Include direct matches and meaningful upstream, downstream, policy, financing, supply-chain, application, or competitive effects. Do not require the filter words to appear; prefer recall over precision, and include an item when uncertain.
- For an AI-related filter, include relevant AI chips, compute infrastructure and data centers, models, robotics, autonomous driving, AI applications, regulation, safety, financing, mergers, talent, and material supply-chain developments.
- Collect the selected numeric message IDs. Do not rewrite, summarize, translate, or “clean up” source text.

### 4. Render unchanged source text

For a filtered run:

```bash
node <skill-dir>/scripts/render-markdown.mjs \
  --source <temp-dir>/source.json \
  --selected "123,456" \
  --filter "<user's filter condition>" \
  --scope-key "<stable-scope-key>" \
  --output <resolved-output-path>
```

Pass `--selected ""` when no item qualifies. For an unfiltered run, pass `--all` instead of `--selected`, `--filter`, and `--scope-key`; the renderer selects every item under the reserved scope key `all` and the fixed wording `全部内容`.

The renderer must be the only component that writes the final Markdown. It copies `content` exactly (or `brief` when `content` is empty) and never asks Codex to reproduce source prose.

- The renderer locks the canonical path and atomically replaces only a generated file whose structured `cls-fetch` marker carries the same date (or exact range) and stable scope key — the collection identity. Materially different scopes coexist as separate files; different or overlapping ranges are separate collections; older snapshots never replace newer ones.
- It refuses an existing unmarked or legacy-marker file unless the user explicitly confirms its ownership and authorizes the one-time `--force` migration. `--force` never permits replacement of a report carrying another scope key.
- A multi-day report groups items under one `## YYYY-MM-DD` section per Shanghai day, newest day first; ordering is newest-first throughout.

### 5. Report

- Report the fetched count, selected count, Shanghai date or date range, and a clickable absolute path to the Markdown file. Do not add a rewritten news summary.
- After a successful run, remove only the exact temporary directory created for this run. Keep it on failure only when needed for diagnosis, and report that path.
- On any unresolved failure, report the failure phase, exact error, and whether an existing output changed.

## Hard rules

- Keep all results local; never publish, upload, email, or message them.
- Never use an external LLM API. The Codex instance executing this skill performs classification.
- Never fall back to visible-page scraping or a third-party feed, silently or otherwise.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available, then read and follow `<fix-report-skill-dir>/references/packaged-change-handoff.md`, which owns the readiness preflight, the automatic report-only handoff, and the exclusions. This gate covers marketplace-distributed files only; a change confined to an external workspace never triggers it. If `$fix-report` is unavailable, or that reference is missing because the installed companion predates it, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently.
