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

### Cosmos Stockdata Tools

Packages this Skill:

- `stockdata-fetch`: bundles the SuperMind notebook, portable JupyterHub driver, and fail-closed local validator needed to run, download, and verify Beijing-time daily A-share and index datasets. No fallback is currently bundled. After a confirmed SuperMind coverage gap and explicit user approval, extension work prefers baostock's free API and uses akshare only when baostock cannot cover the requirement or the user explicitly requests it.

## Runtime requirements

- `llm-wiki` and `raw-to-markdown` use the micromamba `wiki` Python environment.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Every requested date and “today” use the Beijing `Asia/Shanghai` boundary rather than the host or browser timezone. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.
- `stockdata-fetch` requires Python 3.10+, the pinned packages in its bundled `requirements.txt`, and each user's own SuperMind research account and revocable JupyterHub API token. It reads `SUPERMIND_TOKEN` first; otherwise it uses an explicit `--token-file`, `SUPERMIND_TOKEN_FILE`, or the per-user default `~/.config/supermind/token`. Token files remain outside both the plugin and output directory. It imports required modules and verifies their pinned versions and APIs before cloud mutation, discovers each authenticated account's user ID dynamically, blocks new runs behind explicit recovery when kernel or cloud-notebook cleanup is unresolved, and writes output to a durable caller-selected directory; OS temporary output requires an explicit disposable-test override. No Jason-specific project, environment, account ID, token, or data is bundled. SuperMind's verified websocket flow sends the token as a query parameter, so the remote service or a proxy may record it in access logs; rotate the token after suspected exposure.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```
