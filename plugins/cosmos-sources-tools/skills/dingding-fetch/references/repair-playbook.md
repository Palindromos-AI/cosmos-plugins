# DingTalk automatic repair playbook

Read this file before the first repair decision in every `dingding-fetch` run.

## Repair boundary

Use automatic repair only for a reproducible DingTalk UI-contract drift or a
local skill implementation defect. Examples include a documented search,
group-header, pagination, expansion, message-association, or image-viewer
relationship that the current accessible UI disproves after a fresh inspection.

Do not repair missing or ambiguous inputs, sign-in or permission failures, an
unavailable or disconnected app, source outages, messages that do not load, an
unresolved timestamp, unreadable content, or an ambiguous group identity. Handle
those conditions through the Skill's existing direct failure or incomplete-report
rules without consuming the repair attempt.

## One-attempt limit

Allow exactly one automatic repair attempt per run, shared across all requested
groups and phases. Call `<plugin-dir>/scripts/chat-repair-state.mjs begin dingding-fetch ...` before editing or trying
a changed procedure. Continue only when it returns
`automatic-repair-authorized`. If it returns `repair-limit-reached`, stop repair
immediately, retain only reliable recovered content, and finish through the
incomplete-report path when a verified draft can still be produced.

Deleting `repair-state.json` would re-arm the budget; the script cannot prevent that, so treat it as a prohibited action, not a recovery path. Keep `repair-state.json` for the entire run. Do not reset, delete, rename,
replace, or create another state file after a successful repair or a later
failure. A successful repair and resume do not restore the budget. Treat corrupt
or conflicting state as a direct blocker rather than recreating it.

## Evidence-driven repair

1. Notify the user with a non-blocking progress update. Preserve the frozen
   cutoff, run ID, reliable captured occurrences, and last proven group boundary.
2. Record only content-free diagnostics: failure code and phase, verified app
   identity, visible control relationships, bounded element counts, and a shallow
   UI outline. Do not store message text, sender names, images, screenshots,
   credentials, caches, or private transport data in repair evidence.
3. Reproduce once when safe and list competing explanations. Rule out stale
   accessibility indexes, delayed rendering, sign-in/access state, source outage,
   and unsupported content before concluding that the UI contract or local
   implementation is defective.
4. Preserve each candidate file's original path, SHA-256, and content separately
   from pre-existing user edits. Make the smallest evidence-backed repair. Never
   weaken exact-group, time-window, completeness, read-only, or privacy checks.
5. Add a focused regression test, then run focused tests, all associated tests,
   syntax checks, skill validation, and a read-only live smoke test. The smoke
   test must not send, react, mark read manually, or write a final report.
6. If validation fails, restore only files whose current SHA-256 still matches
   the repair output; never overwrite concurrent edits. Report any file that
   cannot be restored safely.
7. Resume from the frozen cutoff and last proven boundary. Refresh the app state
   and accessibility indexes before continuing; never restart with a later cutoff.

Automatic repair does not authorize commits, merges, pushes, publishing,
dependency installation, access-control bypass, scope expansion, or unrelated
changes. If the active skill source is not writable, report the exact blocker and
continue only through the incomplete-report rules.
