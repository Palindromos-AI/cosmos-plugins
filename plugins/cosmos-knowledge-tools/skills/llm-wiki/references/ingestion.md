# Ingestion and knowledge-fusion workflow

## Contents

1. Input gate
2. Extraction scope and batching
3. Structured analysis contract
4. Classification rules
5. Evidence rules
6. Identity resolution
7. Page creation and merging
8. Related-page and contradiction handling
9. Conversation ingestion
10. Finalization and failure behavior

## Input gate

Accept Markdown source notes only. Reject:

- missing paths;
- non-Markdown files;
- generated files under the wiki folder;
- files under `.obsidian/`, `.agents/`, or `.git/`;
- empty, whitespace-only, or frontmatter-only bodies;
- a content hash already present in a source page;
- a second source with the same content hash in the current batch.

Do not equate identical filenames with identical sources. Source-page slugs include a path fingerprint so same-named notes in different folders remain distinct.

If the user explicitly requests re-ingestion, compare the old source page's `contentHash` to the new hash. When changed, update the existing source page and merge only the delta into knowledge pages. When unchanged, report a no-op rather than making model-driven rewrites.

## Extraction scope and batching

Use `standard` granularity by default:

- Extract items that deserve reusable wiki links.
- Prefer durable knowledge claims, mechanisms, methods, named subjects, and meaningful relationships.
- Ignore incidental citations, passing tool mentions, generic nouns, section headings, and items unlikely to be referenced again.
- Target 4–6 factual sentences in each item summary.
- Return at most 20 total entity/concept items per semantic batch. Use smaller batches when the source is dense.

For long sources:

1. Read the complete document before deciding batch boundaries.
2. Split by semantic sections, not arbitrary character offsets.
3. In batch 1, extract `source_title`, `summary`, `key_points`, `related_pages`, and `contradictions` in addition to entities/concepts.
4. In later batches, extract only entities/concepts and carry an exact list of already extracted canonical names and aliases.
5. Merge batch results by semantic identity. Merge quote/provenance arrays rather than duplicating items.
6. Stop when a batch produces no new items or only repeats; do not keep prompting to fill a quota.

## Structured analysis contract

Create an internal analysis object before writing pages:

```json
{
  "source_title": "Semantic source title",
  "summary": "Source-grounded 100–200 word summary",
  "source_note_aliases": ["Alias inherited from source frontmatter"],
  "entities": [
    {
      "name": "Canonical source-language name",
      "type": "person|organization|project|product|event|place|other",
      "aliases": ["Natural alternative name"],
      "summary": "4–6 source-grounded factual sentences",
      "mentions_in_source": ["Verbatim complete sentence"],
      "mentions_with_provenance": [
        {
          "quote": "Verbatim complete sentence",
          "translation": "Optional wiki-language translation",
          "source_path": "exact/vault/path.md",
          "source_slug": "stable-source-slug",
          "extracted_at": "ISO timestamp"
        }
      ],
      "related_entities": ["Canonical names from this source"],
      "related_concepts": ["Canonical names from this source"]
    }
  ],
  "concepts": [
    {
      "name": "Canonical source-language name",
      "type": "theory|method|field|phenomenon|standard|term|other",
      "aliases": ["Natural alternative name"],
      "summary": "4–6 source-grounded factual sentences",
      "mentions_in_source": ["Verbatim complete sentence"],
      "mentions_with_provenance": [],
      "related_entities": [],
      "related_concepts": []
    }
  ],
  "contradictions": [
    {
      "claim": "Claim in current source",
      "source_page": "Existing conflicting wiki path",
      "contradicted_by": "Existing claim",
      "resolution": "Verification proposal, not an unsupported verdict"
    }
  ],
  "related_pages": ["Existing exact page paths"],
  "key_points": ["Source-grounded point"],
  "created_pages": [],
  "updated_pages": []
}
```

Always include both `entities` and `concepts`; use empty arrays. Validate every enum and required field before proceeding.

## Classification rules

Apply in order and stop at the first clear match:

1. Named person → entity/person.
2. Named organization, institution, company, team, or lab → entity/organization.
3. Named project, initiative, or program → entity/project.
4. Named place or region → entity/place.
5. Named event, conference, competition, or milestone → entity/event.
6. Named product with its own vendor or release cycle, including specific software, hardware, hosted service, or AI model → entity/product when it is a meaningful subject.
7. Abstract theory, principle, hypothesis, or scientific model → concept/theory.
8. Procedure, algorithm, method, technique, protocol, or training process → concept/method.
9. Broad discipline or area of study → concept/field.
10. Observable behavior or recurring effect → concept/phenomenon.
11. Formal specification or norm → concept/standard.
12. Definition, construct, or explanatory technical term → concept/term.
13. Concrete named thing not covered above → entity/other.
14. Abstract item still uncertain → concept/other.

Boundaries:

- Named models/frameworks can be product entities; their architectural ideas and training techniques are concepts.
- A product used only incidentally is not necessarily wiki-worthy.
- An author cited only as evidence is not automatically an entity.
- A paper is an entity only when the paper itself is the subject; otherwise its claims belong to concepts and its provenance to the source page.
- Never create both an entity and a concept for the same underlying item in one ingestion.

Apply the wiki-link test: if future notes would not naturally link to the item, omit it.

## Evidence rules

- Extract two to four complete verbatim sentences when the source provides them. Keep surrounding context.
- Verify every quote by exact substring search first. If typography differs, allow only Unicode normalization and whitespace normalization; do not accept paraphrases.
- Keep the original quote in `quote`. Put translation in a separate optional field.
- Set `source_path` to the exact original note path, never the generated source page.
- Never claim a detail in a generated page unless it appears in the structured summary or a grounded quotation.
- Keep inference visibly labeled as inference.

## Identity resolution

Resolve each extracted item before creating a path:

1. Compare normalized canonical name to all existing titles.
2. Compare it to every alias, case-insensitively.
3. Compare new aliases to existing titles and aliases.
4. Evaluate semantic equivalence for translations, abbreviations, spelling variants, and alternate phrasings.
5. Require high confidence that both refer to the same underlying thing. Related, parent/child, competing, or overlapping items are not duplicates.
6. Prefer the existing page path when equivalent.
7. If an equivalent page exists in the other page type, report a cross-type collision and do not silently merge.

Canonicalization policy:

- Reuse an established existing path when it is correct.
- For a new item, use the source-language name and slug rules from `schema.md`.
- Generate one to three genuine aliases. Before leaving aliases empty, check the source title, source frontmatter aliases, expansions and abbreviations stated in the source, and established field usage. For example, `Sparse Mixture of Experts` may use the established `Sparse MoE`; a generic invented translation is not acceptable. Do not invent translations for established technical terms. If no distinct alias is supported after this check, retaining an empty alias list is preferable to a false alias; lint may mark it for review.

## Page creation and merging

### Source page

Create the source page before knowledge pages so all citations have a provenance target. Include:

- exact `source_file` wikilink;
- deterministic `contentHash`;
- inherited source tags mapped to the source vocabulary;
- source frontmatter aliases;
- a source-grounded summary and key points;
- exact links to every planned entity/concept page.

Do not copy the complete source into the generated page. The original note remains authoritative.

### New entity/concept page

Use the exact templates in `schema.md`. Populate only facts and relationships present in the analysis. Include every grounded quote with a source-page citation. Mark `generation_complete: true` only after the complete page is written.

### Existing page merge triage

Classify the delta:

- `skip`: all semantic content already exists. Merge only new unique source, alias, and grounded mention metadata.
- `complementary`: append each new fact to an existing exact section, avoiding a full rewrite.
- `merge`: integrate facts into the whole body because the content overlaps or structure must change.
- `contradictory`: preserve both statements with their sources and create/update a contradiction record.

Default to `merge` when uncertain; do not silently drop potentially new knowledge.

On all merges:

- Re-read the page immediately before editing.
- Preserve unknown frontmatter and all user-authored sections.
- Preserve the original `created`; set `updated` today only when the file changes.
- Union `sources`, `aliases`, and grounded mentions.
- Preserve section order from the active schema.
- Avoid restating existing content in different words.
- Keep existing links unless incorrect; add bidirectional links when the relationship is useful.

For `reviewed: true`, preserve the existing body byte-for-byte. Append a dated `## 新增信息（来源）` section only for genuinely new facts. If the new source conflicts with reviewed content, do not overwrite it; open a contradiction record.

## Related-page and contradiction handling

Use `related_pages` only for pages that already exist and are substantially connected to the source. Update a related page only when the source contains new information specifically about that page. Preserve its frontmatter and body, adding a sourced fact or link in the appropriate section.

For contradictions:

- distinguish factual conflict from two compatible perspectives;
- cite both claims and sources;
- use `warning`, `conflict`, or `error` severity;
- leave status `open` until evidence supports a resolution;
- do not resolve by recency alone unless recency is materially relevant.

## Conversation ingestion

Ingest a conversation only when the user explicitly asks to save it and it contains reusable knowledge rather than casual chat.

1. Format turns with role and timestamp.
2. Compare topics against the index and classify the conversation as `fully_redundant`, `partially_new`, or `entirely_new`.
3. If fully redundant, do not write pages.
4. Distill knowledge rather than storing the full transcript as prose.
5. Produce the same structured analysis contract, using a semantic topic title and the actual conversation date.
6. Create a source page tagged `transcript` and cite that page from generated knowledge pages.
7. Use a single citation per distilled mention when no original file exists; do not fabricate `mentions_with_provenance` paths.

## Finalization and failure behavior

After each source:

1. Verify all written pages parse and conform to the schema.
2. Run deterministic lint.
3. Repair only issues caused by the current operation.
4. Rebuild the index.
5. Append the log entry.

Track partial failures per item. One failed entity must not discard successfully created pages. Retry a failed semantic item once only when the failure is transient or the proposed edit is unchanged. Never repeat a failed write blindly.

On interruption, remove or repair pages with `generation_complete: false` before the next ingest. Do not report the source as fully ingested while any required entity/concept page failed; report partial success and name every failure.
