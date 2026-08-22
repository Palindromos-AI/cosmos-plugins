# Maintainers

Internal guide for developing and releasing this marketplace. Customers do not need this file; installation and usage live in `README.md`.

## Session start

Read `ARCHITECTURE.md`, `GOTCHAS.md`, and `DECISION.md` before changing anything, and update them in the same change set when a change affects structure, records a mistake, or settles a decision.

## Development workflow

- Never commit directly to `main`. For each change set, create a worktree on a `feature/*` branch off `main` (for example `git worktree add .claude/worktrees/<name> -b feature/<name> main`), implement and test there, and fast-forward merge back only after review.
- Work test-first for well-defined behavior changes; every behavioral fix carries a regression test.
- Commit messages in English: short, precise, descriptive.

## Test baseline

All suites must pass before any merge or release:

- Marketplace and plugin integration: `node --test tests/*.test.mjs`
- zsxq-fetch: `node --test plugins/cosmos-sources-tools/skills/zsxq-fetch/tests/*.test.mjs`
- Python Skills, in each Skill directory: `micromamba run -n cosmos python -B -m unittest discover -s tests -q` — applies to `llm-wiki` and `raw-to-markdown` under `plugins/cosmos-knowledge-tools/skills/` and `stockdata-fetch` under `plugins/cosmos-stockdata-tools/skills/`.

## Versioning

- Each plugin under `plugins/` is versioned independently in its `.codex-plugin/plugin.json`.
- Bump the patch version for fixes and documentation-level changes and the minor version for a new independently usable capability; every bump gets a matching `CHANGELOG.md` entry.

## Release checklist

1. Every test suite above passes.
2. `CHANGELOG.md`, `ARCHITECTURE.md`, `GOTCHAS.md`, and `DECISION.md` reflect the change set.
3. Grep the tree for developer-specific names (environment names, planet or group names, other agents' tool names, development-project package names): distributed files and repository docs must stay machine-neutral. See the GOTCHAS entry "Maintainer-machine names leak into distributed files and repository docs".
4. The version is bumped for every plugin whose packaged files changed.
5. Before distributing to the customer, cut the accumulated `## [Unreleased]` section into a dated release section (`## [YYYY-MM-DD] — <short name>`) that lists the plugin versions it ships; `[Unreleased]` stays at the top, empty, for the next cycle.
6. Merge to `main` and push to `origin` only with explicit approval.
