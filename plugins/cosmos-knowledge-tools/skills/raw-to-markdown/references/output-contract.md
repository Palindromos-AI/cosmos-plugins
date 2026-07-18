# Output and provenance contract

For `raw/path/report.docx`, write only `raw/path/report.md`.

Begin every generated file with flat, legal YAML frontmatter:

```yaml
---
conversion_schema: "raw-to-markdown/v2"
converted_from: "[[raw/path/report.docx]]"
converted_from_path: "raw/path/report.docx"
converted_from_format: "docx"
converted_from_sha256: "<sha256>"
conversion_body_sha256: "<sha256>"
conversion_engine: "markitdown"
conversion_engine_version: "0.1.6"
conversion_postprocessor: "none or pdf-prose-v1"
converted_at: "<UTC ISO-8601 timestamp>"
conversion_metadata_sha256: "<sha256 of all preceding provenance fields>"
---
```

Follow the frontmatter with an Obsidian source callout, then the converter output:

```markdown
> [!source] 转换来源
> 原始文件：[[raw/path/report.docx]]
> 本页由 `raw-to-markdown` 自动转换；原文件是权威来源。
```

## Invariants

- Store vault-relative POSIX paths without a leading slash.
- Quote every YAML value.
- Hash the original bytes with SHA-256.
- Hash the complete Markdown body after frontmatter with SHA-256.
- Hash all provenance fields except `conversion_metadata_sha256`; reject missing, reordered, unknown, malformed, or edited provenance.
- Convert a temporary byte copy of the source rather than handing the original writable path to the engine.
- Normalize generated line endings to LF and end the file with one newline.
- Record `conversion_postprocessor` as `none` unless pathological PDF table markup triggers the deterministic local `pdf-prose-v1` cleanup.
- Let `pdf-prose-v1` remove repeated page headers, short footer labels with explicit copyright/confidentiality markers, and pure-number labels within the first or last two meaningful page-edge lines when the page has more than four meaningful lines. Preserve URL/citation continuations, standalone body numbers, and ambiguous digits on sparse pages; never summarize, paraphrase, or invent source content.
- Never update, replace, or delete an existing Markdown sidecar.
- Treat any symbolic link at the output path as a collision, including a broken link; never follow it as an output.
- Treat an existing Markdown body whose hash differs from `conversion_body_sha256` as human-edited.
- Treat missing provenance or a different `converted_from_path` as an unrelated-file collision.
- Treat a source hash that differs from `converted_from_sha256` as `stale-conflict`; preserve the old sidecar.
- Do not provide an overwrite flag.
- Acquire an exclusive same-directory lock and re-check the target before and after conversion.
- If lock initialization fails after ownership is known, remove the lock only after checking its device and inode while the descriptor remains open. If ownership cannot be established, close the descriptor and preserve the lock for inspection rather than guessing. Preserve replacements already visible at the identity check. Output safety does not depend on the cooperative lock: the target is rechecked and created atomically without replacement.
- For a new sidecar, use an atomic create-that-must-not-exist operation.
- On post-write verification failure, preserve the target and report the failure; automatic rollback could delete a concurrent human edit.
