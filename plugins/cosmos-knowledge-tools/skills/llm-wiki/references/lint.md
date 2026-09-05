# Lint, review, and repair workflow

## Contents

1. Safety model
2. Preparation
3. Deterministic scans
4. Semantic scans
5. Repair policies
6. Duplicate merge protocol
7. Contradiction protocol
8. Report and verification

## Safety model

Lint is read-only unless the user explicitly asks to fix issues. Separate:

- safe normalization: malformed repeated path prefixes, index regeneration, deduplicating identical list entries;
- content edits: correcting links, completing aliases, linking orphans, merging facts;
- destructive edits: deleting stubs, deleting duplicate source pages after merge, moving/renaming pages, broad schema rewrites.

Require explicit authorization for destructive edits. Never infer permission to delete from a request to “check” or “lint.”

## Preparation

1. Inventory all Markdown files in the vault for link resolution.
2. Build the managed content page map from the entity, concept, source, and analysis folders.
3. Exclude welcome, index, log, schema, and contradiction records from content-quality scans.
4. Parse frontmatter and links. Preserve the raw content for exact repairs.
5. Build the wikilink graph and incoming/outgoing degree maps.
6. Run deterministic lint before semantic analysis so the model does not spend effort on syntax errors.

## Deterministic scans

Run and report all of the following:

- missing, malformed, or folder-incompatible `type` fields;
- missing required dates, source fields, aliases, tags, H1, or template sections;
- invalid controlled-vocabulary tags;
- `generation_complete: false` pages left by interrupted operations;
- repeated folder prefixes or folder names leaked into link display labels;
- dead links, including case and `.md` variants;
- missing-page candidates: one dead-link target referenced from two or more pages, reported once with its referrers;
- orphan entity, concept, or source pages with no incoming link from another content page (analysis pages are outputs and are exempt);
- duplicate source `contentHash` values;
- entity/concept cross-type slug collisions;
- duplicate aliases within a page and aliases colliding across multiple pages;
- quotations not found in the original source note referenced by the source page;
- source-page links that do not resolve to an original note;
- entity/concept citations to missing source pages;
- stale pages whose `updated` date is older than 90 days;
- stale analyses whose `updated` date precedes the `updated` date of a page they cite;
- exact or near-exact body duplicates;
- dense hub pages with unusually broad low-value related-link lists;
- index entries missing from the final content page set or pointing to nonexistent pages;
- a populated Wiki with no active `schema/config.md` or no `log.md` audit trail;
- log headings that depart from `## [YYYY-MM-DD] <operation> | <title>`.

Severity:

- `error`: ungrounded quote, malformed page, missing original source, duplicate source hash, incomplete generation, or cross-type slug collision.
- `warning`: dead link, invalid tag, suspected duplicate, or unresolved contradiction.
- `info`: orphan, missing alias, stale page, stale analysis, missing-page candidate, malformed log heading, weak graph connectivity, or index drift.

Do not assume an orphan is bad. A new source page may legitimately have no incoming content link until ingestion completes.

## Semantic scans

Use the current Codex model, not an external API, for these stages.

### Duplicate candidates

Generate candidates from:

- canonical title equality after normalization;
- title-to-alias or alias-to-alias equality;
- shared distinctive bigrams;
- abbreviations and full forms;
- established translations;
- same-type pages with highly overlapping definitions.

Confirm only at very high confidence that both pages describe the same underlying entity or concept. Related, competing, parent/child, versioned, or overlapping pages are not duplicates. Prefer the more precise, established, and better-sourced page as target.

### Contradictions

Compare concrete claims that concern the same subject and scope. Distinguish:

- factual contradiction;
- temporal update;
- definitional difference;
- different perspective or context;
- apparent conflict caused by ambiguous naming.

Create a contradiction issue only for unresolved factual or definitional conflict. Cite both sides.

### Stale claims

A newer source can supersede a claim without contradicting it head-on: a figure revised, a status changed, a plan replaced. Compare claims across pages that share a subject, ordered by source date where the source records one. Flag a claim that a newer source has overtaken and name both pages. This is a temporal update, not a contradiction; the repair is to state the current claim with its source and keep the earlier one dated, not to delete either. Deterministic lint already reports analysis pages older than the pages they cite; review those first.

### Missing pages and cross-references

Look for knowledge the wiki mentions but never gives a home: an item named in several page bodies without a page of its own (deterministic lint reports dead-link targets shared by two or more pages; also scan plain-text mentions), and pages that discuss the same subject without linking to each other. Propose a new page only when sources already in the vault can fill it; otherwise record it as a gap.

### Gaps and follow-ups

Close every lint report with suggestions for the user: questions the wiki cannot yet answer, subjects with thin or single-source coverage, and sources worth adding. These are suggestions only — never fetch, search, or write to fill them without a separate request.

### Content quality

Flag:

- summaries that contain facts absent from sources;
- vague pages with no usable definition;
- entities/concepts that fail the wiki-link test;
- missing useful aliases;
- invented translations;
- relationships unsupported by any source;
- pages whose canonical type is likely wrong;
- schema drift, such as repeated new subtypes that do not fit existing tags.

Do not propose schema change for a single awkward item. Require a repeated structural need.

## Repair policies

### Dead links

1. Check exact title and alias matches case-insensitively.
2. Check established translation, abbreviation, spelling, and semantic equivalents.
3. Correct the link when a high-confidence page exists.
4. If no page exists, leave an unresolved issue unless available sources support creating a real page.
5. Never fill a stub from general model knowledge.

### Missing aliases

Generate only names that genuinely refer to the same item: abbreviations, full forms, spelling variants, and established translations. Do not include the canonical title itself or invented localized technical terms.

### Orphans

Identify one to three existing pages with a real, source-supported relationship. Add a backlink with a one-sentence relationship explanation. If no relationship is supported, leave the orphan unresolved.

### Stale analyses

Re-read the analysis and every cited page. Rewrite `结论`, `分析`, and `依据` from the current evidence, union `sources`, set `updated` to today, and note in `分析` what changed and why. If the newer evidence removes the basis for the conclusion, say so in the page rather than deleting it; deletion is destructive and needs authorization.

### Empty/incomplete pages

Fill a page only from cited original notes already present in the vault. Preserve its frontmatter and user content. When no source evidence exists, keep it unresolved or delete it only with explicit authorization.

### Invalid tags

Map to the closest allowed subtype only when the page content clearly supports the mapping. Otherwise use `other` and flag for review. Never discard an unknown user tag outside managed entity/concept/source/analysis pages.

### Polluted paths and displays

Normalize links such as `[[wiki/entities/entities/x|entities/x]]` to `[[wiki/entities/x|x]]` after verifying the target. Rename polluted page paths only with explicit authorization because backlinks must be updated atomically.

## Duplicate merge protocol

When authorized:

1. Choose target and source explicitly and show the rationale.
2. Re-read both pages and every backlink immediately before writing.
3. Preserve all target content.
4. Add only genuinely new source facts, grounded mentions, relationships, and sections.
5. Merge frontmatter deterministically: earliest `created`, today's `updated`, union of sources/aliases/tags, preserve `reviewed: true`.
6. Preserve both sides of any factual conflict in a contradiction section and record.
7. Rewrite every vault backlink from source to target, preserving useful display names.
8. Run lint and verify the target.
9. Delete or archive the source page only after the merged target and all backlinks validate and only with explicit authorization.

## Contradiction protocol

- Never delete either claim.
- Prefer primary, direct, and appropriately scoped sources when assessing reliability.
- Treat a newer source as decisive only when the subject can change over time.
- For perspective differences, preserve both and label context rather than calling one false.
- Add a resolution section only after evidence supports it; record the reasoning and update status to `resolved`.

## Report and verification

Produce a structured report containing:

- counts by severity and category;
- exact affected page paths;
- evidence and reasoning for semantic findings;
- recommended action and whether it is safe, content-changing, or destructive;
- fixes performed and fixes left unresolved;
- suggested follow-ups: open questions and sources worth adding.

After repairs:

1. Re-run deterministic lint.
2. Re-run only the semantic checks affected by changes.
3. Rebuild the index if paths, aliases, titles, or summaries changed.
4. Confirm no new dead links or ungrounded quotations were introduced.
5. Append the operation with `wiki_ops.py log --operation lint` for a read-only review or `--operation repair` when fixes were applied, one `--line` per count, fixed issue group, and unresolved item.
