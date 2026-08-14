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
  - `skills/stockdata-fetch/SKILL.md`: Workflow for growing a durable external stockdata workspace for each user, with source priority `SuperMind -> baostock -> AKShare`, contract-specific validation, and explicit provenance. First use binds the workspace, personal token-file path, and micromamba environment in external local metadata.
  - `skills/stockdata-fetch/references/implementation-architecture.md`: Contract-neutral responsibility map from accepted requirement through source adapter, normalization, validation, delivery, and provenance, including failure semantics and a verification matrix.
  - `skills/stockdata-fetch/references/supermind-api-patterns.md`: Read-only, previously validated SuperMind call shapes and implementation patterns for trading dates, universes, daily prices, research-kernel compatibility, transport fallbacks, shared-server ownership, batching, completeness, and source-outcome classification.
  - `skills/stockdata-fetch/scripts/supermind_runtime.py`: Generic versioned SuperMind token/JupyterHub transport for server control, code or workspace-file execution, durable file download, output redaction, and exact owned-kernel cleanup. It contains no dataset or workbook contract.
  - `skills/stockdata-fetch/tests/`: Offline unit tests for binding safety, token separation/redaction, dependency preflight, execution failure, kernel cleanup, and download boundaries.
  - `skills/stockdata-fetch/agents/openai.yaml`: UI metadata and a requirement-driven invocation prompt.
- `tests/`: Marketplace/plugin integration tests covering packaged skill discovery and catalog wiring.
- `README.md`: Installation, available-plugin, runtime, and update guidance.

## Dependency flow

The marketplace manifest discovers each plugin through a relative `./plugins/<name>` path. Each plugin manifest then exposes its bundled `skills/` directory. The plugins do not depend on each other and can be installed separately. DingTalk and Feishu collection resolve each user's writable workspace, localized signed-in app, display timezone, and Node executable at run time through Computer Use and publish only locally verified Markdown. `cosmos-stockdata-tools` contains a generic immutable SuperMind transport plus contract-neutral read-only implementation references, but no fixed extraction program or data schema. Each installation creates or extends business scripts only in that user's durable external `<stockdata-workspace>`. The workspace, personal token-file path, and micromamba environment are atomically bound in the sole supported local external `runtime.json` metadata file and reused across tasks. Reconfiguration requires explicit authorization. The workflow exhausts SuperMind coverage before baostock and uses AKShare last. Marketplace updates do not own the workspace or credentials; cross-user business-capability sharing requires a separate upstream release.
