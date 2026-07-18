# Wiki schema and invariants

## Contents

1. Managed layout
2. Naming and link rules
3. Frontmatter contracts
4. Body templates
5. Mentions and provenance
6. Merge invariants
7. Default schema file

## Managed layout

Use this vault-relative layout:

```text
wiki/
├── entities/
├── concepts/
├── sources/
├── schema/config.md
├── contradictions/
├── index.md
└── log.md
```

Treat only `entities`, `concepts`, and `sources` as content nodes in retrieval and most lint graph operations. Treat schema, contradictions, index, log, and welcome notes as support files.

## Naming and link rules

- Preserve the source-language canonical name as the entity/concept H1. Never translate a canonical name merely to match the wiki language.
- Produce filenames by trimming, removing control characters and `/\\:*?"<>|,()'!?、，。；：！？（）【】《》`, converting whitespace and periods to `-`, collapsing repeated `-`, trimming edge `-`, and lowercasing by default.
- Use `untitled` only when no usable characters remain, and flag the result for human review.
- Resolve a source page slug as `<source-basename-slug>_<fingerprint>`, capped at 80 characters. The fingerprint is the first six hexadecimal characters of unsigned FNV-1a over the complete vault-relative source path.
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

## 核心内容

100–200 字来源摘要，只描述来源实际内容。

## 关键实体

- [[wiki/entities/example|Example]]

## 关键概念

- [[wiki/concepts/example|Example]]

## 主要观点

- 有来源支持的要点
```

### Index

Keep `wiki/index.md` deterministic. List entities, concepts, and sources in separate sections. Include aliases and the first useful descriptive paragraph for entities/concepts. Never use a model to invent index summaries.

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

## Default schema file

When `wiki/schema/config.md` is absent, create it with frontmatter `version: 1`, today's `updated` date, and `auto_suggestion_count: 0`. Its body must declare:

- managed folders and index/log locations;
- the page templates and allowed tags above;
- canonical names remain in the source language;
- source tags are inherited rather than LLM-derived;
- dates are set deterministically;
- multi-source merge invariants;
- stale threshold of 90 days;
- orphan, missing-page, and contradiction definitions.

Treat the schema as user-editable policy. Never rewrite an existing schema wholesale merely to accommodate one source. Propose a diff and require confirmation for vocabulary or template changes.
