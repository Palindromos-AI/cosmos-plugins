# Cosmos Plugins

Private Codex plugin marketplace for reusable Cosmos workflows.

## Install

You need GitHub access to `Palindromos-AI/cosmos-plugins` and an SSH key authorized for that account before installing this private marketplace.

```bash
codex plugin marketplace add git@github.com:Palindromos-AI/cosmos-plugins.git --ref main
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
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
- `zsxq-fetch`: uses the user's existing signed-in Chrome session to collect every topic from one named Knowledge Planet for a requested platform date, verifies topic bodies plus image, linked-page, and PDF content, and writes a reader-facing content-only Markdown archive.

## Runtime requirements

- `llm-wiki` and `raw-to-markdown` use the micromamba `wiki` Python environment.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
```
