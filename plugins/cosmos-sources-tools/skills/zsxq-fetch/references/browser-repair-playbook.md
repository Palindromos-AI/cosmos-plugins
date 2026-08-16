# ZSXQ browser automatic repair playbook

Read this file immediately after `scripts/zsxq-browser-collector.mjs` returns
`automatic-repair-required`. Retain the marked run workspace and collector
checkpoint, show the returned notification as a non-blocking progress update,
then diagnose, repair, validate, and resume without asking for repair approval.

## Automatic repair boundary

Automatic repair authorizes only the smallest evidence-backed change needed to
restore the browser adapter or collector for the active run. It does not authorize
committing, merging, pushing, publishing, installing dependencies, bypassing
access controls, changing unrelated files, or expanding the collection scope.
Obtain any separately required authorization for those actions.

The diagnostic package intentionally contains only the contract version, phase,
query-free page path, selector counts, application tag counts, and a shallow
tag/class outline. Never add topic text, author names, signed URLs, query strings,
fragments, cookies, storage values, headers, or screenshots to it.

## Evidence-driven repair

1. Preserve the failed diagnostic and reproduce the failure against the same
   page and scope. Do not diagnose from timestamps or assumptions. Before editing,
   preserve every candidate file's original path, SHA-256, and content separately
   from pre-existing user changes.
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
   authenticated smoke test. The smoke test must prove the lower boundary for a
   past target date through an older topic or the exact absolute timeline end,
   and must not write a final report.
7. If any required validation fails, restore only files whose current SHA-256
   still matches the automatic repair's output; never overwrite a concurrent edit.
   Report every file that cannot be restored safely and leave the run resumable.
8. Resume automatically from `browser-collector-checkpoint.json` and the runner's `status`
   checkpoint. Re-freeze an inventory only by starting a new runner workspace;
   never hand-edit a frozen manifest.
9. Report the reproduced cause, evidence, changed adapter version, validation,
   and resumed position. Do not commit or merge unless the user separately
   authorized version-control changes.

If the failure is authentication, browser disconnection, permission, or an
external service outage rather than an implementation defect, do not change the
adapter or keep retrying. Explain the required user or service action and leave
the run resumable.

If the active skill source is not writable, do not claim an automatic repair.
Report the exact path or permission blocker and leave the diagnostic workspace
and checkpoints intact.
