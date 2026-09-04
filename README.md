# Cosmos Plugins

Private Codex plugin marketplace for reusable Cosmos workflows.

## Supported platforms

- macOS and Linux only. The plugins assume a POSIX environment (`~/.config` configuration paths, POSIX file permissions such as `chmod 600`, and POSIX filesystem semantics). Windows is not supported.
- Node.js 22.13 or later for every Node-based Skill and bundled script.
- Git for `fix-report` publishing.
- micromamba and uv for every Skill that runs Python.

## Install

You need GitHub access to `Palindromos-AI/cosmos-plugins` and an SSH key authorized for that account before installing this private marketplace.

```bash
codex plugin marketplace add git@github.com:Palindromos-AI/cosmos-plugins.git --ref main
codex plugin add cosmos-fix-tools@cosmos-plugins
```

Then install whichever business plugins you need:

```bash
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-methodology-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```

Restart the ChatGPT desktop app and open a new Codex task after installation.

The four business plugins are independently optional and do not depend on one another. Every installed business plugin must, however, include `cosmos-fix-tools` as its mandatory companion because any Skill that repairs marketplace-distributed content must complete the `$fix-report` handoff.

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

Usage note: open the Obsidian vault itself as the Codex task's working directory — `llm-wiki` and `raw-to-markdown` treat the current directory as the vault root. `raw-to-markdown` converts only files under `raw/` (fixed name), and `llm-wiki` manages pages under `wiki/` by default.

### Cosmos Methodology Tools

Packages this Skill:

- `methodology-assistant`: an explicit-only workflow for turning the current conversation into a new methodology or an incremental, confirmed improvement of an existing one. Every invocation first lists all Markdown methodologies, waits for the user to choose update or create, separates explicit rules from inference, preserves all still-valid existing content during updates, drafts in conversation, and writes only after final confirmation.

The plugin writes its library to the fixed `~/Documents/cosmos-workspace/methodologies`; the location is not configurable and asks nothing on first use. Managed documents carry stable identity, semantic version, and change history metadata; every Markdown file, including dot paths and older `unmanaged` documents, remains visible. Bundled digest-checked save operations confine new and updated documents to the library and reject stale concurrent revisions.

### Cosmos Sources Tools

Packages these Skills:

- `cls-fetch`: fetches the complete 财联社 telegraph feed for one `Asia/Shanghai` date (today by default) or one contiguous date range of at most 31 days, applies an optional broad natural-language relevance filter (the complete content by default), and writes selected source text unchanged to local Markdown with timestamps and source links.
- `zsxq-fetch`: uses the user's existing signed-in Chrome session to collect topics from one named Knowledge Planet for a requested `Asia/Shanghai` (`UTC+08:00`) calendar date or contiguous date range merged into one report, optionally filtered by a natural-language requirement (every topic by default), extracts topic bodies plus image, linked-page, PDF, and downloadable HTML and Word content, and writes a reader-facing content-only Markdown archive.
- `dingding-fetch`: uses the user's existing signed-in DingTalk desktop session to read exact named groups for today through one frozen cutoff, for one complete historical Beijing date, or for one contiguous Beijing date range of at most 31 days, optionally selects requested information semantically (all messages by default), and preserves matching text plus substantive image text (unless the user excludes image content) in content-only Markdown.
- `feishu-fetch`: uses the user's existing signed-in Feishu desktop session to read exact named groups and in-group threads for today through one frozen cutoff, for one complete historical Beijing date, or for one contiguous Beijing date range of at most 31 days, optionally selects requested information semantically (all messages by default), and preserves matching text plus substantive image text (unless the user excludes image content) in content-only Markdown.
- `sources-orchestrator`: manages source collection across channels from one conversation — gathers and confirms the targets, Beijing windows, optional filters, and extraction scopes for any combination of the four channels above, delegates every collection to its own subagent running the matching channel skill, runs the network (CLS), browser (Knowledge Planet), and desktop-app (DingTalk, Feishu) lanes concurrently while tasks within the browser and desktop-app lanes run one at a time, and returns one consolidated result with every report path. It never collects or summarizes content itself.

`cosmos-sources-tools` writes every report under the fixed workspace `~/Documents/cosmos-workspace/sources` — `output/<source>/YYYY-MM-DD/` for single dates, `output/<source>/ranges/<start>_to_<end>/` for merged multi-day ranges. The location is not configurable and asks nothing on first use; a run creates the tree when it is missing. CLS and chat reports persist a stable semantic scope key separately from the current request wording (unfiltered runs use the reserved key `all`), while ZSXQ uses the canonical planet URL plus a scope key when filtered; an extraction scope (ZSXQ, DingTalk, Feishu) adds its own stable key to the identity. A later run for the same source-specific collection identity refreshes the same generated file; different identities coexist, and incomplete output never replaces complete output. Reports already archived under a different root are left exactly where they are; moving them is yours to do.

### Cosmos Stockdata Tools

Packages this Skill:

- `stockdata-fetch`: bundles a generic SuperMind token/JupyterHub runtime plus contract-neutral implementation references and cumulatively extends business scripts in `~/Documents/cosmos-workspace/stockdata`. It requires each user's own SuperMind account and personal API token. It does not predefine a full extraction or universal schema. File deliveries use stable dataset keys under `output/YYYY-MM-DD/` for single dates and `output/ranges/<start>_to_<end>/` for ranges; same-identity results refresh after validation while different identities coexist. Each requested dataset starts with SuperMind, then uses baostock for confirmed coverage gaps, and reaches AKShare only when both earlier sources cannot satisfy that portion.

### Cosmos Fix Tools

Packages this Skill:

- `fix-report`: records a sanitized report after Codex changes content distributed by this marketplace, then automatically commits and explicitly pushes only that report without an additional user request or approval. Changes confined to external workspaces, runtime configuration, retrieved data, generated output, and user-owned business scripts are excluded.

## Runtime requirements

- Python: every Cosmos Skill that runs Python (`llm-wiki`, `raw-to-markdown`, `stockdata-fetch`) uses one fixed micromamba environment named `cosmos` and installs packages only with `uv pip` inside it. Before first use, install [micromamba](https://mamba.readthedocs.io/) and [uv](https://docs.astral.sh/uv/), then create the environment once: `micromamba create -n cosmos python=3.12`. Skills never use system Python, `pip`, `conda`, or `micromamba install`.
- `raw-to-markdown` declares its pinned Python packages in its bundled `requirements.txt`; install them with `micromamba run -n cosmos uv pip install -r <skill-dir>/requirements.txt`.
- `defuddle` requires Node.js and npm/npx.
- `methodology-assistant` requires Node.js for its dependency-free inventory, confined read, exclusive-create, and digest-checked atomic-update tool. Methodology documents live under the fixed `~/Documents/cosmos-workspace/methodologies`, outside the replaceable plugin package, so installing or updating the plugin never modifies them.
- Obsidian operations require a compatible Obsidian installation and, where applicable, Obsidian CLI access.
- `cosmos-sources-tools` requires Node.js. Its workspace is the fixed `~/Documents/cosmos-workspace/sources`; `node <plugin-dir>/scripts/workspace-runtime.mjs show-workspace` prints the resolved absolute path and creates the tree when missing.
- `cls-fetch` requires Node.js with built-in `fetch` support and network access to `cls.cn`; it uses no credentials or external npm packages.
- `zsxq-fetch` requires Node.js 22.13 or later, the Codex Chrome-control capability, and a Knowledge Planet session already signed in within Chrome. Every requested date, date range, and “today” use the Beijing `Asia/Shanghai` boundary rather than the host or browser timezone; a multi-day range is collected day by day and merged into one report. Its deterministic runner uses only built-in Node.js APIs; native-pixel image tiling optionally installs the pinned `sharp` dependency from the skill-local lockfile after user approval.
- `dingding-fetch` and `feishu-fetch` require Node.js, Codex Computer Use, and an existing signed-in DingTalk or Feishu desktop session. At run time they resolve the localized app target, Node executable, and one optional non-future Beijing date or contiguous date range; no developer-machine paths or app identifiers are packaged. All timestamps are interpreted and reported in Beijing time (`Asia/Shanghai`) — the deployment standardizes every timezone to Beijing. They operate read-only, share one frozen date window across all requested groups, and use the plugin-level date resolver and publisher scripts.
- `sources-orchestrator` requires Codex subagents (enabled by default) plus whatever each delegated channel skill requires. Subagents inherit the conversation's skills, sandbox, and permission mode; approval prompts raised by a subagent surface in the same conversation.
- `stockdata-fetch` requires each user's own account on the SuperMind quantitative research platform (`supermind.10jqka.com.cn`): sign in to its research (JupyterHub) environment in a browser, generate or copy an API token from its token page, save that single line to a file, and `chmod 600` the file. The skill's `requirements.txt` pins `websocket-client==1.8.0`; the runtime accepts any installed `websocket-client>=1.8,<2`. It bundles read-only, contract-neutral implementation references for SuperMind and for the baostock/AKShare fallback rungs. The workspace is the fixed `~/Documents/cosmos-workspace/stockdata` and the environment is fixed to `cosmos`, so first use collects only the token-file absolute path. Its separate `~/.config/cosmos-stockdata-tools/runtime.json` stores only that path as schema-2 metadata—never token content—and later calls reuse it regardless of the current directory. Python commands use `micromamba run -n cosmos` and approved package installation uses `micromamba run -n cosmos uv pip`. Remote downloads stay inside `~/Documents/cosmos-workspace/stockdata` unless the user explicitly authorizes `--allow-outside-workspace`; the token file's directory and `~/.config/cosmos-*` are never download destinations even then. Reconfiguration requires explicit authorization; missing or unsupported configuration schemas are rejected. Executable business scripts, accepted data contracts, credentials, mutable dependencies, and downloaded data remain outside the plugin.
- `fix-report` requires Node.js and Git, and uses exactly `~/Documents/cosmos-workspace/fix-reports`. Reports are delivered through a **public GitHub repository that you own** and whose URL you share with the marketplace maintainer, who reads new reports there. Reports never contain private source content, credentials, account identifiers, or absolute local paths, which is why the repository can be public. One-time setup, done once per user:

  1. Create an empty public repository on GitHub, for example `<your-account>/cosmos-fix-reports`, and send its URL to the maintainer.
  2. Initialize the local report repository and connect it. Never initialize `~/Documents/cosmos-workspace` itself or any other workspace subtree:

     ```bash
     git init ~/Documents/cosmos-workspace/fix-reports
     cd ~/Documents/cosmos-workspace/fix-reports
     git commit --allow-empty -m "Initialize fix reports"
     git branch -M main
     git remote add origin git@github.com:<your-account>/cosmos-fix-reports.git
     git push -u origin main
     ```

  3. Confirm that `git push` works without prompts (SSH key or a stored credential helper). The Skill pushes automatically and cannot answer interactive prompts.

  After setup, the Skill publishes reports through its bundled deterministic publisher: before any packaged repair it runs a local readiness preflight and stops with the missing prerequisite if setup is incomplete; each report is committed with the fixed identity `Cosmos Fix Report <fix-report@cosmos-plugins.invalid>` before the network is contacted, and a report whose push failed is delivered automatically with the next one. It never initializes or reconfigures a repository and never commits or pushes the modified marketplace source repository.

Marketplace, plugin, and Skill upgrades replace capability code only. They never own, migrate, overwrite, or delete the stockdata plugin's external `runtime.json` token record, or any plugin's user workspace content.

## Update

```bash
codex plugin marketplace upgrade cosmos-plugins
codex plugin add cosmos-fix-tools@cosmos-plugins
```

Re-add only the business plugins you use:

```bash
codex plugin add cosmos-knowledge-tools@cosmos-plugins
codex plugin add cosmos-methodology-tools@cosmos-plugins
codex plugin add cosmos-sources-tools@cosmos-plugins
codex plugin add cosmos-stockdata-tools@cosmos-plugins
```

## License

Proprietary. See [LICENSE](LICENSE). Use is limited to customers with a written agreement with Palindromos; portions derived from third-party open-source projects remain under their own licenses.
