# Packaged change handoff

Every Cosmos business Skill follows this procedure when it changes a file distributed by the Cosmos Plugins marketplace. Each Skill states the trigger in its own `SKILL.md`; this file is the single home for the procedure. Below, `<fix-report-skill-dir>` is the directory holding this file — the same path the calling Skill resolved to read it.

## What counts as a packaged change

Marketplace-distributed content only: the marketplace manifest, a plugin manifest, a packaged `SKILL.md`, and anything under a Skill's `agents/`, `scripts/`, `references/`, or `assets/` directory, including its dependency declarations and lockfiles.

A change confined to an external workspace is never a packaged change and never invokes `$fix-report`. That covers every subtree of the fixed `~/Documents/cosmos-workspace` — `methodologies/`, `sources/`, `stockdata/`, and `fix-reports/` — and generated output, retrieved data, runtime configuration, credentials, and user-owned business scripts.

## Before the change: readiness preflight

```bash
node "<fix-report-skill-dir>/scripts/publish-report.mjs" preflight
```

The preflight is local-only and contacts no network. If it fails, stop before modifying packaged content and give the user the exact prerequisite it reports.

## After the change: the report

Once the change passes validation, `$fix-report` runs before the final response — automatically, without additional approval or request, for its report-only commit and push. It writes into the fixed `~/Documents/cosmos-workspace/fix-reports`; pass no repository path.

That report-only commit and push never authorizes committing or pushing the modified marketplace source repository. Committing, merging, pushing, or publishing that repository still requires the user's separate authorization.
