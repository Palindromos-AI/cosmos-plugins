---
name: llm-wiki
description: Build, query, lint, and maintain a structured, source-grounded Obsidian LLM Wiki without calling a plugin LLM API. Use when the user asks to ingest one or more vault notes or folders; extract entities, concepts, claims, quotes, aliases, relationships, or contradictions; create or merge wiki source/entity/concept pages; query the wiki with graph-assisted retrieval and citations; save useful conversations back into the wiki; rebuild the wiki index; or audit and repair dead links, orphans, duplicates, schema drift, aliases, tags, and ungrounded quotations.
---

# LLM Wiki

Use the current Codex model for every semantic decision. Use local code only for deterministic vault operations. Never call the Karpathy LLM Wiki plugin, its configured provider, or any API key in `.obsidian/plugins/karpathywiki/data.json`.

## Fixed defaults

- Treat the current working directory as the vault root unless the user names another vault.
- Use `wiki/` as the generated wiki folder and Chinese as the output language unless an existing `wiki/schema/config.md` says otherwise.
- Preserve entity and concept names in the source language. Write summaries, labels, and explanations in the wiki language.
- Treat `wiki/entities/`, `wiki/concepts/`, and `wiki/sources/` as managed content. Never ingest generated wiki pages as source notes.
- Preserve human-authored content and any page with `reviewed: true`.

## Route the request

Read only the references required for the requested operation:

- Ingest notes, folders, or conversations: read [ingestion.md](references/ingestion.md) and [schema.md](references/schema.md) completely.
- Query the wiki: read [query.md](references/query.md) completely.
- Lint, review, repair, deduplicate, or maintain: read [lint.md](references/lint.md) and [schema.md](references/schema.md) completely.
- Initialize or rebuild the index: read [schema.md](references/schema.md) completely.

For a request combining operations, read every applicable reference before changing files.

## Use deterministic tooling

Resolve `<skill-dir>` to the directory containing this `SKILL.md`, using the Skill locator provided by Codex. Use the Python launcher configured by the current project. In this vault, run:

```bash
micromamba run -n wiki python "<skill-dir>/scripts/wiki_ops.py" <command> --vault . --wiki-folder wiki
```

The helper uses only the Python standard library. If a future change requires a package, install it with `micromamba run -n wiki uv pip ...`; do not call `pip`, `conda`, or `micromamba install` directly.

Available commands:

- `init [--write]`: preview or create the managed folders and default schema.
- `discover [--path PATH ...] [--exclude GLOB ...]`: expand files or folders and report each note as new, changed, unchanged, or duplicate without writing.
- `preflight --source PATH [--source PATH ...]`: reject empty, incompatible, generated, or duplicate sources and compute stable source slugs.
- `inventory`: list page paths, types, aliases, summaries, hashes, and links as JSON.
- `retrieve --query TEXT [--keyword TEXT ...] [--top N]`: rank query context through lexical matching plus wikilink-graph PPR.
- `lint`: produce a read-only JSON report of deterministic integrity issues.
- `index [--write]`: preview or write `wiki/index.md`.

Run read-only commands before semantic work. Do not use `init --write` or `index --write` unless the user's request authorizes vault modification.

## Common preflight

1. Resolve every requested source to an exact vault-relative path. For a folder, the whole vault, or “all notes”, run `discover` first and explicitly exclude project-control files that are not user notes. Ask only if two candidates remain genuinely ambiguous.
2. Confirm sources are Markdown files outside `.obsidian/`, `.agents/`, `.git/`, and the managed wiki folder. Treat `discover` counts as the coverage baseline and account for every new, changed, unchanged, duplicate, empty, or failed file.
3. Run `preflight` for the new or changed sources selected from that baseline. Skip rejected files and report each reason. Do not silently force re-ingestion.
4. Run `inventory` once and use the snapshot for naming, alias resolution, merge decisions, and link targets.
5. Read the active schema when present. If missing and the request writes wiki content, create the default schema as part of the operation.
6. Build a concrete write set before editing. Keep source paths, created pages, updated pages, collisions, contradictions, and failures separately.

## Ingest workflow

Follow every phase in order; do not collapse extraction and page writing into one improvisational pass.

1. Read the complete source body and its frontmatter.
2. Extract a structured analysis using the contract in `ingestion.md`. For long notes, process bounded semantic batches while carrying the extracted-name list forward. The first batch alone owns the source title, source summary, key points, related existing pages, and contradictions.
3. Verify every quoted mention character-for-character against the original source. Drop or correct ungrounded quotes before writing.
4. Resolve each item against existing titles and aliases, then perform semantic equivalence checking. Reuse an existing page for translations, abbreviations, spelling variants, or synonymous names. Do not merge merely related items.
5. Create or update the source page first using the stable source slug returned by `preflight`.
6. Create or merge entity and concept pages. Preserve `created`, set `updated` to today, append unique sources and aliases, retain grounded quotations with provenance, and protect reviewed content.
7. Update only genuinely related existing pages. Add bidirectional links without rewriting unrelated sections.
8. Record unresolved contradictions with both claims and source attribution. Never resolve a factual conflict by choosing a side without evidence.
9. Run `lint`, correct issues caused by the current operation, then run `index --write`.
10. Append a concise entry to `wiki/log.md` containing the operation, source, model surface (`Codex`), created/updated pages, failures, collisions, contradictions, and elapsed time.

For multiple sources, reuse one inventory snapshot initially, update the in-memory title/alias registry after each source, and detect duplicates both within the batch and against existing source-page `contentHash` values.

## Query workflow

1. Run `inventory` and derive 5–10 short search keywords when the literal query has weak title/alias matches.
2. Run `retrieve` with the original query and those keywords.
3. Read the returned pages in rank order, normally no more than 10. Follow relevant links only when required to answer the question.
4. Answer from the loaded wiki evidence. Cite claims inline with full vault wikilinks and finish with a References section.
5. If retrieval finds nothing, clearly distinguish “not present in this vault” from general model knowledge. Use general knowledge only if the user asks for it.
6. Save a query conversation into the wiki only when the user explicitly asks, then use the conversation-ingest contract in `ingestion.md`.

## Lint and repair workflow

1. Run `lint` without writes.
2. Add semantic review for near-duplicate pages, contradictions, weak aliases, and structurally valid but low-quality content.
3. Present or implement fixes according to the user's request. Treat page deletion, duplicate merging, and broad rewrites as destructive; require explicit authorization.
4. Re-run `lint` after fixes and rebuild the index when page paths, titles, aliases, or summaries changed.
5. Never fabricate content to fill a stub. Use sources already in the vault or leave a clearly marked unresolved item.

## Editing rules

- Prefer Obsidian CLI for vault reads and writes when Obsidian is open. Fall back to normal workspace file tools when it is unavailable.
- Use atomic, narrowly scoped edits. Re-read an existing page immediately before merging to avoid overwriting concurrent changes.
- Use only full-path links inside generated pages, for example `[[wiki/concepts/attention|Attention]]`.
- Never create HTML links or Markdown external links for internal wiki references.
- Never place generated pages outside the managed wiki folder.
- Never expose hidden reasoning, plugin settings, secrets, or API credentials in pages or reports.

## Completion gate

Do not report success until:

1. Every planned page exists and conforms to `schema.md`.
2. Every quotation is grounded in its cited source.
3. Every internal link resolves or appears in the reported unresolved dead-link list.
4. `lint` has no new high-severity issue caused by the operation.
5. `wiki/index.md` reflects the final page set.
6. The final response lists sources processed, pages created/updated, skipped files, unresolved issues, and validation performed.
7. For folder or all-vault ingestion, a final `discover` run accounts for the complete requested scope and shows no unhandled new or changed note.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available. If it is unavailable, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently. If this run changes any file distributed with the Cosmos Plugins marketplace, invoke `$fix-report` after validation and before the final response. Pass the already resolved `<cosmos-workspace-root>` when available. Do not invoke `$fix-report` for changes confined to an external workspace, including generated output, retrieved data, runtime configuration, or user-owned business scripts. The report-only commit and push performed by `$fix-report` never authorizes committing or pushing the modified marketplace source repository. After repair validation, `$fix-report` runs automatically, without additional approval or request, for its report-only commit and push.
