# CLS fetch repair playbook

Read this reference only after the fetch step fails. Diagnose from observed behavior; do not assume that every failure is an API change.

## Preserve the failure

1. Stop before classification and rendering.
2. Keep the run's exact temporary directory.
3. Record the command, exit status, stderr, HTTP status, and bounded response body when available.
4. When safe and still needed, reproduce the failure once with the same date and a new output filename. Do not repeat an access-control request or overwrite the original evidence.
5. List the competing hypotheses and the observation that supports or rules out each one.
6. Before changing code, copy every file that may change into the retained temporary directory and record its original path and SHA-256 digest. Do not treat pre-existing user edits as part of the repair.

Do not include credentials, cookies, browser-profile data, or unrelated environment values in logs or user reports.

## Classify the cause

Use these categories before deciding whether to edit code:

| Evidence | Likely category | Required action |
| --- | --- | --- |
| Sandbox denial or `fetch failed` without an HTTP response | Network environment | Retry once with the required network approval. If it still fails, inspect DNS/TLS/connection evidence and report the blocker. |
| Persistent timeout, DNS/TLS failure, or connection refusal across approved attempts | Network or source availability | Do not patch the request contract without contrary evidence. Stop and report the exact failing layer. |
| Persistent HTTP 429 or 5xx after the fetcher's built-in retries | Rate limit or CLS outage | Do not weaken retries or completeness checks. Report the status and leave existing output untouched. |
| HTTP 401, 403, 418, CAPTCHA, login, or access-control response | Access restriction | Do not bypass it or introduce cookies, credentials, proxies, or browser-profile data. Stop and report. |
| HTTP 404, application `errno`, missing `data.roll_data`, invalid fields, or a changed response type | Endpoint or response-contract change | Compare the current CLS web-client request and response with `cls-api.md`. Repair only after the change is observed. |
| Empty page before midnight, a non-moving cursor, or changed item ordering | Pagination-contract change or source fault | Inspect several consecutive live pages and boundary timestamps. Preserve fail-closed behavior until the new rule is proven. |
| File parsing, argument, state, or write failure while the live response remains valid | Local implementation or permission failure | Reproduce with a focused test. Patch local code only for an implementation defect; report permission failures. |

Built-in retries already cover transient network errors, HTTP 429, and HTTP 5xx. Avoid repeated unbounded requests.

## Research a changed CLS contract

1. Read `cls-api.md` completely.
2. Inspect `https://www.cls.cn/telegraph` and the current web client's own network requests or shipped JavaScript.
3. Compare the observed endpoint, scalar parameters, signing input and algorithm, response fields, cursor semantics, ordering, and stopping condition with the reference.
4. Prefer direct evidence from the current CLS site. Treat search results and third-party descriptions only as leads.
5. Do not bypass authentication, CAPTCHA, paywalls, anti-bot controls, or other access restrictions.

If the current request cannot be observed reliably, stop with an inconclusive diagnosis rather than guessing a new contract.

## Repair and validate

1. Add a minimal regression test that fails for the observed contract or implementation change. Use the associated development project's tests when available; otherwise create a focused Node built-in test in the retained temporary directory. Use the smallest fixture needed and do not store unrelated source content.
2. Make the smallest code change that satisfies the observed contract.
3. After editing and before validation, record the repaired SHA-256 digest of every changed file so restoration can distinguish the repair from a concurrent edit.
4. Retain Shanghai date boundaries, overlap-and-deduplicate protection, monotonic cursor checks, schema validation, and fail-closed behavior unless direct evidence proves a specific rule changed.
5. Update `cls-api.md` with the newly observed contract and remove obsolete statements.
6. Starting from the active `SKILL.md`, use an ancestor project suite only when it demonstrably belongs to this skill, such as a `package.json` named `cls-fetch-skill-development` whose tests import the active scripts. Never run an unrelated current project's test or lint commands.
7. Run the focused regression test and every associated project test and lint command. If no associated suite is present, also run `node --check` on every changed script.
8. Run the official skill validator when its designated environment and validator are available.
9. Rerun the live fetch into a fresh source file. Confirm the summary reports `complete: true`, and confirm the dataset stops only after crossing the Shanghai start boundary.
10. Resume classification from the fresh, verified dataset. Never render the failed dataset.

Do not commit, install, publish, modify unrelated files, or redesign the skill without separate user authorization.

If a regression test, static check, project suite, validator, or live fetch fails, restore the repair backups before stopping. Restore only files whose current digest still matches the version produced by the repair; never overwrite a concurrent edit. If safe restoration is impossible, report every affected path and state explicitly that the active skill remains modified and unverified.

## Report an unresolved failure

Tell the user:

- which phase failed;
- the exact concise error and HTTP status, if any;
- what was attempted and the result of each attempt;
- which hypotheses were ruled out;
- the established cause, or the most likely cause clearly labeled as uncertain;
- why completeness cannot be guaranteed;
- what user action or external-state change is required;
- whether no output was created or an existing output remained unchanged;
- whether the attempted repair was restored, or which skill files remain modified and unverified;
- the retained temporary directory containing diagnostic evidence.

For a network failure, name the failing layer when known: sandbox approval, DNS, TLS, connection, timeout, HTTP response, or CLS availability. Do not report only `fetch failed`.
