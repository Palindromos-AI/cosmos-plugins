---
name: defuddle
description: Extract clean markdown content from web pages using Defuddle CLI, removing clutter and navigation to save tokens. Use instead of a plain page fetch when the user provides a URL to read or analyze, for online documentation, articles, blog posts, or any standard web page. Do NOT use for URLs ending in .md — those are already markdown, fetch them directly (for example with curl).
---

# Defuddle

Use Defuddle CLI to extract clean readable content from web pages. Prefer it over a plain page fetch for standard web pages — it removes navigation, ads, and clutter, reducing token usage.

Requires Node.js, npm, and outbound network access. If not installed: `npm install -g defuddle`

## Usage

Always use `--md` for markdown output:

```bash
defuddle parse <url> --md
```

Save to file:

```bash
defuddle parse <url> --md -o content.md
```

Extract specific metadata:

```bash
defuddle parse <url> -p title
defuddle parse <url> -p description
defuddle parse <url> -p domain
```

## Output formats

| Flag | Format |
|------|--------|
| `--md` | Markdown (default choice) |
| `--json` | JSON with both HTML and markdown |
| (none) | HTML |
| `-p <name>` | Specific metadata property |

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available. If it is unavailable, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently. If this run changes any file distributed with the Cosmos Plugins marketplace, invoke `$fix-report` after validation and before the final response. Pass the already resolved `<cosmos-workspace-root>` when available. Do not invoke `$fix-report` for changes confined to an external workspace, including generated output, retrieved data, runtime configuration, or user-owned business scripts. The report-only commit and push performed by `$fix-report` never authorizes committing or pushing the modified marketplace source repository. After repair validation, `$fix-report` runs automatically, without additional approval or request, for its report-only commit and push.
