---
name: sources-orchestrator
description: Manage source collection across channels from one conversation. Gather and confirm what the user wants from any combination of the CLS (财联社) telegraph feed, Knowledge Planets (知识星球), DingTalk (钉钉) groups, and Feishu (飞书) groups — Beijing dates or ranges, exact targets, optional filters and extraction scopes — then delegate every collection to a subagent that runs the matching $cls-fetch, $zsxq-fetch, $dingding-fetch, or $feishu-fetch skill, run compatible tasks in parallel, and return one consolidated result. Use when the user invokes $sources-orchestrator, asks to collect or 汇总 several channels 同时/一起/多渠道, or wants one conversation to manage source collection. Do not use for scheduled or unattended collection; when the user explicitly invokes one channel skill by name, that skill runs directly.
---

# Sources Orchestrator

Talk to the user, build one confirmed plan, run every task through its own subagent, and report the results in one place. The orchestrator never collects content itself and never summarizes what was collected; each channel skill owns its procedure, output format, identity rules, and repair rules unchanged.

## 1. Gather the request

- Resolve `<plugin-dir>` as the installed plugin directory two levels above this `SKILL.md` (the directory containing `skills/`). `<sources-workspace>` is the fixed `~/Documents/cosmos-workspace/sources`; `node <plugin-dir>/scripts/workspace-runtime.mjs show-workspace` prints its absolute path and creates the tree when missing.
- Interpret every date and “today” in `Asia/Shanghai`. Each task covers one Beijing calendar date (default today) or one contiguous range of at most 31 days whose end is not in the future; a range whose start equals its end is a single-day request. Validate each distinct window with `node <plugin-dir>/scripts/chat-date-window.mjs [YYYY-MM-DD [YYYY-MM-DD]]` (no arguments resolves today); a non-zero exit names the problem — settle it with the user before planning. Tasks may carry different windows.
- A task is one invocation of one channel skill. Per channel, the required inputs are exactly what that skill requires:

| Skill | Required target | Optional filter | Optional extraction scope | Other optional input |
| --- | --- | --- | --- | --- |
| `$cls-fetch` | none | natural-language requirement | none | filename |
| `$zsxq-fetch` | one exact planet name (one task per planet) | natural-language requirement | attachment-type exclusions or a version rule | filename |
| `$dingding-fetch` | ordered exact group names | natural-language requirement | skip image content | filename, app target |
| `$feishu-fetch` | ordered exact group names | natural-language requirement | skip image content | filename, app target |

- All groups the user names for one chat app form one task and one report, in the order named; split them into several tasks only when the user asks for separate reports.
- Ask only for a missing or ambiguous required target or window. Never guess a group or planet from a partial name, and never infer a target from earlier unrelated context. Do not ask for a filter, extraction scope, filename, or app target; a task without them collects the complete content to the skill's default path, exactly as the channel skill does. Do not ask the user how to schedule tasks.
- Record filter and extraction wording verbatim; the channel skill, not the orchestrator, derives scope keys and filenames. Two requests with the same skill, targets, window, filter meaning, and extraction scope are one task.

## 2. Confirm the plan

Present the plan as one table and start only after the user's explicit confirmation; treat any edit as a new plan to confirm. Number tasks `T1`, `T2`, … in the order the user named them unless the user reorders. `Output` is `default` unless the user gave a filename or an app target.

```markdown
| Task | Skill | Targets | Beijing window | Filter | Extraction scope | Output | Lane |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | $cls-fetch | — | 2026-09-04 | 全部内容 | — | default | network |
| T2 | $zsxq-fetch | 星球「<exact planet name>」 | 2026-09-01 to 2026-09-04 | AI 相关信息 | 不读取图片 | default | browser |
| T3 | $feishu-fetch | <群 A>、<群 B> | 2026-09-04 | 全部内容 | — | default | desktop 1 |
```

Tell the user, once, that runtime approval prompts — network access, file writes, downloads — may appear from subagent threads while tasks run and are answered like any other approval.

## 3. Lanes and scheduling

Every channel skill belongs to exactly one lane:

| Lane | Skills | Rule |
| --- | --- | --- |
| `network` | `cls-fetch` | Fetches over the network only. Start every network task at once; they run concurrently with each other and with every other lane. |
| `browser` | `zsxq-fetch` | Operates the user's signed-in Chrome session through the browser-control capability. Run one at a time in plan order, concurrently with the other lanes. |
| `desktop` | `dingding-fetch`, `feishu-fetch` | Operates the user's signed-in DingTalk or Feishu desktop session through Computer Use. Run one at a time in plan order, concurrently with the other lanes; start the next when the current one ends. |

- Lanes run concurrently with each other; within the `browser` and `desktop` lanes tasks are serialized because two tasks driving the same Chrome session, or two desktop apps sharing the screen's keyboard focus and clicks, would disturb each other. Only the user's explicit instruction in this conversation changes the lane rules, and the plan table then shows that decision.
- A `blocked` browser or desktop task keeps its lane until the user answers: the answer often means the user signing in or operating that same window, which the next task in that lane would disturb. Other lanes keep running meanwhile.
- If the runtime refuses a spawn because of its concurrent-thread limit, start that task when a running one ends.

## 4. Run each task in a subagent

- Spawn one subagent per task and give it, as its entire instruction, one brief composed from [references/task-brief.md](references/task-brief.md): the skill to run and the absolute path of that skill's `SKILL.md`, every resolved input, the rules, and the result block the subagent must end with. A brief contains only its own task — never another task's targets, filter, window, or content.
- Subagents inherit this conversation's skills, tools, sandbox, and permission mode; the brief adds no procedure and no shortcut. A subagent's runtime approval prompts reach the user directly and are not `blocked` results.
- Wait for every task to end. Whenever a task ends, tell the user its ID, status, and output path in one line, and start the next queued task in that lane if there is one.
- On `blocked`: relay the subagent's question to the user verbatim, without answering on the user's behalf. When the user answers, resume that subagent with the answer. If it cannot be resumed, spawn a new subagent with the corrected brief and report the retained temporary path the blocked subagent named in `notes`, which no replacement subagent may remove. A repair request from a channel skill — the confirmed cause and the smallest intended change — is relayed the same way, and only the user's explicit approval goes back.
- A `failed` task never stops another task and is never re-run automatically; the user may ask to re-run failed tasks, which is a new plan containing only those tasks.
- If subagents cannot be spawned at all, stop and tell the user; run tasks in this conversation, one at a time, only on the user's explicit instruction.

## 5. Verify and report

- For every `complete` or `incomplete` result, confirm the reported `output_path` exists under `<sources-workspace>/output/`; a missing file turns the task into `failed` with the subagent's own report attached.
- Present one results table — task, skill, targets, Beijing window, status, counts as reported, clickable absolute output path — then each task's `notes` verbatim: skipped or unproven pinned topics, incomplete groups, retained temporary paths, exact errors. Report an `incomplete` task as incomplete.
- Do not summarize, merge, or restate the collected content, and do not combine channel reports into one file.

## Hard rules

- Every collection runs in a subagent under a brief from `references/task-brief.md`; the orchestrator never runs a channel skill inline without the user's explicit instruction.
- Never answer a subagent's question or approve a repair on the user's behalf.
- Never describe an `incomplete` or `failed` task as complete.
- Never edit installed skill files or deviate from this document's procedure without the user's explicit repair approval.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available, then read and follow `<fix-report-skill-dir>/references/packaged-change-handoff.md`, which owns the readiness preflight, the automatic report-only handoff, and the exclusions. This gate covers marketplace-distributed files only; a change confined to an external workspace never triggers it. If `$fix-report` is unavailable, or that reference is missing because the installed companion predates it, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently.
