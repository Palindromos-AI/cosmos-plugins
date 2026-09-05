# Wiki schema and invariants

## Contents

1. Managed layout
2. Naming and link rules
3. Frontmatter contracts
4. Body templates
5. Log format
6. Mentions and provenance
7. Merge invariants
8. Default schema file

## Managed layout

Use this vault-relative layout:

```text
wiki/
├── entities/
├── concepts/
├── sources/
├── analyses/
├── schema/config.md
├── contradictions/
├── index.md
└── log.md
```

Treat `entities`, `concepts`, `sources`, and `analyses` as content nodes in retrieval and most lint graph operations. Treat schema, contradictions, index, log, and welcome notes as support files.

Raw source notes live outside the wiki folder and are never modified by any wiki operation. Analysis pages are the one content type that is not derived from a raw note: they are answers, comparisons, overviews, syntheses, or timelines filed back from queries, and they cite wiki pages rather than raw notes.

## Naming and link rules

- Preserve the source-language canonical name as the entity/concept H1. Never translate a canonical name merely to match the wiki language.
- Produce filenames by trimming, removing control characters and `/\\:*?"<>|,()'!?、，。；：！？（）【】《》`, converting whitespace and periods to `-`, collapsing repeated `-`, trimming edge `-`, and lowercasing by default.
- Use `untitled` only when no usable characters remain, and flag the result for human review.
- Resolve a source page slug as `<source-basename-slug>_<fingerprint>`, capped at 80 characters. The fingerprint is the first six hexadecimal characters of unsigned FNV-1a over the complete vault-relative source path.
- Resolve an analysis page slug from a short semantic title of the question it answers, using the filename rules above. Before creating one, check `analyses/` for an existing page on the same question and update that page instead.
- Use full vault paths in internal links: `[[wiki/entities/page-slug|Display Name]]`.
- Never put a folder prefix in the display part after `|`.
- Add only links that are semantically meaningful. A generated dead link is an explicit unresolved stub candidate, not permission to invent content.

## Frontmatter contracts

Use ISO `YYYY-MM-DD` dates. Preserve unknown user-authored fields.

### Entity

```yaml
---
type: entity
created: 2026-07-15
updated: 2026-07-15
sources:
  - "[[wiki/sources/source-slug|Source title]]"
tags:
  - product
aliases:
  - Common alternative name
reviewed: false
generation_complete: true
---
```

Allowed entity tags: `person`, `organization`, `project`, `product`, `event`, `place`, `other`.

### Concept

```yaml
---
type: concept
created: 2026-07-15
updated: 2026-07-15
sources:
  - "[[wiki/sources/source-slug|Source title]]"
tags:
  - method
aliases:
  - Common alternative name
reviewed: false
generation_complete: true
---
```

Allowed concept tags: `theory`, `method`, `field`, `phenomenon`, `standard`, `term`, `other`.

### Source

```yaml
---
type: source
created: 2026-07-15
updated: 2026-07-15
source_file: "[[folder/original-note]]"
contentHash: 1a2-89abcdef
tags:
  - notes
aliases:
  - Alternative source title
generation_complete: true
---
```

Allowed source tags: `paper`, `article`, `book`, `transcript`, `clippings`, `notes`, `other`. Prefer a compatible tag inherited from the source note. Do not use extracted concept names as source tags.

Compute `contentHash` from the original note body after removing frontmatter: trim it, collapse every whitespace run to one ASCII space, then return `<normalized-length-in-hex>-<8-digit-unsigned-FNV1a-hex>`.

### Analysis

```yaml
---
type: analysis
question: Which attention variants does the wiki compare, and how do they differ?
created: 2026-07-15
updated: 2026-07-15
sources:
  - "[[wiki/concepts/attention|Attention]]"
  - "[[wiki/sources/source-slug|Source title]]"
tags:
  - comparison
reviewed: false
generation_complete: true
---
```

Allowed analysis tags: `comparison`, `analysis`, `overview`, `synthesis`, `timeline`, `other`. `sources` lists every wiki page the analysis actually read; it may name entity, concept, source, or other analysis pages, never a raw note. Aliases are optional.

### Contradiction record

```yaml
---
type: contradiction
status: open
severity: warning
created: 2026-07-15
affected_pages:
  - "[[wiki/concepts/example|Example]]"
sources:
  - "[[wiki/sources/a|A]]"
  - "[[wiki/sources/b|B]]"
---
```

Include claim A, claim B, their respective sources, why they conflict, and a proposed verification path. Do not state an unsupported resolution.

## Body templates

Use Chinese section labels for this vault unless the active schema explicitly overrides them.

### Entity body

```markdown
# Canonical name

## 描述

用 3–6 句说明身份、作用、重要性和有来源支撑的关键事实。

## 相关实体

- [[wiki/entities/related|Related]] — 关系说明

## 相关概念

- [[wiki/concepts/related|Related concept]] — 关系说明

## 来源中的提及

- “原文逐字引用。” — [[wiki/sources/source-slug|来源标题]]
```

### Concept body

```markdown
# Canonical name

## 定义

给出清晰定义和语境。

## 关键特征

- 特征及其意义

## 应用

说明来源实际讨论的用途；不要凭空扩充。

## 相关概念

- [[wiki/concepts/related|Related concept]] — 关系说明

## 相关实体

- [[wiki/entities/related|Related entity]] — 关系说明

## 来源中的提及

- “原文逐字引用。” — [[wiki/sources/source-slug|来源标题]]
```

### Source body

```markdown
# Source title — 摘要

## 来源

- 原始文件：[[folder/original-note|Original note]]
- 摄取日期：2026-07-15
- 未读取的图片：（无，或列出无法查看的图片）

## 核心内容

100–200 字来源摘要，只描述来源实际内容。

## 关键实体

- [[wiki/entities/example|Example]]

## 关键概念

- [[wiki/concepts/example|Example]]

## 主要观点

- 有来源支持的要点
```

### Analysis body

```markdown
# Short semantic title

## 问题

一句话写明本页回答的问题或比较的对象。

## 结论

直接给出结论；比较类分析用表格，时间线类分析按日期列出。

## 分析

支撑结论的推理，每个 wiki 事实旁放行内全路径链接；wiki 中不存在的信息要明确标注。

## 依据

- [[wiki/concepts/example|Example]] — 本页从该页面取用了什么
```

`问题`, `结论`, and `依据` are required; `分析` may be omitted when the conclusion table already carries the reasoning.

### Index

Keep `wiki/index.md` deterministic. List entities, concepts, sources, and analyses in separate sections. Every entry carries the page link, its aliases, and a one-line summary — the first useful descriptive paragraph, shortened to 200 characters — so the index can be read first to find candidate pages. Never use a model to invent index summaries.

## Log format

`wiki/log.md` is append-only and chronological. Every entry starts with a heading in this exact shape, followed by optional bullets:

```markdown
## [2026-07-15] ingest | Attention Is All You Need

- source: notes/attention.md
- model surface: Codex
- created: wiki/sources/attention_1a2b3c, wiki/concepts/attention
- updated: wiki/entities/google
```

Operations: `init`, `ingest`, `query`, `lint`, `repair`, `merge`, `index`, `other`. Write entries with `wiki_ops.py log`, which appends the heading with today's date and creates the file on first use. The fixed prefix keeps the log parseable — `grep "^## \[" wiki/log.md | tail -5` lists the last five operations — and lint reports any `##` heading that departs from it. Never rewrite or reorder earlier entries.

## Mentions and provenance

- Keep quotes verbatim in the original language, including meaningful punctuation and wording.
- When the wiki language differs, place a translation after the verbatim quote; never replace the quote with the translation.
- Cite the generated source page. That source page must link to the exact original note through `source_file`.
- Deduplicate mentions by normalized quote plus source path.
- Do not create a mentions section when no grounded source quotation exists.
- Two to four quotations per extracted item is the target, not a quota. Prefer fewer grounded quotes to invented or weak excerpts.

## Merge invariants

- Preserve the earliest valid `created` date and always set `updated` to the current date when content changes.
- Append unique sources and aliases; never overwrite the arrays.
- Remove aliases identical to the filename or canonical title, case-insensitively.
- Preserve `reviewed: true`. Do not rewrite reviewed content. Append only genuinely new sourced facts in a dated “新增信息” section; if no new fact exists, update only provenance when needed.
- Preserve both sides of a contradiction with attribution.
- Keep all grounded mentions and user-authored sections.
- Never move an entity into concepts or the reverse without explicit human approval. Report cross-type collisions.
- Use four merge outcomes:
  - `skip`: information is already fully present; only new provenance/aliases may change.
  - `complementary`: append specific new facts to existing matching sections.
  - `merge`: integrate overlapping information while preserving structure and nonduplicate facts.
  - `contradictory`: retain both claims with attribution and open a contradiction record.
- Analysis pages are revised, not merged: a new answer to the same question re-reads the existing page, rewrites `结论`, `分析`, and `依据` from the current evidence, unions `sources`, and sets `updated`. A different question gets its own page.

## Default schema file

When `wiki/schema/config.md` is absent, create it with frontmatter `version: 2`, today's `updated` date, and `auto_suggestion_count: 0`. Its body must declare:

- the three layers — immutable raw sources, model-owned wiki, user-editable schema;
- managed folders, including `analyses/`, and the index/log locations;
- the page templates and allowed tags above;
- the log entry format and operation vocabulary;
- canonical names remain in the source language;
- source tags are inherited rather than LLM-derived;
- dates are set deterministically;
- multi-source merge invariants;
- stale threshold of 90 days and the stale-analysis definition;
- orphan, missing-page, page-candidate, and contradiction definitions.

A `version: 1` schema predates analysis pages and the log format. Treat both as active defaults and propose the schema update — as a diff, confirmed by the user — at the next write operation.

Treat the schema as user-editable policy. Never rewrite an existing schema wholesale merely to accommodate one source. Propose a diff and require confirmation for vocabulary or template changes.
