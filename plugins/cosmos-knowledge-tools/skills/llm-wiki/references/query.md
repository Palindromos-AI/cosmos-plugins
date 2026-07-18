# Query and retrieval workflow

## Contents

1. Retrieval inputs
2. Candidate matching
3. Wikilink graph and PPR
4. Context loading
5. Answer contract
6. Query-to-wiki feedback

## Retrieval inputs

Build a page registry from entity, concept, and source pages containing:

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

Read ranked pages in order. For entity/concept pages, start with the main definition/description and expand to other sections only as the question requires. Preserve citations and provenance.

Use this context budget discipline:

1. Load the top 5 pages.
2. Check whether they directly answer the question.
3. Load ranks 6–10 or follow a relevant link only when a concrete gap remains.
4. Do not flood context with the entire wiki.

For a follow-up question, include the necessary prior conversation context but rerun retrieval for the new question. Do not assume the previous page set is still sufficient.

## Answer contract

- Answer in the wiki language unless the user asks otherwise.
- Base every vault-specific claim on loaded pages.
- Add an inline full-path wikilink near each supported claim.
- End with `## 参考资料` and list each cited page once with a short description.
- Do not cite a page that was not read.
- If pages conflict, state the conflict and cite both.
- If evidence is missing, say the wiki does not contain the answer and suggest which source should be ingested.
- Do not blend general model knowledge into a wiki-grounded answer without a visible boundary. Use a labeled “一般知识补充” section only when the user requests general knowledge.

## Query-to-wiki feedback

Do not automatically save answers. When the user explicitly asks to preserve a useful conversation:

1. Evaluate whether it contains durable explanations, analyses, decisions, or facts.
2. Compare its topics against the current wiki.
3. Skip when fully redundant.
4. Distill only partially new or entirely new knowledge.
5. Use the conversation workflow in `ingestion.md`, including source page, identity resolution, merges, lint, index, and log.
