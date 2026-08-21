---
name: dingding-fetch
description: Read all messages in exact user-specified DingTalk (钉钉) group chats/群聊 from Beijing midnight through one frozen run cutoff, semantically select messages matching a user-supplied information requirement, extract unchanged text and substantive image text, and write a content-only Markdown (.md) snapshot. Use when the user invokes $dingding-fetch or asks to read, filter, extract, archive, or 汇总 one or more DingTalk groups' 当天/今日消息 through the current time. Do not use for sending messages, scheduled runs, non-group conversations, or unattended background monitoring.
---

# Dingding Fetch

Read the requested DingTalk groups through the existing desktop session, select relevant messages, and preserve their source wording in a Markdown snapshot. Do not summarize, paraphrase, translate, or analyze the selected content.

## Required inputs

- Require exact group names and one filter requirement. Examples of a filter requirement include “汇总 AI 相关内容” and “提取所有与本周项目风险有关的信息”.
- Accept optional overrides for a workspace-contained output path, app target, and display timezone. Otherwise resolve the portable runtime bindings below.
- Ask the user when a required input is missing or ambiguous. Do not guess a group from a partial name or infer the requested topic from earlier unrelated context.
- Treat the ordered group list as the complete requested scope. Do not add similar groups or private chats.

## Runtime bindings

Resolve `<plugin-dir>` as the installed plugin directory two levels above this `SKILL.md` (the directory containing `skills/`). Read `<plugin-dir>/references/workspace-runtime.md` completely, then run `node <plugin-dir>/scripts/workspace-runtime.mjs show-config`. Configure only after the user explicitly confirms a durable root. Resolve these values before freezing the collection window. Never write personal paths or environment settings back into the skill or report.

- `<sources-workspace>`: use only the configured `<cosmos-workspace-root>/sources` returned by the manager. Never infer it from the current directory. An explicit output path must remain inside `<sources-workspace>/output/dingtalk`. Marketplace, plugin, and Skill updates never own or alter the binding or workspace.
- `<app-target>`: accept an optional app target supplied by the user. Otherwise discover the accessible signed-in desktop app using the environment's installed labels, including `DingTalk` and `钉钉`, and verify the opened application identity. Do not assume an installation path, bundle/package identifier, localized window title, screen coordinates, or persistent accessibility indexes.
- Display timezone: fixed to Beijing time. This deployment standardizes every timezone to `Asia/Shanghai` (`UTC+08:00`); interpret the app's displayed timestamps as Beijing time without resolving a host or app timezone. If the app visibly displays a different timezone or a UTC offset other than `+08:00`, stop collection and report it instead of converting or guessing.
- `<node-executable>`: resolve a Node.js executable from the active workspace runtime or executable search path and confirm that it can run the bundled publisher. Do not embed an absolute executable path. If no compatible executable is available, stop before publication and report the missing runtime.

## Automatic repair budget

- Before opening the first group, generate the eight-character lowercase hexadecimal `run-id` used by this run's output filename, create one private temporary repair directory, and set `<repair-state-path>` to its nonexistent `repair-state.json` child. Keep the same run ID, state path, Beijing cutoff, and repair directory for the entire run.
- Read [references/repair-playbook.md](references/repair-playbook.md) completely before the first repair decision.
- A repair means editing installed skill files or deviating from this document's procedure. Re-reading the playbook, refreshing or reopening the app view, re-scrolling, or re-running an identical documented step is not a repair and never consumes the attempt. Classify authentication, permission, app availability, source loading, timestamp ambiguity, unreadable content, and ambiguous scope failures as direct blockers or incomplete content; never spend the repair attempt on them.
- For a reproducible DingTalk UI-contract or local implementation defect, run `<node-executable> <plugin-dir>/scripts/chat-repair-state.mjs begin dingding-fetch <repair-state-path> <run-id> <FAILURE_CODE> <phase>` before editing installed skill files or deviating from this document's procedure. Use a content-free uppercase failure code and lowercase hyphenated phase; never place source content in either field.
- On `automatic-repair-authorized`, show a non-blocking progress update and follow the repair playbook. Do not pause or ask the user for repair approval. After validation, resume from the frozen cutoff and last proven boundary.
- On `repair-limit-reached`, do not inspect further for another repair, edit code again, reset state, or create a replacement state file. Mark the affected group incomplete and continue only far enough to preserve reliable recovered content and publish a verified incomplete report when possible.
- The one repair attempt is shared across all groups and phases. A successful repair does not reset it. A corrupt, missing-after-use, replaced, or conflicting state file is a direct blocker, never permission to recreate the budget.

## 1. Freeze the Beijing window

- Resolve one run cutoff before opening the first group. Express it as an explicit instant and as Beijing local time in `Asia/Shanghai` (`UTC+08:00`).
- Define the collection window as Beijing `00:00:00` on the cutoff's Beijing calendar date through the run cutoff, inclusive.
- Apply the same cutoff to every group even when later groups are inspected several minutes later. Exclude messages proved to be newer than the cutoff.
- Treat DingTalk's displayed timestamps as Beijing time (`Asia/Shanghai`). Resolve each message's date from the nearest date separator or message timestamp; no timezone conversion is needed. If the app visibly uses a non-Beijing timezone, stop and report it.
- Do not use the host calendar date as the collection boundary. If a relative, missing, or conflicting displayed timestamp cannot be resolved to the Beijing window, retain any recoverable source content but mark that group incomplete.
- Respect the UI's actual timestamp precision. When a message observed after run start falls in the same displayed minute as the cutoff and no stable message identity was frozen at or before the cutoff, its side of the cutoff is unknowable. Exclude every cutoff-ambiguous message from the selected source set, exclude any proved-newer content, and mark that group incomplete. Never invent seconds from an `HH:mm` label.
- Before extracting a group, estimate its in-window volume. If the window appears to hold more than 200 messages or more than 50 images, pause and confirm with the user before continuing that group, reporting the estimate; a confirmed run then proceeds without further volume pauses.

## 2. Open each exact group read-only

- Follow the available Computer Use skill and operate the existing signed-in DingTalk desktop app resolved as `<app-target>`. Use accessibility text first and screenshots when sender, timestamp, message grouping, or image association is not exposed clearly.
- Keep the session read-only: do not send, react, edit, delete, pin, or mark messages manually. Do not open composer tools or type into the message box. Opening a group may let DingTalk automatically clear its unread badge; never invoke an explicit mark-read action.
- Resolve every exact group name through DingTalk search or the conversation list. Confirm the opened header equals the requested group. If multiple accessible groups share the exact group name or the result is otherwise ambiguous, ask the user instead of choosing one.
- Do not inspect cookies, local storage, application caches, passwords, or account credentials. Do not use an unofficial DingTalk API.

## 3. Prove the day's message range

For each group, perform these steps sequentially:

1. Move to the conversation bottom and identify the newest visible message at or before the run cutoff. Freeze that message's displayed sender, timestamp, message type, and source content as the upper boundary. Do not let later arrivals expand the run.
2. Read every message occurrence from that upper boundary backward. After each upward scroll, refresh the app state and record only newly exposed occurrences; do not reuse stale element indexes.
3. Continue to scroll upward until a message or date separator is strictly before the Beijing day after timestamp conversion. That crossing proves the lower boundary. Seeing only a “today” label without the prior-day crossing is insufficient.
4. Expand every collapsed or truncated in-window text message. Fully read its source body, visible rich-text/card content, sender, timestamp, attachment order, and image count before classifying its relevance. If only a prefix can be read, the group's relevance inventory is incomplete even when that message is later excluded.
5. Preserve each in-window message's exact group name, displayed sender, resolved Beijing timestamp, text, attachment order, and image count. Treat repeated identical messages as separate occurrences.
6. Inspect every in-window image closely enough to determine semantic relevance, including images attached to messages with no useful surrounding text. Read [references/image-extraction.md](references/image-extraction.md) completely before processing the first image.

Do not claim complete coverage unless the upper boundary, lower boundary, every intervening message occurrence, every full message body used for relevance classification, and every image occurrence are accounted for. If DingTalk cannot load farther, hides an unknown range, exposes an unresolved timestamp, leaves text collapsed, exposes an unsupported message type whose relevance cannot be determined, or prevents an image from being associated with its message, mark the group incomplete instead of estimating. Do not follow an external link beyond its visible DingTalk message/card text unless the user explicitly expands the scope.

## 4. Select relevant source content

- Apply the filter requirement semantically, not keyword-only. Consider the complete message text and the substantive content of every attached image.
- Prefer recall when relevance is plausible. Include upstream, downstream, policy, financing, product, research, implementation, risk, and other context when it materially satisfies the requested topic.
- Select whole message occurrences. Preserve the source wording, paragraph breaks, lists, quotations, code, and visible table structure exactly; do not rewrite a fragment into a cleaner sentence.
- Keep an attached image with its parent message and preserve image order. Include only the image's substantive extracted content according to the image reference.
- Exclude unrelated messages, reactions, read receipts, typing indicators, group notices unrelated to the requested information, and interface labels. Preserve a quoted, forwarded, or replied-to message only when it is displayed as part of the selected source message.
- Do not include greetings or social filler solely because they appear near matched messages. Include neighboring context only when its own source content is necessary to understand the matched information.
- Do not add conclusions, a narrative summary, recommendations, or inferred facts.

## 5. Write the Markdown snapshot

- Use the run's already frozen eight-character hexadecimal `run-id`. Default to `<sources-workspace>/output/dingtalk/YYYY-MM-DD-HHmmss-<run-id>-dingtalk-digest.md`, using the Beijing run cutoff for `YYYY-MM-DD-HHmmss`. Honor only a workspace-contained explicit output path.
- Ensure the selected target directory exists inside `<sources-workspace>` before creating the sibling draft; never create output directories elsewhere.
- When any requested group or selected attachment is incomplete, write the recovered report to the sibling `*.incomplete.md` path. Never replace a complete report with an incomplete report.
- Refuse to overwrite an existing or unmarked file. Ask for a different explicit path if the resolved path already exists.
- Write a content-only report. Keep UI actions, search terms, screenshots, accessibility indexes, local temporary paths, and verification notes out of the report.
- Organize selected occurrences by requested group order, then chronological order within each group. Preserve repeated occurrences.
- Use this reader-facing structure:

```markdown
# 钉钉群聊原文汇总

- 北京日期：YYYY-MM-DD
- 截止时间：YYYY-MM-DD HH:mm:ss UTC+08:00
- 群聊：群 A、群 B
- 筛选要求：用户原始要求
- 完整性：complete | incomplete

## 群聊：群 A

### HH:mm · 发送者

消息原文

#### 图片 1

图片中的实质内容
```

- Write `未发现符合要求的消息` under a group with complete coverage but no matching messages.
- For a selected message whose image or source text is partly unreadable, retain only the reliably recovered source fragment and add one short localized note such as `[图片部分内容无法可靠辨认]`. Add a final `## 未能完整读取的内容` section listing only the affected group, timestamp, and reader-relevant reason. For cutoff-minute ambiguity, exclude the ambiguous message and list the group, displayed minute, and `该分钟内可能存在晚于截止时刻、已排除的消息` in this section.
- Set `完整性：complete` only when every requested group has proven day boundaries and every selected source occurrence is complete. Otherwise set `incomplete` and use the incomplete filename.
- Render first to a unique temporary sibling draft named `.dingtalk-digest-<run-id>.tmp`. Re-read and verify that draft before any final path exists. If verification fails, correct and re-verify the draft or remove that exact draft; never publish an unverified report.
- Immediately after the final verification pass, compute the draft's lowercase SHA-256 digest. Then run `<node-executable> <plugin-dir>/scripts/chat-publish-report.mjs dingtalk <draft> <target> <expected-sha256>` for a content-bound atomic no-clobber publish. The helper refuses changed bytes and publishes a private same-directory copy containing exactly the verified bytes. If a default target collides, keep the same `run-id` and append a numeric suffix (`-2`, `-3`, …) before `.md`; if an explicit target exists, retain the verified draft and ask the user for another path.

## 6. Verify and report

- Before publication, compare every selected occurrence in the temporary sibling draft with the captured source record. Confirm group name, sender, timestamp, text, image order, image content, and chronological order.
- Confirm that no excluded interface text or internal process metadata entered the report and that no selected source wording was summarized or silently omitted.
- Report the Beijing date, run cutoff, requested group count, selected message count, completeness, and clickable absolute output path.
- If no file could be written, state the exact blocking group or boundary, why completeness cannot be established, and whether any existing output changed.
- After a successful final publication and verification, remove only the exact private repair directory created for this run. On unresolved repair or validation failure, retain it only when it contains needed diagnostics or backups and report its path; never retain collected message content there.

## Hard rules

- Keep all collected content local. Never send, publish, upload, or forward it.
- Never use a non-Beijing collection boundary.
- Never silently omit a selected image or unreadable source fragment.
- Never describe an incomplete report as complete.
- Never turn extracted source material into a summary; this skill filters and preserves original content.
- Never perform more than one automatic repair attempt in a run or bypass `repair-limit-reached` by resetting, deleting, renaming, or replacing repair state.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available and run its bundled local readiness preflight, `node "<fix-report-skill-dir>/scripts/publish-report.mjs" preflight --repo "<cosmos-workspace-root>/fix-reports"`; the preflight contacts no network. If the Skill is unavailable, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently. If the preflight fails, stop before modifying packaged content and give the user the exact prerequisite it reports. If this run changes any file distributed with the Cosmos Plugins marketplace, invoke `$fix-report` after validation and before the final response. Pass the already resolved `<cosmos-workspace-root>` when available. Do not invoke `$fix-report` for changes confined to an external workspace, including generated output, retrieved data, runtime configuration, or user-owned business scripts. The report-only commit and push performed by `$fix-report` never authorizes committing or pushing the modified marketplace source repository. After repair validation, `$fix-report` runs automatically, without additional approval or request, for its report-only commit and push.
