# Task brief

`$sources-orchestrator` composes one brief per task from this template and passes it as the subagent's entire instruction. Fill every `<…>`; keep the wording of every fixed line. The brief carries inputs and the result contract only — the channel skill's own `SKILL.md` carries the procedure, and the brief never restates, narrows, or overrides it, with one deliberate substitution — wherever the skill would ask the user and wait, the subagent returns `blocked` instead, and the orchestrator relays the question — and one resolved input the channel skill leaves open: which Chrome instance a Knowledge Planet task operates.

## Template

~~~text
You are running one source-collection task delegated by $sources-orchestrator.

Task: <task-id>
Skill: $<skill-name> — its instructions are the installed file <plugin-dir>/skills/<skill-name>/SKILL.md; follow that file exactly.
Beijing window: <YYYY-MM-DD | YYYY-MM-DD to YYYY-MM-DD>
Targets: <none (CLS) | planet "<exact planet name>" | groups, in this order: "<群 A>", "<群 B>">
Filter: <none — collect the complete content | the user's original wording, verbatim>
Extraction scope: <none — extract everything | the user's original wording, verbatim>
Output: <default | filename "<name>" inside the skill's default directory>
App target: <not applicable | discover | the user's stated app target, verbatim>
Chrome instance: <not applicable | extensionInstanceId "<id>">

Rules:
- Every input you need is above. Do not ask the user for anything and do not wait for a reply. Runtime approval prompts — network access, file writes, downloads, and other tool or sandbox approvals — are not questions: raise them as the skill's procedure requires and continue. When the skill's procedure needs a decision only the user can make — a group or planet that resolves ambiguously, a sign-in, permission, or connection stop, a repair approval — stop at that point, write nothing further, keep your temporary directory and name it in `notes:`, and return status `blocked` with the exact question in `question:`.
- Follow the skill's procedure, temporary-directory handling, cleanup, and hard rules unchanged. This brief adds no procedure and permits no shortcut; the Chrome-instance selection below is the only step it prescribes.
- When `Chrome instance` names an `extensionInstanceId`: before the first browser step, list the available browsers, select the entry whose `metadata.extensionInstanceId` equals it exactly, get that browser by the `id` from your own list, name your session, and bind every tab of this task from that browser. A `browserId` is local to each agent's runtime and is never shared or reused across agents. Never select a browser by family, URL, or default, and never touch a tab you did not open. Other tasks may be running in the same Chrome at the same time: keep to your own tabs, and apply the skill's download-association checks before touching any downloaded file, because the Downloads folder is shared. If no connected browser carries that id, or Knowledge Planet is not signed in there, return `blocked` with a question that says so.
- Do not collect, read, or mention any other channel, group, planet, window, or filter.
- Do not summarize the collected content anywhere in your reply.

End your final reply with exactly this block, filled in:

task: <task-id>
skill: <skill-name>
status: complete | incomplete | failed | blocked
window: <YYYY-MM-DD | YYYY-MM-DD_to_YYYY-MM-DD>
targets: <the Targets line above, verbatim>
output_path: <absolute path of the written report | none>
counts: <the counts the skill's report step names, on one line | none>
question: <the exact question for the user | none>
notes: <every item the skill's report step requires — skipped topics, unproven pinned topics, incomplete groups, retained temporary path, exact error — verbatim | none>
~~~

## Status meanings

| Status | Meaning | `output_path` | `notes` |
| --- | --- | --- | --- |
| `complete` | The skill published its complete report. | the report | the skill's own report items |
| `incomplete` | The skill published an incomplete report (`.incomplete.md` sibling, or a report whose completeness is `incomplete`). | the incomplete report | the skill's own report items, including what was not read |
| `failed` | The run ended without a report. | `none` | the exact error and any retained temporary path |
| `blocked` | The run needs the user's decision before it can continue; `question` carries it verbatim. | `none` | the retained temporary path |

## Composition rules

- `<plugin-dir>` is the installed plugin directory that contains `skills/`, resolved by the orchestrator; the subagent receives it as an absolute path.
- One brief carries one task. Targets, windows, filters, and extraction scopes from other tasks never appear in it.
- `Beijing window` is written for reading (`to`); the result block's `window` uses the range-directory key (`_to_`) so it matches the report path.
- Filter and extraction-scope wording is the user's original wording, verbatim; the channel skill derives the stable scope key, extract key, and filename from it.
- `Output` is `default` unless the user gave a filename; a filename must sit in the skill's default directory, as every channel skill requires.
- `App target` is `not applicable` for `cls-fetch` and `zsxq-fetch`, `discover` for `dingding-fetch` and `feishu-fetch` unless the user named an app target, in which case it is passed verbatim.
- `Chrome instance` is `not applicable` for `cls-fetch`, `dingding-fetch`, and `feishu-fetch`. For `zsxq-fetch` it is the `extensionInstanceId` the orchestrator resolved, copied verbatim — the same value in every planet brief of the plan, serial or parallel.
