# ZSXQ browser adapter repair playbook

Read this file only after `scripts/zsxq-browser-collector.mjs` returns
`awaiting-user-approval` and the user explicitly replies **“修复”**.

## Approval boundary

Before that reply, the executing agent may only:

- retain the marked run workspace and its collector checkpoint;
- read the sanitized `browser-repair-handoff.json`;
- tell the user that collection paused, no final report was created or replaced,
  and ask whether to repair.

It must not edit selectors or collector code, broaden a selector, run a repair
attempt, commit, merge, or resume collection. Silence, “继续”, and an unrelated
new request are not repair approval.

The diagnostic package intentionally contains only the contract version, phase,
query-free page path, selector counts, application tag counts, and a shallow
tag/class outline. Never add topic text, author names, signed URLs, query strings,
fragments, cookies, storage values, headers, or screenshots to it.

## Evidence-driven repair after approval

1. Preserve the failed diagnostic and reproduce the failure against the same
   page and scope. Do not diagnose from timestamps or assumptions.
2. List competing explanations, including delayed mounting, redirected context,
   authentication/access state, virtualized pagination, runtime-capability
   mismatch, and actual DOM drift. Record the observation that rules each one
   in or out.
3. If the existing DOM contract is still correct, fix only the loading or
   navigation defect. Do not weaken selector checks to hide a readiness problem.
4. If the DOM changed, add a new immutable adapter version. Keep the old version
   for fixtures and rollback; do not silently mutate its meaning or add a broad
   ancestor-text fallback.
5. Add regression fixtures for the failed structure and for the safety boundary:
   dedicated body only, exact author/time association, non-pinned chronology,
   attachment order, image load state, and diagnostic redaction.
6. Run the focused tests, full tests, lint, build, skill validation, and a live
   authenticated smoke test. The smoke test must cross below a past target date
   and must not write a final report.
7. Resume from `browser-collector-checkpoint.json` and the runner's `status`
   checkpoint. Re-freeze an inventory only by starting a new runner workspace;
   never hand-edit a frozen manifest.
8. Report the reproduced cause, evidence, changed adapter version, validation,
   and resumed position. Do not commit or merge unless the user separately
   authorized version-control changes.

If the failure is authentication, browser disconnection, permission, or an
external service outage rather than an implementation defect, do not change the
adapter. Explain the required user or service action and leave the run resumable.
