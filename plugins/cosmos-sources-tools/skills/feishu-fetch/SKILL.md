---
name: feishu-fetch
description: Read all messages from exact user-specified Feishu (飞书) group chats/群聊 on today, one requested historical Beijing calendar date, or one contiguous Beijing date range of at most 31 days, optionally select messages matching a user-supplied information requirement (all in-window messages by default), extract unchanged text and substantive image text, and write a content-only Markdown (.md) snapshot. Use when the user invokes $feishu-fetch or asks to read, filter, extract, archive, or 汇总 one or more Feishu groups' 当天/今日、指定历史日期或日期区间消息. Do not use for future dates, sending messages, scheduled runs, non-group conversations, or unattended background monitoring.
---

# Feishu Fetch

Read the requested Feishu groups through the existing desktop session, select relevant messages, and preserve their source wording in a Markdown snapshot. Do not summarize, paraphrase, translate, or analyze the selected content.

## Required inputs

- Require exact group names. A filter requirement is optional; without one, collect every in-window message. Treat the ordered group list as the complete requested scope. Do not add similar groups, bot chats, or private chats.
- Accept one optional Beijing calendar date in strict `YYYY-MM-DD` form, or one contiguous date range as two strict `YYYY-MM-DD` dates (start then end) spanning at most 31 days. Default to today's Beijing date. Reject a future date or future range end; a range whose start equals its end is a single-day request.
- Ask the user when a required input is missing or ambiguous. Do not guess a group from a partial name or infer the requested topic from earlier unrelated context.

## Runtime bindings

Resolve `<plugin-dir>` as the installed plugin directory two levels above this `SKILL.md` (the directory containing `skills/`). Never write personal paths or environment settings back into the skill or report.

- `<sources-workspace>`: the fixed `~/Documents/cosmos-workspace/sources`; `node <plugin-dir>/scripts/workspace-runtime.mjs show-workspace` prints its absolute path and creates the tree when missing.
- `<app-target>`: accept an optional app target supplied by the user. Otherwise discover the accessible signed-in desktop app using the environment's installed labels, including `Feishu` and `飞书`. Do not assume an installation path, bundle/package identifier, localized window title, or screen coordinates.
- Display timezone: fixed to Beijing time (`Asia/Shanghai`, `UTC+08:00`); interpret the app's displayed timestamps as Beijing time. If the app visibly displays a different timezone or UTC offset, stop collection and report it instead of converting or guessing.
- `<node-executable>`: resolve a Node.js executable from the active environment or executable search path; do not embed an absolute executable path.

A repair means editing installed skill files or deviating from this document's procedure. Before repairing, tell the user the confirmed cause and the smallest intended change, and repair only after their explicit approval; never place message content in that summary. If the user declines, change no installed file and mark the affected group incomplete.

## 1. Resolve the Beijing date window

- Run `<node-executable> <plugin-dir>/scripts/chat-date-window.mjs [YYYY-MM-DD [YYYY-MM-DD]]`, passing the optional Beijing date — and the range end date — only when the user supplied them. Treat its JSON as the authoritative window; use its `*Beijing` fields directly for filenames and reader-facing timestamps.
- Collect exactly the window the resolver returns: from `startInclusiveBeijing` through `cutoffInclusiveBeijing` inclusive in `current-day` and `current-range` modes, and through `endExclusiveBeijing` exclusive in `historical-day` and `historical-range` modes.
- Apply the same window and run cutoff to every group and exclude messages outside it. Resolve each message's date from the nearest date separator or displayed timestamp, never from the host calendar.
- Create one private temporary run directory (`mktemp -d`) for the scope file and working notes.

## 2. Read each group

- Follow the available Computer Use skill and operate the existing signed-in Feishu desktop app resolved as `<app-target>`. Keep the session read-only: do not send, react, edit, delete, pin, or mark messages, and do not open composer tools, type into the message entry area, or trigger Feishu bot commands. Do not inspect cookies, local storage, caches, signed transport URLs, credentials, or private endpoints, and do not use an unofficial Feishu API.
- Refresh the app state after every navigation or scroll and re-derive accessibility element indexes. Never reuse stale element indexes.
- Resolve every exact group name through Feishu's global search or conversation list. Confirm the opened header equals the requested group and that the result is a group chat, not a person, bot, document, or app result; if multiple accessible groups share the name or the result is ambiguous, ask the user instead of choosing one.
- Scroll to the conversation bottom, then read the window backward in one pass (a multi-day window is covered by this single backward pass) until a message or date separator strictly before the window's start date appears. In historical modes, read past newer dates to reach the window first.
- Treat every in-group thread or topic as part of the requested group. Open each thread/topic that may contain an in-window root or reply. In `current-day` and `current-range` modes freeze its newest reply at or before the run cutoff; in `historical-day` and `historical-range` modes skip newer replies and freeze its newest in-window reply. Read every in-window reply backward, record each reply as its own message occurrence, retain displayed root/quote context only as part of that occurrence, then return to the main group transcript. If a thread/topic's in-window reply range cannot be read, mark the group incomplete.
- Expand collapsed or truncated in-window messages before judging relevance. Preserve each message's group, displayed sender, Beijing timestamp, text, attachment order, and image count; treat repeated identical messages as separate occurrences.
- Read every in-window image closely enough to determine relevance and extract its substantive content, following [references/image-extraction.md](references/image-extraction.md).
- Do not follow links or documents beyond the visible message/card text unless the user explicitly expands the scope.
- If Feishu cannot load far enough, hides part of the window, or leaves content unreadable or unattributable, mark that group incomplete and say why; never estimate missing content.

## 3. Select relevant source content

- Without a filter requirement, select every in-window message occurrence. With one, apply it semantically, not keyword-only, and prefer recall: include upstream, downstream, policy, financing, product, research, implementation, and risk context when it materially satisfies the requested topic.
- Select whole message occurrences. Preserve the source wording, paragraph breaks, lists, quotations, code, and visible table structure exactly; keep an attached image with its parent message in order and include only its substantive extracted content.
- Exclude unrelated messages, reactions, read receipts, typing indicators, and interface labels. Do not add conclusions, a narrative summary, recommendations, or inferred facts.

## 4. Write and publish the snapshot

- Choose one stable semantic `<scope-key>` and matching human-readable `<short-scope-name>`. Identity is that key plus the ordered exact group list: reuse it when only the natural-language wording changes but the requested information means the same thing, and choose a new key and file when the requirement materially changes. An unfiltered run always uses the reserved scope key `all` with the fixed wording `全部内容` as the `<short-scope-name>`.
- Default to `<sources-workspace>/output/feishu/YYYY-MM-DD/<short-scope-name>.md` for a single date and `<sources-workspace>/output/feishu/ranges/<start>_to_<end>/<short-scope-name>.md` for a range; honor only an explicit filename in that exact target directory. When any requested group is incomplete, use the sibling `<short-scope-name>.incomplete.md` name instead; an incomplete report never replaces the complete target.
- Create the target directory inside `<sources-workspace>` when missing, then write the report body — without any marker — to a temporary draft file in that same directory (for example `.draft-<scope-key>.tmp`), using this structure:

```markdown
# 飞书群聊原文汇总

- 北京日期：YYYY-MM-DD
- 日期范围：按当前模式使用下方确定格式
- 采集截止时间：YYYY-MM-DD HH:mm:ss UTC+08:00
- 群聊：群 A、群 B
- 筛选要求：用户原始要求
- 完整性：complete | incomplete

## 群聊：群 A

### HH:mm · 发送者

消息原文

#### 图片 1

图片中的实质内容
```

- In `current-day` and `current-range` modes render `日期范围：YYYY-MM-DD 00:00:00（含）至 YYYY-MM-DD HH:mm:ss（含）UTC+08:00`, using `startInclusiveBeijing` and `cutoffInclusiveBeijing`.
- In `historical-day` and `historical-range` modes render `日期范围：YYYY-MM-DD 00:00:00（含）至 YYYY-MM-DD 00:00:00（不含）UTC+08:00`, using `startInclusiveBeijing` and `endExclusiveBeijing`.
- Render `采集截止时间` from `runCutoffBeijing` in every mode.
- In single-day modes render the `- 北京日期：YYYY-MM-DD` line exactly as templated; in range modes render `- 北京日期范围：YYYY-MM-DD 至 YYYY-MM-DD` instead, and prefix every message heading with its Beijing date — `### YYYY-MM-DD HH:mm · 发送者` — keeping messages in chronological order within each group; single-day modes keep the templated `### HH:mm · 发送者`.
- Write `未发现符合要求的消息` under a group with no matching messages. For partly unreadable content, retain the reliably recovered fragment with one short localized note such as `[图片部分内容无法可靠辨认]`, and list the affected groups under a final `## 未能完整读取的内容` section. Set `完整性：complete` only when every requested group was fully read; otherwise set `incomplete`.
- Write a scope JSON file in the run directory with exactly `{"key":"<scope-key>","groups":["群 A","群 B"],"filter":"<current original requirement>"}`; an unfiltered run writes `"key":"all"` and `"filter":"全部内容"`. Preserve group order and exact strings.
- Publish with `<node-executable> <plugin-dir>/scripts/chat-publish-report.mjs feishu <draft> <target> --scope-json <scope-json-path> --date <YYYY-MM-DD | start_to_end> --snapshot-at <runCutoff> --completeness <complete|incomplete>`. The publisher appends the hidden identity marker itself — never write one into the draft — and atomically refreshes only a generated report carrying the same collection identity.

## 5. Report

- Report the Beijing target date or date range, window mode, run cutoff, requested group count, selected message count, completeness, and clickable absolute output path.
- If no file could be written, state the exact blocking group or error and whether any existing output changed.
- After a successful publication, remove only the exact private run directory created for this run; never leave collected message content behind.

## Hard rules

- Keep all collected content local. Never send, publish, upload, or forward it.
- Never use a non-Beijing collection boundary.
- Never describe an incomplete report as complete.
- Never edit installed skill files or deviate from this document's procedure without the user's explicit repair approval.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available, then read and follow `<fix-report-skill-dir>/references/packaged-change-handoff.md`, which owns the readiness preflight, the automatic report-only handoff, and the exclusions. This gate covers marketplace-distributed files only; a change confined to an external workspace never triggers it. If `$fix-report` is unavailable, or that reference is missing because the installed companion predates it, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently.
