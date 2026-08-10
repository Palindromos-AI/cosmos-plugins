# Architecture

## Purpose

This repository is the `cosmos-plugins` Codex marketplace. It packages reusable skills into independently installable plugins while keeping marketplace discovery metadata in the repository.

## Structure

- `.agents/plugins/marketplace.json`: Ordered marketplace catalog. Each entry points to one local plugin under `plugins/`.
- `plugins/cosmos-knowledge-tools/`: Knowledge-management and Obsidian workflows packaged together.
- `plugins/cosmos-sources-tools/`: Source-retrieval plugin providing CLS telegraph retrieval and semantic filtering plus authenticated Knowledge Planet daily archival.
  - `.codex-plugin/plugin.json`: Plugin identity, discovery metadata, and skill path.
  - `skills/cls-fetch/`: Installable skill instructions, agent metadata, Node.js runtime scripts, and repair references.
  - `skills/zsxq-fetch/`: Installable skill instructions, agent metadata, browser collector, shared Beijing-date policy, deterministic Node.js runner, Node test suite, image/PDF extraction resources, output templates, and repair references.
- `plugins/cosmos-stockdata-tools/`: Stock-market data operations packaged as a separate plugin.
  - `.codex-plugin/plugin.json`: Plugin identity, discovery metadata, and skill path.
  - `skills/stockdata-fetch/SKILL.md`: SuperMind-only selection, execution, validation, and failure workflow using Beijing-time boundaries.
  - `skills/stockdata-fetch/scripts/extract_daily.ipynb`: Sole trusted full-extraction program, submitted to each user's SuperMind research environment.
  - `skills/stockdata-fetch/scripts/run_extract.py`: Portable JupyterHub driver with token-based account discovery, same-account local process locking, caller-selected output, atomic run-state phases, strict UTC cloud-version ordering, historical-date isolation, owned-kernel cleanup, cloud-notebook restoration, and validate-before-replace downloads.
  - `skills/stockdata-fetch/scripts/validate_workbook.py`: Offline fail-closed validator reproducing the notebook's structural and data-quality contract.
  - `skills/stockdata-fetch/tests/`: Offline unit tests for credentials, date isolation, stale-cloud-result rejection, atomic local replacement, kernel cleanup, source protection, and workbook validation boundaries.
  - `skills/stockdata-fetch/requirements.txt`: Pinned local runtime dependencies; SuperMind-hosted notebook packages remain platform-provided.
- `README.md`: Installation, available-plugin, runtime, and update guidance.

## Dependency flow

The marketplace manifest discovers each plugin through a relative `./plugins/<name>` path. Each plugin manifest then exposes its bundled `skills/` directory. The plugins do not depend on each other and can be installed separately. `cosmos-stockdata-tools` is self-contained: installed skill metadata resolves its own scripts, while user-specific credentials and extracted workbooks always remain outside the plugin.
