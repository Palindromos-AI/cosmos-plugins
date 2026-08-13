# Architecture

## Purpose

This repository is the `cosmos-plugins` Codex marketplace. It packages reusable skills into independently installable plugins while keeping marketplace discovery metadata in the repository.

## Structure

- `.agents/plugins/marketplace.json`: Ordered marketplace catalog. Each entry points to one local plugin under `plugins/`.
- `plugins/cosmos-knowledge-tools/`: Knowledge-management and Obsidian workflows packaged together.
- `plugins/cosmos-sources-tools/`: Source-retrieval plugin providing CLS telegraph filtering, authenticated Knowledge Planet archival, and read-only DingTalk and Feishu group-message extraction.
  - `.codex-plugin/plugin.json`: Plugin identity, discovery metadata, and skill path.
  - `skills/cls-fetch/`: Installable skill instructions, agent metadata, Node.js runtime scripts, and repair references.
  - `skills/zsxq-fetch/`: Installable skill instructions, agent metadata, browser collector, shared Beijing-date policy, deterministic Node.js runner, Node test suite, image/PDF extraction resources, output templates, and repair references.
  - `skills/dingding-fetch/`: Portable workspace/app/timezone/runtime bindings, DingTalk Computer Use workflow, agent metadata, image-extraction rules, and content-bound atomic report publisher.
  - `skills/feishu-fetch/`: Portable workspace/app/timezone/runtime bindings, Feishu Computer Use workflow, agent metadata, in-group thread coverage, image-extraction rules, and content-bound atomic report publisher.
- `plugins/cosmos-stockdata-tools/`: Stock-market data operations packaged as a separate plugin.
  - `.codex-plugin/plugin.json`: Plugin identity, discovery metadata, and skill path.
  - `skills/stockdata-fetch/SKILL.md`: Instruction-only workflow for growing a durable external stockdata workspace for each user, with source priority `SuperMind -> baostock -> AKShare`, contract-specific validation, and explicit provenance. The first requirement creates workspace scripts; later requirements extend them cumulatively without writing into the installed plugin.
  - `skills/stockdata-fetch/agents/openai.yaml`: UI metadata and a requirement-driven invocation prompt.
- `tests/`: Marketplace/plugin integration tests covering packaged skill discovery and catalog wiring.
- `README.md`: Installation, available-plugin, runtime, and update guidance.

## Dependency flow

The marketplace manifest discovers each plugin through a relative `./plugins/<name>` path. Each plugin manifest then exposes its bundled `skills/` directory. The plugins do not depend on each other and can be installed separately. DingTalk and Feishu collection resolve each user's writable workspace, localized signed-in app, display timezone, and Node executable at run time through Computer Use and publish only locally verified Markdown. `cosmos-stockdata-tools` contains no extraction runtime or fixed data schema. Each installation treats the plugin cache as replaceable and creates or extends scripts only in that user's durable external `<stockdata-workspace>`, explicitly bound through `STOCKDATA_WORKSPACE` or `~/.config/cosmos-stockdata-tools/workspace` and reused across tasks. Rebinding requires explicit migration authorization. The workflow exhausts SuperMind coverage before baostock and uses AKShare last. Marketplace updates do not own the workspace; cross-user sharing requires a separate upstream release.
