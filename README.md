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

### Cosmos Stockdata Tools

Packages this Skill:

- `stockdata-fetch`: bundles the SuperMind notebook, portable JupyterHub driver, and fail-closed local validator needed to run, download, and verify Beijing-time daily A-share and index datasets. akshare and baostock are intentionally deferred until a confirmed SuperMind coverage gap requires them.

## Runtime requirements

- `llm-wiki` and `raw-to-markdown` use the micromamba `wiki` Python environment.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Every requested date and “today” use the Beijing `Asia/Shanghai` boundary rather than the host or browser timezone. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.
- `dingding-fetch` and `feishu-fetch` require Node.js, Codex Computer Use, and an existing signed-in DingTalk or Feishu desktop session. At run time they resolve the user's writable workspace, localized app target, display timezone, and Node executable or accept explicit overrides; no developer-machine paths or app identifiers are packaged. They operate read-only, use one frozen Beijing-time cutoff across all requested groups, and keep collected content local.
- `stockdata-fetch` requires Python 3.10+, the pinned packages in its bundled `requirements.txt`, a SuperMind research account, and a revocable JupyterHub API token supplied through `SUPERMIND_TOKEN` or an explicit token file outside both the plugin and output directory. It discovers each authenticated account's user ID dynamically and writes output to a caller-selected directory; no Jason-specific project, environment, account ID, token, or data is bundled. SuperMind's verified websocket flow sends the token as a query parameter, so the remote service or a proxy may record it in access logs; rotate the token after suspected exposure.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```
