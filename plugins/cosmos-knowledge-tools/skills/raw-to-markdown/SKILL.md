---
name: raw-to-markdown
description: Convert user-specified non-Markdown source files under raw/ into auditable Markdown sidecars in the same directory. Use only when the user explicitly asks to convert, export, or save named raw files or folders as Markdown. Do not use for ordinary reading, analysis, Wiki ingestion, summarization, or implicit preprocessing.
---

# Raw to Markdown

Convert local source files into Markdown without changing the originals or invoking any other Skill. Keep conversion separate from Wiki analysis and ingestion.

## Fixed boundaries

- Require an explicit conversion request. Reading or analyzing a file is not conversion authorization.
- Accept only local files whose resolved paths remain under a real `raw/` directory in the current vault. Reject a Vault whose `raw/` entry is itself a symbolic link, even when it points elsewhere inside the Vault.
- Write `<source-stem>.md` beside the source. Never write elsewhere unless the user changes this Skill.
- Never modify, move, rename, or delete the original file.
- Never invoke `llm-wiki` or another artifact Skill. A later ingestion requires a separate explicit request.
- Use the local `MarkItDown` engine with plugins disabled and its `convert_local()` API. Do not fetch URLs or call an external LLM/API.
- For PDFs only, detect prose that MarkItDown misclassified as dense or short sparse tables. Require fragmented rows with many empty columns so multiple genuine long-text tables do not trigger the fallback. When detected, use the pinned local `pdfplumber` prose postprocessor to remove repeated headers, short footer labels carrying explicit copyright/confidentiality markers, unambiguous margin page numbers, hard wraps, and false table markup; record the postprocessor in frontmatter. Preserve citations, URL continuations, and standalone numbers inside the page body; preserve ambiguous digits on sparse pages.
- Read [formats.md](references/formats.md) before converting an unfamiliar format.
- Read [output-contract.md](references/output-contract.md) before changing provenance or collision behavior.

## Runtime

Resolve `<skill-dir>` to the directory containing this `SKILL.md`, using the Skill locator provided by Codex. Every Cosmos plugin runs Python in the micromamba environment `cosmos`:

```bash
micromamba run -n cosmos python "<skill-dir>/scripts/raw_to_markdown.py" <command> --vault . <path>
```

If the dependency check fails, install the pinned local converter into that environment with `uv pip`:

```bash
micromamba run -n cosmos uv pip install -r "<skill-dir>/requirements.txt"
```

Do not substitute system Python, `pip`, `conda`, or `micromamba install`.

## Workflow

1. Resolve the exact user-named files. Do not broaden a file request to its parent folder.
2. Run the read-only plan:

   ```bash
   micromamba run -n cosmos python "<skill-dir>/scripts/raw_to_markdown.py" plan --vault . "raw/path/source.docx"
   ```

   Add `--recursive` only when the user explicitly requests a folder or recursive conversion.
3. Review every planned item. State the source, output, and action before writing. Stop on unsupported files, paths outside `raw/`, or collisions.
4. Run conversion only after the request and plan authorize the exact write set:

   ```bash
   micromamba run -n cosmos python "<skill-dir>/scripts/raw_to_markdown.py" convert --vault . "raw/path/source.docx"
   ```
5. Re-run `plan` on the same inputs. Successful outputs must report `no-op`. If the source changed concurrently, report `stale-conflict` and preserve the newly created sidecar for inspection.
6. Inspect each Markdown file for non-empty content, useful structure, valid frontmatter, and an exact source link. For PDF, presentation, and spreadsheet inputs, compare representative sections against the original. For PDFs, also check that prose was not rendered as dense empty-column tables and that real tabular material was not flattened unnecessarily.
7. Report created, unchanged, stale, skipped, conflicted, and failed files. Do not ingest the outputs into Wiki unless the user separately asks.

Batch conversion performs a complete safety preflight before loading the engine. Runtime conversion remains file-by-file: a later format failure does not delete an earlier verified sidecar, and the command returns a structured failure report.

## Collision protection

- Create a sidecar only when the target does not exist.
- Treat any symbolic link occupying the target path as a collision, including a broken link; never follow it as an output.
- Return `no-op` when source and generated body hashes still match.
- Return `stale-conflict` when the original source changed after conversion. Never refresh the existing sidecar automatically.
- Refuse to overwrite any existing Markdown, including an owned sidecar, a human-edited sidecar, or an unrelated note.
- Do not expose an overwrite flag. Replacing, deleting, renaming, or archiving an old sidecar is a separate file-management decision requiring a separate explicit request.
- Acquire a per-output lock and re-check the target while holding it. If a lock or target changes during conversion, stop instead of overwriting.
- A crash can leave a stale `.<name>.md.raw-to-markdown.lock` file that blocks that output. After confirming no conversion is running, ask the user to delete that exact lock file, then rerun; never delete it silently.
- Ignore only this converter's exact lock and namespaced staging artifacts during an explicitly authorized recursive plan; report them as skipped rather than unsupported.

## Completion gate

Do not report success until:

1. The source hash is unchanged before and after conversion.
2. The output is in the same directory and has the same stem.
3. The Markdown body is non-empty.
4. Provenance records the exact vault-relative original path and SHA-256.
5. A second plan reports `no-op`; otherwise the reported stale or conflict state is preserved without deleting or overwriting the target.
6. Every requested file is accounted for.

## Marketplace change reporting

Before changing any marketplace-distributed file, confirm `$fix-report` is available, then read and follow `<fix-report-skill-dir>/references/packaged-change-handoff.md`, which owns the readiness preflight, the automatic report-only handoff, and the exclusions. This gate covers marketplace-distributed files only; a change confined to an external workspace never triggers it. If `$fix-report` is unavailable, or that reference is missing because the installed companion predates it, stop before modifying packaged content and ask the user to install or upgrade `cosmos-fix-tools@cosmos-plugins`. Then restart the ChatGPT desktop app, open a new Codex task, and repeat the repair from the beginning; never resume reporting in the current task or omit the report silently.
