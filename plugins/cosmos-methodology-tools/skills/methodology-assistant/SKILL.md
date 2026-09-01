---
name: methodology-assistant
description: Help a user explicitly turn the current conversation into a durable methodology, or revise an existing methodology, through an inventory-first review and confirmation workflow. Use only when the user invokes $methodology-assistant or explicitly asks to manage their methodology library; do not use for ordinary conversation summaries or project documentation.
---

# Methodology Assistant

帮助用户从对话中提炼、撰写、管理和持续改进可复用的方法论。方法论是经过用户确认的规则、决策标准和工作流程，不是对一次任务的流水账。

## Invocation boundary

This Skill is explicit-only. Do not invoke it merely because a conversation contains useful rules or is ending. Work in the user's current language unless they request another language.

## Methodology library

The methodology library is the fixed `~/Documents/cosmos-workspace/methodologies`, a subtree of the Cosmos workspace shared with the other Skills. It is never chosen, configured, or inferred from the current directory; a run creates it when missing. Methodology documents are user-owned external workspace content, and plugin installation or update must never move, rewrite, or delete them.

Resolve `<skill-dir>` from the active installation on every invocation. Use the bundled library tool:

```bash
node "<skill-dir>/scripts/methodology-library.mjs" show-library
node "<skill-dir>/scripts/methodology-library.mjs" list
node "<skill-dir>/scripts/methodology-library.mjs" read --path "<relative.md>"
```

`list` recursively inventories every Markdown file in the library. Managed documents expose their metadata; older Markdown appears as `unmanaged` so it cannot be silently omitted.

## Required workflow

### 1. Inventory before interpretation

On every invocation, run `list` and present all existing methodologies in one compact table containing title, relative path, status, and version. If the library is empty, state that explicitly.

Then ask the user to choose exactly one of:

- update an existing methodology, naming the target; or
- create a new methodology.

Wait for the user's choice before drafting or summarizing the current conversation. Do not guess which existing methodology should absorb the conversation, and do not create a near-duplicate merely because its title differs.

### 2. Establish the target

For an update, use the bundled `read` command to load the complete selected document and its SHA-256 digest before proposing changes. Treat updating as incremental improvement of that document, not a fresh rewrite: preserve all still-valid content, purpose, scope, decisions, and workflow steps. A revision must not replace the whole or entire document merely because a cleaner draft can be written from the current conversation. Remove or reverse earlier guidance only when the user explicitly superseded it, and retain the fact of that change in history. Note any nearby methodology that may overlap or conflict. If the selected file is unmanaged, explain that saving will adopt it into the document contract: preserve its path and substantive content while assigning its first `methodology_id`, `created_at`, version, and change-history entry after confirmation.

For a new methodology, agree on a clear title and scope. If the inventory suggests overlap, show the trade-off between extending the existing document and creating a separate one; the user decides.

### 3. Extract durable content from the current conversation

Separate the evidence into:

- explicit rules or preferences stated by the user;
- accepted workflow steps and decision points demonstrated in the conversation;
- corrections or failure lessons that materially change future behavior; and
- inferences or unresolved questions.

Promote only durable, reusable guidance. Exclude incidental task facts, chronological narration, intermediate attempts that add no lesson, credentials, private source content, and implementation details that are unlikely to constrain future work.

Never turn an inference into a formal rule without user confirmation. Present uncertain interpretations as questions or clearly labeled proposed assumptions. Do not treat the agent's own unaccepted suggestion as a user rule.

### 4. Draft in conversation

Prepare the complete proposed Markdown in the conversation first. For an update, start from the complete existing document and edit that baseline. Show a concise change summary covering added, changed, superseded, and removed guidance, with a clear before and after mapping for every changed or explicitly superseded rule. Unmentioned existing content stays unchanged. Keep the draft internally consistent: when a new rule supersedes an old one, update only the dependent workflow and decision points instead of replacing unrelated sections or appending a contradictory paragraph.

Use this document contract:

```markdown
---
type: methodology
methodology_id: stable-lowercase-hyphen-id
title: Human-readable title
status: active
version: 1.0.0
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
---

# Title

## Purpose
## Scope
## Principles and rules
## Workflow
## Decision points
## Deliverables
## Verification
## Exceptions and open questions
## Change history
```

Keep these English top-level section headings exactly so the library tool can validate the document contract; write their contents in the user's language. Adapt lower-level subsections to the methodology. Rules should be testable or decision-relevant; workflow steps should name inputs, outputs, stop conditions, and user checkpoints where they matter.

Use semantic versions as follows:

- patch: clarification with no behavioral change;
- minor: backward-compatible rule or workflow addition;
- major: removed, reversed, or incompatibly redefined guidance.

Every saved revision adds one dated change-history entry. Do not retain superseded rules as active guidance; preserve their history in the change entry.

### 5. Iterate without touching the formal library

Let the user review and revise the proposal through as many turns as needed. Maintain one latest draft and keep a short list of unresolved questions. Acknowledging one edit, selecting a title, or approving an isolated section is not final confirmation.

Do not write a new file or modify an existing methodology until the user gives unambiguous explicit confirmation to save the complete latest draft. Immediately before requesting that confirmation, show the final draft or a precise final diff and ask whether to save it.

### 6. Save the confirmed revision safely

For a new methodology:

- derive a readable lowercase-hyphen `methodology_id` and filename;
- refuse a path or identifier collision instead of overwriting;
- save it at the library root as `<methodology_id>.md` through `save-new`.

For a managed update:

- preserve `methodology_id`, file path, and `created_at`;
- preserve every still-valid rule, workflow step, decision point, exception, and verification criterion from the loaded revision;
- save a complete revised document assembled from the existing baseline plus the user-confirmed delta, never a current-conversation-only replacement;
- pass the digest returned by `read` to `save-update --expected-sha256`.

For adoption of an unmanaged Markdown file, preserve its path and substantive content but assign the newly confirmed `methodology_id`, `created_at`, version, and change history; then call the same digest-checked `save-update` operation.

Send the exact confirmed Markdown to the save command through standard input, never shell interpolation:

```bash
node "<skill-dir>/scripts/methodology-library.mjs" save-new --path "<methodology_id>.md"
node "<skill-dir>/scripts/methodology-library.mjs" save-update --path "<relative.md>" --expected-sha256 "<digest-from-read>"
```

The helper confines paths to the library, rejects symbolic links and identifier collisions, atomically reserves fully written new documents, serializes identity checks through one library-wide lock and each document's saves through its own lock, checks the expected digest again immediately before atomic replacement, preserves an updated file's POSIX mode, and verifies the saved bytes. If the helper reports a concurrent change or active lock conflict, stop and reconcile it with the user; never retry with a new digest silently. A dead owner lock is recovered automatically. If a corrupt lock has no verifiable owner, show the exact reported lock path and ask the user to confirm that no methodology save process is running before removing that one lock; never delete it automatically.

After saving, run `list` again and show the updated inventory plus the exact relative path and version. Do not commit, push, publish, or sync the methodology library unless the user separately asks.

## Ongoing management

When the user invokes this Skill later, apply the same inventory-first workflow and the same incremental-improvement rule. Prefer revising one authoritative methodology over accumulating overlapping variants. Split a document only when its scopes, users, or decision logic have become independently maintainable; merge documents only with the user's explicit choice. Never delete or archive a methodology, or discard still-valid content, as an implied side effect of an update.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available, then read and follow `<fix-report-skill-dir>/references/packaged-change-handoff.md`, which owns the readiness preflight, the automatic report-only handoff, and the exclusions. This gate covers marketplace-distributed files only; a change confined to an external workspace never triggers it. If `$fix-report` is unavailable, or that reference is missing because the installed companion predates it, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently.
