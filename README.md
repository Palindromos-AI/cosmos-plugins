# Cosmos Plugins

Private Codex plugin marketplace for reusable Cosmos workflows.

## Install

You need GitHub access to `Palindromos-AI/cosmos-plugins` and an SSH key authorized for that account before installing this private marketplace.

```bash
codex plugin marketplace add git@github.com:Palindromos-AI/cosmos-plugins.git --ref main
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```

Restart the ChatGPT desktop app and open a new Codex task after installation.

## Available plugins

### Cosmos Knowledge Tools

Packages these Skills:

- `defuddle`
- `json-canvas`
- `llm-wiki`
- `obsidian-bases`
- `obsidian-cli`
- `obsidian-markdown`
- `raw-to-markdown`

The three investment research Skills—`industry-research`, `investment-research`, and `macro-research`—are intentionally excluded.

### Cosmos Sources Tools

Packages these Skills:

- `cls-fetch`: fetches the complete current-day 财联社 telegraph feed using the `Asia/Shanghai` date, applies a broad natural-language relevance filter, and writes selected source text unchanged to local Markdown with timestamps and source links.
- `zsxq-fetch`: uses the user's existing signed-in Chrome session to collect every topic from one named Knowledge Planet for a requested `Asia/Shanghai` (`UTC+08:00`) calendar date, verifies topic bodies plus image, linked-page, and PDF content, and writes a reader-facing content-only Markdown archive.
- `dingding-fetch`: uses the user's existing signed-in DingTalk desktop session to read exact named groups from Beijing midnight through one frozen cutoff, semantically selects requested information, and preserves matching text plus substantive image text in content-only Markdown.
- `feishu-fetch`: uses the user's existing signed-in Feishu desktop session to read exact named groups and in-group threads from Beijing midnight through one frozen cutoff, semantically selects requested information, and preserves matching text plus substantive image text in content-only Markdown.

On first use, `cosmos-sources-tools` asks the user to choose one durable absolute `<cosmos-workspace-root>`, stores its independent binding in `~/.config/cosmos-sources-tools/runtime.json`, and writes all final reports under `<cosmos-workspace-root>/sources/output/`. The plugin never derives this root from the current project.

### Cosmos Stockdata Tools

Packages this Skill:

- `stockdata-fetch`: bundles a generic SuperMind token/JupyterHub runtime plus contract-neutral implementation references and cumulatively extends business scripts in `<cosmos-workspace-root>/stockdata`. It does not predefine a full extraction or universal schema. Each requested dataset starts with SuperMind, then uses baostock for confirmed coverage gaps, and reaches AKShare only when both earlier sources cannot satisfy that portion.

## Runtime requirements

- `llm-wiki` and `raw-to-markdown` use the micromamba `wiki` Python environment.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cosmos-sources-tools` requires Node.js to manage its separate `~/.config/cosmos-sources-tools/runtime.json` binding. The manager derives `<cosmos-workspace-root>/sources`, refuses silent rebinding, and never changes the old workspace during an authorized reconfiguration.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Every requested date and “today” use the Beijing `Asia/Shanghai` boundary rather than the host or browser timezone. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.
- `dingding-fetch` and `feishu-fetch` require Node.js, Codex Computer Use, and an existing signed-in DingTalk or Feishu desktop session. At run time they resolve the configured sources workspace, localized app target, display timezone, and Node executable; no developer-machine paths or app identifiers are packaged. They operate read-only, use one frozen Beijing-time cutoff across all requested groups, and keep collected content local.
- `stockdata-fetch` pins `websocket-client==1.8.0` for its generic SuperMind runtime and bundles read-only, contract-neutral implementation references. On first use, each user chooses `<cosmos-workspace-root>`, a personal SuperMind token-file absolute path, and a micromamba environment together; the runtime derives `<cosmos-workspace-root>/stockdata`. Its separate `~/.config/cosmos-stockdata-tools/runtime.json` stores only schema-1 binding metadata—never token content—and later calls reuse it regardless of the current directory. Python commands use `micromamba run -n <env>` and approved package installation uses `uv pip`. Reconfiguration requires explicit authorization; missing or unsupported configuration schemas are rejected. Executable business scripts, accepted data contracts, credentials, mutable dependencies, and downloaded data remain outside the plugin.

Marketplace, plugin, and Skill upgrades replace capability code only. They never invoke workspace configuration or own, migrate, overwrite, or delete either plugin's external `runtime.json` or user workspace content.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```
