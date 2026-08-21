# Cosmos Plugins

Private Codex plugin marketplace for reusable Cosmos workflows.

## Install

You need GitHub access to `Palindromos-AI/cosmos-plugins` and an SSH key authorized for that account before installing this private marketplace.

```bash
codex plugin marketplace add git@github.com:Palindromos-AI/cosmos-plugins.git --ref main
codex plugin add cosmos-fix-tools@cosmos-plugins
```

Then install whichever business plugins you need:

```bash
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```

Restart the ChatGPT desktop app and open a new Codex task after installation.

The three business plugins are independently optional and do not depend on one another. Every installed business plugin must, however, include `cosmos-fix-tools` as its mandatory companion because any Skill that repairs marketplace-distributed content must complete the `$fix-report` handoff.

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

### Cosmos Fix Tools

Packages this Skill:

- `fix-report`: records a sanitized report after Codex changes content distributed by this marketplace, then automatically commits and explicitly pushes only that report without an additional user request or approval. Changes confined to external workspaces, runtime configuration, retrieved data, generated output, and user-owned business scripts are excluded.

## Runtime requirements

- Python: every Cosmos Skill that runs Python (`llm-wiki`, `raw-to-markdown`, `stockdata-fetch`) uses one fixed micromamba environment named `cosmos` and installs packages only with `uv pip` inside it. Before first use, install [micromamba](https://mamba.readthedocs.io/) and [uv](https://docs.astral.sh/uv/), then create the environment once: `micromamba create -n cosmos python=3.12`. Skills never use system Python, `pip`, `conda`, or `micromamba install`.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`; install them with `micromamba run -n cosmos uv pip install -r <skill-dir>/requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cosmos-sources-tools` requires Node.js to manage its separate `~/.config/cosmos-sources-tools/runtime.json` binding. The manager derives `<cosmos-workspace-root>/sources`, refuses silent rebinding, and never changes the old workspace during an authorized reconfiguration.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Every requested date and “today” use the Beijing `Asia/Shanghai` boundary rather than the host or browser timezone. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.
- `dingding-fetch` and `feishu-fetch` require Node.js, Codex Computer Use, and an existing signed-in DingTalk or Feishu desktop session. At run time they resolve the configured sources workspace, localized app target, display timezone, and Node executable; no developer-machine paths or app identifiers are packaged. They operate read-only, use one frozen Beijing-time cutoff across all requested groups, and keep collected content local.
- `stockdata-fetch` pins `websocket-client==1.8.0` for its generic SuperMind runtime and bundles read-only, contract-neutral implementation references. On first use, each user chooses `<cosmos-workspace-root>` and a personal SuperMind token-file absolute path; the runtime derives `<cosmos-workspace-root>/stockdata` and records the fixed `cosmos` environment. Its separate `~/.config/cosmos-stockdata-tools/runtime.json` stores only schema-1 binding metadata—never token content—and later calls reuse it regardless of the current directory. Python commands use `micromamba run -n cosmos` and approved package installation uses `micromamba run -n cosmos uv pip`. Reconfiguration requires explicit authorization; missing or unsupported configuration schemas are rejected. Executable business scripts, accepted data contracts, credentials, mutable dependencies, and downloaded data remain outside the plugin.
- `fix-report` requires Node.js and Git, and uses exactly `<cosmos-workspace-root>/fix-reports`. Reports are delivered through a **public GitHub repository that you own** and whose URL you share with the marketplace maintainer, who reads new reports there. Reports never contain private source content, credentials, account identifiers, or absolute local paths, which is why the repository can be public. One-time setup, done once per user:

  1. Create an empty public repository on GitHub, for example `<your-account>/cosmos-fix-reports`, and send its URL to the maintainer.
  2. Initialize the local report repository and connect it. Never initialize `<cosmos-workspace-root>` itself or any other workspace subtree:

     ```bash
     git init "<cosmos-workspace-root>/fix-reports"
     cd "<cosmos-workspace-root>/fix-reports"
     git commit --allow-empty -m "Initialize fix reports"
     git branch -M main
     git remote add origin git@github.com:<your-account>/cosmos-fix-reports.git
     git push -u origin main
     ```

  3. Confirm that `git push` works without prompts (SSH key or a stored credential helper). The Skill pushes automatically and cannot answer interactive prompts.

  After setup, the Skill publishes reports through its bundled deterministic publisher: before any packaged repair it runs a local readiness preflight and stops with the missing prerequisite if setup is incomplete; each report is committed with the fixed identity `Cosmos Fix Report <fix-report@cosmos-plugins.invalid>` before the network is contacted, and a report whose push failed is delivered automatically with the next one. It never initializes or reconfigures a repository and never commits or pushes the modified marketplace source repository.

Marketplace, plugin, and Skill upgrades replace capability code only. They never invoke workspace configuration or own, migrate, overwrite, or delete the sources or stockdata plugin's external `runtime.json` or user workspace content.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-fix-tools@cosmos-plugins
```

Re-add only the business plugins you use:

```bash
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```

## License

Proprietary. See [LICENSE](LICENSE). Use is limited to customers with a written agreement with Palindromos; portions derived from third-party open-source projects remain under their own licenses.
