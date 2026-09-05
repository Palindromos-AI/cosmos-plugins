# Query and retrieval workflow

## Contents

1. Retrieval inputs
2. Candidate matching
3. Wikilink graph and PPR
4. Context loading
5. Answer contract
6. Filing answers back into the wiki
7. Saving conversations

## Retrieval inputs

Start by reading `wiki/index.md`. It is the content catalog — every entity, concept, source, and analysis page with its aliases and a one-line summary — and at moderate scale it alone tells you where to look. Then let `wiki_ops.py retrieve` rank candidates; use `inventory` only when alias, hash, or link details are needed.

The registry behind `retrieve` covers entity, concept, source, and analysis pages and contains:

- vault-relative path without `.md`;
- H1 title or filename fallback;
- aliases from frontmatter;
- concise summary from the first meaningful descriptive section;
- page type;
- outgoing internal wikilinks.

Do not use embeddings. Use lexical signals, Codex-generated keywords when necessary, and the wikilink graph.

## Candidate matching

Tokenize the literal user query:

- collect lowercase ASCII letter/digit runs of length at least two;
- collect whitespace-delimited tokens of length at least two;
- collect contiguous CJK runs of length at least two;
- deduplicate tokens.

Score each page per token:

- title contains token: `+3`;
- otherwise an alias contains token: `+2`;
- otherwise the summary contains token: `+1`.

Add `+2` when all query tokens match and there is more than one token. Sort descending.

Treat literal matching as reliable when at least two useful tokens exist and at least half the tokens have length two or more. If literal matching is weak, use the current Codex model to derive 5–10 keywords:

- each keyword contains one to five words/tokens;
- order from most specific to broadest;
- include canonical names, abbreviations, translations in real usage, and key technical terms;
- do not output full sentences.

Pass these as `--keyword` to `wiki_ops.py retrieve`. If keyword matching still produces no seed, use semantic reasoning over page titles and aliases to choose a small set of high-confidence seeds. Do not select a page merely because it is broadly related.

## Wikilink graph and PPR

Build a directed graph from resolved links among registered content pages. Ignore self-links and duplicate edges.

Use up to three highest-confidence seeds. Apply personalized PageRank behavior compatible with the plugin:

- 3,000 random walks per seed;
- at most 50 steps per walk;
- restart probability `0.05`;
- restart at the seed on a dangling node;
- merge multiple seeds by each node's maximum score.

Use a deterministic random seed in the script so repeated queries are reproducible.

Treat a graph as mature only when it has at least 30 pages, 30 edges, at least one edge per page on average, and more than half the nodes lie in one weakly connected component. For an immature graph, still use seed-based PPR when the seed has an outgoing link; otherwise use lexical rank only.

Merge lexical and PPR rankings by the maximum of normalized lexical rank and PPR score. Return at most 10 pages by default.

## Context loading

Read ranked pages in order. For entity/concept pages, start with the main definition/description and expand to other sections only as the question requires. For an analysis page, read `结论` and `依据` first; it may already answer the question, but check its `updated` date against the pages it cites before relying on it. Preserve citations and provenance.

Use this context budget discipline:

1. Load the top 5 pages.
2. Check whether they directly answer the question.
3. Load ranks 6–10 or follow a relevant link only when a concrete gap remains.
4. Do not flood context with the entire wiki.

For a follow-up question, include the necessary prior conversation context but rerun retrieval for the new question. Do not assume the previous page set is still sufficient.

## Answer contract

- Answer in the wiki language unless the user asks otherwise.
- Choose the form the question calls for: prose for explanations, a table for comparisons, a dated list for timelines, or another format the user asks for. The evidence rules below apply to every form.
- Base every vault-specific claim on loaded pages.
- Add an inline full-path wikilink near each supported claim.
- End with `## 参考资料` and list each cited page once with a short description.
- Do not cite a page that was not read.
- If pages conflict, state the conflict and cite both.
- If evidence is missing, say the wiki does not contain the answer and suggest which source should be ingested.
- Do not blend general model knowledge into a wiki-grounded answer without a visible boundary. Use a labeled “一般知识补充” section only when the user requests general knowledge.

## Filing answers back into the wiki

A good answer is wiki content: a comparison the user asked for, an analysis, a connection between pages that no single page states. Left in the conversation it is lost; filed as a page it compounds like an ingested source. File only when the user asks — “把这个存进 wiki”, “保存这份比较” — never automatically.

1. Decide the page type. An answer built from wiki evidence becomes an analysis page under `wiki/analyses/`. A conversation that introduced knowledge the wiki does not yet hold — new facts, external claims, decisions — is a source and follows *Saving conversations* below. One conversation may need both.
2. Choose a short semantic title for the question answered and derive the slug with the filename rules in `schema.md`. Check `analyses/` for an existing page on the same question; if one exists, revise it instead of creating a second.
3. Write the page with the analysis frontmatter and body template in `schema.md`: `question` states what the page answers; `sources` lists every wiki page read for the answer (entity, concept, source, or analysis pages — never raw notes); `tags` carries one of `comparison`, `analysis`, `overview`, `synthesis`, `timeline`, `other`; `结论` holds the answer in its final form; `分析` keeps the reasoning with inline links; `依据` lists each cited page and what it contributed.
4. Keep every claim traceable to a cited page. Information the wiki lacks stays labeled as such inside the page — an analysis never smuggles general knowledge into the wiki as fact. Any “一般知识补充” from the answer stays out of the page unless the user explicitly wants it recorded, and then it keeps its label.
5. Do not modify entity or concept pages to point at the analysis unless the user asks; analysis pages are outputs and need no inbound links.
6. Run `lint`, fix issues the new page caused, run `index --write`, and append `log --operation query --title "<analysis title>"` with the page path and the cited pages.

When a later ingest updates a page an analysis cites, lint reports the analysis as stale. Revise it from the current evidence on request; never let an old conclusion stand silently against newer pages.

## Saving conversations

When the user explicitly asks to preserve a conversation whose value is new knowledge rather than the answer itself:

1. Evaluate whether it contains durable explanations, analyses, decisions, or facts.
2. Compare its topics against the current wiki.
3. Skip when fully redundant.
4. Distill only partially new or entirely new knowledge.
5. Use the conversation workflow in `ingestion.md`, including source page, identity resolution, merges, lint, index, and log.
