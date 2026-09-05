#!/usr/bin/env python3
"""Deterministic operations for the llm-wiki skill.

This module performs no model or network calls. Semantic extraction, identity
resolution, content generation, and semantic lint remain the Codex agent's job.
"""

from __future__ import annotations

import argparse
import ast
import fnmatch
import hashlib
import json
import math
import os
import random
import re
import sys
import tempfile
import unicodedata
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


ENTITY_TAGS = {"person", "organization", "project", "product", "event", "place", "other"}
CONCEPT_TAGS = {"theory", "method", "field", "phenomenon", "standard", "term", "other"}
SOURCE_TAGS = {"paper", "article", "book", "transcript", "clippings", "notes", "other"}
ANALYSIS_TAGS = {"comparison", "analysis", "overview", "synthesis", "timeline", "other"}
TAGS_BY_TYPE = {"entity": ENTITY_TAGS, "concept": CONCEPT_TAGS, "source": SOURCE_TAGS, "analysis": ANALYSIS_TAGS}
PAGE_TYPE_BY_DIR = {"entities": "entity", "concepts": "concept", "sources": "source", "analyses": "analysis"}
CONTENT_DIRS = tuple(PAGE_TYPE_BY_DIR)
# Every log entry starts with this heading so the log stays greppable:
# `grep "^## \[" wiki/log.md | tail -5` lists the last five operations.
LOG_OPERATIONS = ("init", "ingest", "query", "lint", "repair", "merge", "index", "other")
LOG_HEADING_RE = re.compile(r"^## \[\d{4}-\d{2}-\d{2}\] (?:" + "|".join(LOG_OPERATIONS) + r") \| \S.*$")
INDEX_SUMMARY_LIMIT = 200
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]")
FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}
ATTACHMENT_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif",
    ".pdf", ".canvas", ".base",
    ".mp3", ".wav", ".m4a", ".ogg", ".flac",
    ".mp4", ".mov", ".webm", ".mkv", ".ogv", ".3gp",
    ".zip", ".csv", ".json", ".xlsx", ".docx", ".pptx",
}


@dataclass
class Page:
    file_path: Path
    rel_file: str
    rel_no_ext: str
    page_type: str
    title: str
    aliases: list[str]
    summary: str
    frontmatter: dict[str, Any]
    body: str
    content: str
    links: list[str]


def json_dump(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False))


def fnv1a(text: str) -> int:
    value = 2166136261
    # Match JavaScript charCodeAt exactly, including surrogate pairs for
    # non-BMP filenames and source content.
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    for index in range(0, len(encoded), 2):
        code_unit = encoded[index] | (encoded[index + 1] << 8)
        value ^= code_unit
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def has_hidden_part(parts: Iterable[str]) -> bool:
    # `.trash`, `.obsidian`, `.smart-env`, and every other dot directory hold
    # deleted or tool-managed files, never source notes.
    return any(part.startswith(".") for part in parts)


def split_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    content = content.removeprefix("\ufeff")
    match = FRONTMATTER_RE.match(content)
    if not match:
        return {}, content
    return parse_frontmatter(match.group(1)), content[match.end():]


def parse_frontmatter(raw: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    lines = raw.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            i += 1
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            i += 1
            continue
        if value:
            result[key] = parse_scalar(value)
            i += 1
            continue
        items: list[Any] = []
        j = i + 1
        while j < len(lines):
            candidate = lines[j]
            # Accept column-0 sequence items: `- item` without indentation is
            # valid YAML and what Obsidian and other tools commonly write.
            # YAML requires whitespace after the dash (or a lone dash for a
            # null item); a glued `-5` is not a sequence item and must not be
            # read as `5` with its sign dropped.
            match = re.match(r"^\s*-(?:\s+(.*?))?\s*$", candidate)
            if not match:
                break
            items.append(parse_scalar(match.group(1) or ""))
            j += 1
        result[key] = items if items else ""
        i = j
    return result


def parse_scalar(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none", "~"}:
        return None
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        try:
            parsed = ast.literal_eval(value)
            if isinstance(parsed, list):
                return parsed
        except (SyntaxError, ValueError):
            pass
        return [strip_quotes(item.strip()) for item in split_csv(inner) if item.strip()]
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return strip_quotes(value)
    if re.fullmatch(r"-?\d+", value):
        try:
            return int(value)
        except ValueError:
            pass
    return value


def split_csv(value: str) -> list[str]:
    items: list[str] = []
    current: list[str] = []
    quote: str | None = None
    for char in value:
        if char in {'"', "'"}:
            if quote == char:
                quote = None
            elif quote is None:
                quote = char
            current.append(char)
        elif char == "," and quote is None:
            items.append("".join(current))
            current = []
        else:
            current.append(char)
    items.append("".join(current))
    return items


def strip_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1].replace(r'\"', '"').replace(r"\'", "'")
    return value


def as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def normalize_text(text: str) -> str:
    return normalize_ws(unicodedata.normalize("NFKC", text)).casefold()


def content_hash(body: str) -> str:
    normalized = normalize_ws(body)
    # JavaScript String.length counts UTF-16 code units, not Unicode code
    # points. Match the plugin so existing contentHash values interoperate.
    js_length = len(normalized.encode("utf-16-le", errors="surrogatepass")) // 2
    return f"{js_length:x}-{fnv1a(normalized):08x}"


def slugify(text: str, preserve_case: bool = False) -> str:
    text = text.strip()
    if not text:
        return "untitled"
    text = re.sub(r"[\x00-\x1f]", "", text)
    text = re.sub(r"[/\\:*?\"<>|,()'!?、，。；：！？（）【】《》]", "", text)
    if not text:
        return "untitled"
    text = re.sub(r"[\s.]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-").strip()
    if not text:
        return "untitled"
    return text if preserve_case else text.lower()


def source_slug(rel_path: str, preserve_case: bool = False, max_len: int = 80) -> str:
    rel_path = rel_path.replace("\\", "/")
    basename = Path(rel_path).stem
    fingerprint = f"{fnv1a(rel_path):08x}"[:6]
    tail = f"_{fingerprint}"
    base = slugify(basename, preserve_case)
    return f"{base[:max(1, max_len - len(tail))]}{tail}"


def safe_root(path: str) -> Path:
    root = Path(path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError(f"Vault is not a directory: {root}")
    return root


def safe_rel(root: Path, candidate: str) -> tuple[Path, str]:
    raw = Path(candidate).expanduser()
    resolved = raw.resolve() if raw.is_absolute() else (root / raw).resolve()
    try:
        rel = resolved.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError(f"Path escapes vault: {candidate}") from exc
    return resolved, rel


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
        os.replace(temp_name, path)
    except Exception:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise


def all_markdown_files(root: Path) -> list[Path]:
    results: list[Path] = []
    for path in root.rglob("*.md"):
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if has_hidden_part(rel.parts):
            continue
        if path.is_file():
            results.append(path)
    return sorted(results)


def strip_link_markup(text: str) -> str:
    # Summaries are rendered into the index and query results; raw embed and
    # wikilink markup there is noise, so keep only the display text.
    text = re.sub(r"!\[\[[^\]]*\]\]", "", text)
    text = WIKILINK_RE.sub(lambda m: (m.group(2) or m.group(1)).strip(), text)
    return normalize_ws(text)


def first_summary(body: str, page_type: str) -> str:
    preferred = {
        "entity": ("描述", "description", "basic information"),
        "concept": ("定义", "definition", "description"),
        "source": ("核心内容", "summary", "core content"),
        "analysis": ("结论", "conclusion", "summary", "问题", "question"),
    }.get(page_type, ())
    sections = split_sections(body)
    # Preferred headings are tried in priority order, not body order: an
    # analysis whose conclusion is a table falls back to its question.
    for wanted in preferred:
        for heading, text in sections:
            if normalize_text(heading) == normalize_text(wanted):
                paragraph = first_paragraph(text)
                if paragraph:
                    return strip_link_markup(paragraph)[:500]
    for _, text in sections:
        paragraph = first_paragraph(text)
        if paragraph:
            return strip_link_markup(paragraph)[:500]
    return ""


def split_sections(body: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"^##\s+(.+?)\s*$", body, re.MULTILINE))
    sections: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        sections.append((match.group(1).strip(), body[match.end():end].strip()))
    if not sections:
        sections.append(("", body))
    return sections


def first_paragraph(text: str) -> str:
    chunks = re.split(r"\n\s*\n", text.strip())
    for chunk in chunks:
        lines = [line.strip() for line in chunk.splitlines() if line.strip()]
        # Headings, list items, quotes, fences, and table rows are structure,
        # not the descriptive sentence an index or ranking summary needs.
        prose = [line for line in lines if not line.startswith(("#", "-", "*", ">", "```", "|"))]
        if prose:
            return normalize_ws(" ".join(prose))
    return ""


def load_pages(
    root: Path,
    wiki_folder: str,
    unreadable: list[dict[str, str]] | None = None,
) -> list[Page]:
    pages: list[Page] = []
    wiki_root = root / wiki_folder
    for directory in CONTENT_DIRS:
        page_type = PAGE_TYPE_BY_DIR[directory]
        folder = wiki_root / directory
        if not folder.exists():
            continue
        for path in sorted(folder.rglob("*.md")):
            if has_hidden_part(path.relative_to(wiki_root).parts):
                continue
            try:
                content = read_text(path)
            except UnicodeDecodeError as exc:
                # One undecodable page must not abort the whole command; record
                # its path so the caller can surface it.
                if unreadable is not None:
                    unreadable.append({
                        "file": path.relative_to(root).as_posix(),
                        "error": str(exc),
                    })
                continue
            frontmatter, body = split_frontmatter(content)
            match = H1_RE.search(body)
            title = match.group(1).strip() if match else path.stem
            rel_file = path.relative_to(root).as_posix()
            pages.append(Page(
                file_path=path,
                rel_file=rel_file,
                rel_no_ext=rel_file[:-3],
                page_type=page_type,
                title=title,
                aliases=as_list(frontmatter.get("aliases")),
                summary=first_summary(body, page_type),
                frontmatter=frontmatter,
                body=body,
                content=content,
                links=[match.group(1).strip() for match in WIKILINK_RE.finditer(content)],
            ))
    return pages


def page_to_dict(page: Page) -> dict[str, Any]:
    return {
        "path": page.rel_no_ext,
        "file": page.rel_file,
        "type": page.frontmatter.get("type", page.page_type),
        "title": page.title,
        "aliases": page.aliases,
        "summary": page.summary,
        "contentHash": page.frontmatter.get("contentHash"),
        "source_file": page.frontmatter.get("source_file"),
        "links": page.links,
    }


def extract_link_target(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value:
        return None
    match = WIKILINK_RE.search(value)
    # `sources` entries are normally wikilinks, while a source page's
    # `source_file` is deliberately stored as an exact vault-relative path.
    # Accept both representations so lint can resolve the original note.
    return match.group(1).strip() if match else value


def default_schema(today: str) -> str:
    return f'''---
version: 2
updated: {today}
auto_suggestion_count: 0
---

# Wiki Schema Configuration

## Layers

- Raw sources: the user's own notes outside the wiki folder. Read-only; the wiki never edits, moves, or reformats them.
- Wiki: every page under the wiki folder. Generated and maintained by the model; the user reads it in Obsidian.
- Schema: this file. User-editable policy; propose a diff and confirm before changing vocabulary or templates.

## Wiki Structure

- Entity pages: `entities/` (person, organization, project, product, event, place, other)
- Concept pages: `concepts/` (theory, method, field, phenomenon, standard, term, other)
- Source pages: `sources/` (paper, article, book, transcript, clippings, notes, other)
- Analysis pages: `analyses/` (comparison, analysis, overview, synthesis, timeline, other) — answers, comparisons, and syntheses filed back from queries; they cite wiki pages, never raw notes directly.
- Contradiction records: `contradictions/`
- Index: `index.md` (deterministic catalog, regenerated after every write operation)
- Log: `log.md` (append-only; every entry heading is `## [YYYY-MM-DD] <operation> | <title>` with operation in init, ingest, query, lint, repair, merge, index, other)

## Entity Page Template

Use frontmatter `type: entity`, deterministic dates, source links, controlled tags, aliases, and optional `reviewed`. Use sections 描述、相关实体、相关概念、来源中的提及。

## Concept Page Template

Use frontmatter `type: concept`, deterministic dates, source links, controlled tags, aliases, and optional `reviewed`. Use sections 定义、关键特征、应用、相关概念、相关实体、来源中的提及。

## Source Page Template

Use frontmatter `type: source`, exact `source_file`, deterministic `contentHash`, inherited controlled tags, aliases, and dates. Use sections 来源、核心内容、关键实体、关键概念、主要观点。

## Analysis Page Template

Use frontmatter `type: analysis`, the answered `question`, `sources` listing every wiki page the analysis draws on, controlled tags, and dates. Use sections 问题、结论、依据, plus 分析 unless the conclusion already carries the reasoning.

## Naming Conventions

- Keep entity and concept names in the source language; never translate canonical names.
- Use lowercase hyphenated filenames and full-path wikilinks such as `[[wiki/concepts/example|Example]]`.
- Set dates deterministically; never ask a model to invent dates.

## Classification Rules

- Entity tags: person, organization, project, product, event, place, other.
- Concept tags: theory, method, field, phenomenon, standard, term, other.
- Source tags: paper, article, book, transcript, clippings, notes, other.
- Analysis tags: comparison, analysis, overview, synthesis, timeline, other.

## Multi-Source Merge Rules

- Append sources and aliases; never overwrite them.
- Preserve `reviewed: true` content and append only genuinely new sourced facts.
- Preserve both sides of contradictions with attribution.
- Return a no-op when a source adds no new content.

## Maintenance Policies

- Stale threshold: 90 days without updates.
- Stale analysis: an analysis page updated before a page it cites.
- Orphan: an entity, concept, or source page with no inbound content-page link.
- Missing page: a wikilink target that does not resolve; one referenced from two or more pages is a page candidate.
- Never fabricate quotes, sources, stub content, or conflict resolutions.
'''


def cmd_init(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    wiki = root / args.wiki_folder
    targets = [wiki / name for name in (*CONTENT_DIRS, "schema", "contradictions")]
    schema_path = wiki / "schema" / "config.md"
    actions = [{"action": "mkdir", "path": path.relative_to(root).as_posix(), "needed": not path.exists()} for path in targets]
    actions.append({"action": "create", "path": schema_path.relative_to(root).as_posix(), "needed": not schema_path.exists()})
    if args.write:
        for path in targets:
            path.mkdir(parents=True, exist_ok=True)
        if not schema_path.exists():
            atomic_write(schema_path, default_schema(date.today().isoformat()))
    json_dump({"write": args.write, "actions": actions})


def cmd_preflight(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    existing_hashes: dict[str, list[str]] = defaultdict(list)
    for page in pages:
        if page.page_type == "source":
            value = page.frontmatter.get("contentHash")
            if isinstance(value, str) and value:
                existing_hashes[value].append(page.rel_file)
    seen: dict[str, str] = {}
    results: list[dict[str, Any]] = []
    for source in args.source:
        item: dict[str, Any] = {"requested": source, "accepted": False}
        try:
            path, rel = safe_rel(root, source)
            item["path"] = rel
            if not path.exists() or not path.is_file():
                item["reason"] = "missing"
            elif path.suffix.lower() != ".md":
                item.update(reason="incompatible-type", detail=path.suffix)
            elif has_hidden_part(Path(rel).parts):
                item["reason"] = "managed-or-hidden-path"
            elif rel == args.wiki_folder or rel.startswith(args.wiki_folder.rstrip("/") + "/"):
                item["reason"] = "generated-wiki-page"
            else:
                _, body = split_frontmatter(read_text(path))
                if not normalize_ws(body):
                    item["reason"] = "empty"
                else:
                    digest = content_hash(body)
                    item["contentHash"] = digest
                    item["sourceSlug"] = source_slug(rel, args.preserve_case)
                    if digest in seen:
                        item.update(reason="duplicate", detail=f"same content as {seen[digest]}")
                    elif digest in existing_hashes:
                        item.update(reason="duplicate", detail=f"already ingested by {', '.join(existing_hashes[digest])}")
                    else:
                        seen[digest] = rel
                        item["accepted"] = True
        except (OSError, UnicodeError, ValueError) as exc:
            item.update(reason="error", detail=str(exc))
        results.append(item)
    json_dump({"accepted": sum(1 for item in results if item["accepted"]), "rejected": sum(1 for item in results if not item["accepted"]), "sources": results, "unreadablePages": unreadable})


def cmd_discover(args: argparse.Namespace) -> None:
    """Expand note folders and report their ingestion state without writing."""
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    existing_hashes: dict[str, list[str]] = defaultdict(list)
    existing_paths: dict[str, Page] = {}
    for page in pages:
        if page.page_type != "source":
            continue
        digest = page.frontmatter.get("contentHash")
        if isinstance(digest, str) and digest:
            existing_hashes[digest].append(page.rel_file)
        source_path = extract_link_target(page.frontmatter.get("source_file"))
        if source_path:
            existing_paths[source_path.removesuffix(".md")] = page

    requested = args.path or ["."]
    candidates: dict[str, Path] = {}
    request_errors: list[dict[str, str]] = []
    for value in requested:
        try:
            path, rel = safe_rel(root, value)
        except ValueError as exc:
            request_errors.append({"path": value, "reason": str(exc)})
            continue
        if not path.exists():
            request_errors.append({"path": value, "reason": "missing"})
        elif path.is_file():
            candidates[rel] = path
        elif path.is_dir():
            for child in path.rglob("*.md"):
                if child.is_file():
                    candidates[child.relative_to(root).as_posix()] = child
        else:
            request_errors.append({"path": value, "reason": "unsupported-path"})

    results: list[dict[str, Any]] = []
    excluded_count = 0
    seen_hashes: dict[str, str] = {}
    wiki_prefix = args.wiki_folder.rstrip("/") + "/"
    for rel, path in sorted(candidates.items()):
        parts = Path(rel).parts
        if has_hidden_part(parts) or rel == args.wiki_folder or rel.startswith(wiki_prefix):
            excluded_count += 1
            continue
        if any(fnmatch.fnmatch(rel, pattern) or Path(rel).match(pattern) for pattern in (args.exclude or [])):
            excluded_count += 1
            continue
        item: dict[str, Any] = {"path": rel}
        if path.suffix.lower() != ".md":
            item.update(status="incompatible", reason=path.suffix)
            results.append(item)
            continue
        try:
            _, body = split_frontmatter(read_text(path))
        except (OSError, UnicodeError) as exc:
            item.update(status="error", reason=str(exc))
            results.append(item)
            continue
        if not normalize_ws(body):
            item.update(status="empty")
            results.append(item)
            continue
        digest = content_hash(body)
        item.update(contentHash=digest, sourceSlug=source_slug(rel, args.preserve_case))
        path_key = rel.removesuffix(".md")
        existing_page = existing_paths.get(path_key)
        if existing_page:
            existing_digest = existing_page.frontmatter.get("contentHash")
            status = "unchanged" if existing_digest == digest else "changed"
            item.update(status=status, sourcePage=existing_page.rel_file)
            if status == "changed":
                seen_hashes[digest] = rel
        elif digest in existing_hashes:
            item.update(status="duplicate", sourcePage=existing_hashes[digest][0])
        elif digest in seen_hashes:
            item.update(status="duplicate-in-scope", duplicateOf=seen_hashes[digest])
        else:
            item["status"] = "new"
            seen_hashes[digest] = rel
        results.append(item)

    # Classification must not depend on whether a changed original path or
    # its new same-content copy sorts first.
    changed_by_hash = {
        str(item["contentHash"]): str(item["path"])
        for item in results
        if item.get("status") == "changed" and item.get("contentHash")
    }
    for item in results:
        digest = str(item.get("contentHash", ""))
        if item.get("status") == "new" and digest in changed_by_hash:
            item.update(status="duplicate-in-scope", duplicateOf=changed_by_hash[digest])

    counts: dict[str, int] = defaultdict(int)
    for item in results:
        counts[str(item["status"])] += 1
    json_dump({
        "requested": requested,
        "excludedPatterns": args.exclude or [],
        "excludedCount": excluded_count,
        "requestErrors": request_errors,
        "counts": dict(sorted(counts.items())),
        "sources": results,
        "unreadablePages": unreadable,
    })


def cmd_inventory(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    json_dump({"wikiFolder": args.wiki_folder, "count": len(pages), "pages": [page_to_dict(page) for page in pages], "unreadablePages": unreadable})


def tokenise(text: str) -> list[str]:
    tokens: set[str] = set()
    lower = text.casefold()
    tokens.update(re.findall(r"[a-z0-9]{2,}", lower))
    tokens.update(token for token in re.split(r"\s+", lower) if len(token) >= 2)
    tokens.update(run.casefold() for run in re.findall(r"[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7ff]{2,}", text))
    return sorted(tokens)


def lexical_scores(pages: list[Page], needles: Iterable[str]) -> list[tuple[Page, float]]:
    normalized = [normalize_text(item) for item in needles if normalize_text(item)]
    scored: list[tuple[Page, float]] = []
    for page in pages:
        title = normalize_text(page.title)
        aliases = [normalize_text(alias) for alias in page.aliases]
        summary = normalize_text(page.summary)
        score = 0.0
        found = 0
        for needle in normalized:
            if needle in title:
                score += 3
                found += 1
            elif any(needle in alias for alias in aliases):
                score += 2
                found += 1
            elif needle in summary:
                score += 1
                found += 1
        if normalized and found == len(normalized) and len(normalized) > 1:
            score += 2
        if score > 0:
            scored.append((page, score))
    return sorted(scored, key=lambda item: (-item[1], item[0].rel_no_ext))


def keyword_anchor_key(page: Page, keyword: str, overall_rank: dict[str, int], fallback_rank: int) -> tuple[int, int, int, str] | None:
    """Rank high-confidence keyword anchors by match specificity."""
    needle = normalize_text(keyword)
    if not needle:
        return None
    title = normalize_text(page.title)
    aliases = [normalize_text(alias) for alias in page.aliases]
    if title == needle:
        quality, excess = 0, 0
    elif needle in aliases:
        quality, excess = 1, 0
    elif needle in title:
        quality, excess = 2, len(title) - len(needle)
    else:
        alias_excess = [len(alias) - len(needle) for alias in aliases if needle in alias]
        if not alias_excess:
            return None
        quality, excess = 3, min(alias_excess)
    return quality, excess, overall_rank.get(page.rel_no_ext, fallback_rank), page.rel_no_ext


def page_lookup(pages: list[Page], wiki_folder: str) -> tuple[dict[str, str], dict[str, list[str]]]:
    exact: dict[str, str] = {}
    fuzzy: dict[str, list[str]] = defaultdict(list)
    for page in pages:
        forms = {
            page.rel_no_ext,
            page.rel_file,
            page.rel_no_ext.removeprefix(wiki_folder.rstrip("/") + "/"),
            Path(page.rel_no_ext).name,
            page.title,
            *page.aliases,
        }
        for form in forms:
            clean = form.strip()
            if not clean:
                continue
            exact.setdefault(clean, page.rel_no_ext)
            fuzzy[normalize_text(clean)].append(page.rel_no_ext)
    return exact, fuzzy


def resolve_content_target(target: str, exact: dict[str, str], fuzzy: dict[str, list[str]], wiki_folder: str) -> str | None:
    target = target.strip().removesuffix(".md")
    candidates = [target]
    prefix = wiki_folder.rstrip("/") + "/"
    if not target.startswith(prefix):
        candidates.append(prefix + target)
    for candidate in candidates:
        if candidate in exact:
            return exact[candidate]
    matches = fuzzy.get(normalize_text(target), [])
    unique = sorted(set(matches))
    return unique[0] if len(unique) == 1 else None


def build_graph(pages: list[Page], wiki_folder: str) -> dict[str, list[str]]:
    exact, fuzzy = page_lookup(pages, wiki_folder)
    graph: dict[str, list[str]] = {page.rel_no_ext: [] for page in pages}
    for page in pages:
        seen: set[str] = set()
        for raw in page.links:
            resolved = resolve_content_target(raw, exact, fuzzy, wiki_folder)
            if resolved and resolved != page.rel_no_ext and resolved not in seen:
                seen.add(resolved)
                graph[page.rel_no_ext].append(resolved)
    return graph


def weak_component_ratio(graph: dict[str, list[str]]) -> float:
    if not graph:
        return 0.0
    undirected: dict[str, set[str]] = {node: set() for node in graph}
    for node, targets in graph.items():
        for target in targets:
            if target in undirected:
                undirected[node].add(target)
                undirected[target].add(node)
    largest = 0
    remaining = set(graph)
    while remaining:
        seed = next(iter(remaining))
        queue = deque([seed])
        visited = {seed}
        while queue:
            node = queue.popleft()
            for nxt in undirected[node]:
                if nxt not in visited:
                    visited.add(nxt)
                    queue.append(nxt)
        remaining -= visited
        largest = max(largest, len(visited))
    return largest / len(graph)


def graph_stats(graph: dict[str, list[str]]) -> dict[str, Any]:
    nodes = len(graph)
    edges = sum(len(targets) for targets in graph.values())
    ratio = weak_component_ratio(graph)
    mature = nodes >= 30 and edges >= 30 and (edges / nodes if nodes else 0) >= 1 and ratio > 0.5
    return {"nodes": nodes, "edges": edges, "edgeDensity": edges / nodes if nodes else 0, "largestWeakComponentRatio": ratio, "mature": mature}


def ppr(graph: dict[str, list[str]], seed: str, rng: random.Random, walks: int = 3000, steps: int = 50, damping: float = 0.05) -> dict[str, float]:
    if seed not in graph:
        return {}
    counts: dict[str, int] = defaultdict(int)
    counts[seed] = walks
    for _ in range(walks):
        current = seed
        for _ in range(steps):
            outgoing = graph.get(current, [])
            if rng.random() < damping or not outgoing:
                current = seed
            else:
                current = outgoing[rng.randrange(len(outgoing))]
            counts[current] += 1
    total = sum(counts.values())
    return {node: count / total for node, count in counts.items()} if total else {}


def cmd_retrieve(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    literal_tokens = tokenise(args.query)
    needles = list(literal_tokens)
    for keyword in args.keyword or []:
        if keyword.strip():
            needles.append(keyword.strip())
    lexical = lexical_scores(pages, needles)
    overall_rank = {page.rel_no_ext: index for index, (page, _) in enumerate(lexical)}
    keyword_anchors: list[str] = []
    keyword_anchor_keys: dict[str, tuple[int, int, int, str]] = {}
    keyword_anchor_matches: list[dict[str, str]] = []
    for keyword in args.keyword or []:
        matches = [
            (key, page)
            for page in pages
            if (key := keyword_anchor_key(page, keyword, overall_rank, len(pages))) is not None
        ]
        if not matches:
            continue
        anchor_key, page = min(matches, key=lambda item: item[0])
        keyword_anchor_matches.append({"keyword": keyword, "path": page.rel_no_ext})
        keyword_anchor_keys[page.rel_no_ext] = min(
            keyword_anchor_keys.get(page.rel_no_ext, anchor_key),
            anchor_key,
        )
        if page.rel_no_ext not in keyword_anchors:
            keyword_anchors.append(page.rel_no_ext)
    graph = build_graph(pages, args.wiki_folder)
    stats = graph_stats(graph)
    seeds: list[str] = []
    for path in [page.rel_no_ext for page, _ in lexical[:3]] + keyword_anchors:
        if path in graph and path not in seeds:
            seeds.append(path)
        if len(seeds) >= 8:
            break
    merged_ppr: dict[str, float] = {}
    for seed in seeds:
        # A seed-local RNG makes results independent of keyword/seed order.
        rng = random.Random(fnv1a(seed))
        for node, score in ppr(graph, seed, rng).items():
            merged_ppr[node] = max(merged_ppr.get(node, 0.0), score)
    by_path = {page.rel_no_ext: page for page in pages}
    combined: dict[str, float] = {}
    for index, (page, _) in enumerate(lexical):
        lex_rank = max(1, len(lexical) - index) / len(lexical)
        combined[page.rel_no_ext] = max(lex_rank, merged_ppr.get(page.rel_no_ext, 0.0))
    for path, score in merged_ppr.items():
        combined[path] = max(combined.get(path, 0.0), score)
    for path, key in keyword_anchor_keys.items():
        quality, excess, _, _ = key
        # Explicit, high-confidence anchors should rank ahead of broader pages.
        anchor_score = 2.0 - (quality * 0.2) - (min(excess, 99) * 0.001)
        combined[path] = max(combined.get(path, 0.0), anchor_score)
    ranked_all = sorted(combined.items(), key=lambda item: (-item[1], item[0]))
    limit = max(1, args.top)
    selected: set[str] = set(keyword_anchors[:limit])
    dropped_keyword_anchors = keyword_anchors[limit:]
    for path, _ in ranked_all:
        if len(selected) >= limit:
            break
        selected.add(path)
    ranked = [item for item in ranked_all if item[0] in selected][:limit]
    arm = "lex+deterministic-ppr" if merged_ppr else "lex"
    json_dump({
        "query": args.query,
        "tokens": literal_tokens,
        "keywords": args.keyword or [],
        "unreadablePages": unreadable,
        "graph": stats,
        "seeds": seeds,
        "keywordAnchors": keyword_anchors,
        "keywordAnchorMatches": keyword_anchor_matches,
        "droppedKeywordAnchors": dropped_keyword_anchors,
        "arm": arm,
        "results": [
            {"path": path, "title": by_path[path].title, "type": by_path[path].page_type, "score": round(score, 8), "summary": by_path[path].summary}
            for path, score in ranked if path in by_path
        ],
    })


def all_known_targets(root: Path) -> tuple[set[str], dict[str, list[str]]]:
    exact: set[str] = set()
    normalized: dict[str, list[str]] = defaultdict(list)
    for path in all_markdown_files(root):
        rel_file = path.relative_to(root).as_posix()
        rel_no_ext = rel_file[:-3]
        forms = {rel_file, rel_no_ext, path.name, path.stem}
        parts = rel_no_ext.split("/")
        for index in range(1, len(parts)):
            forms.add("/".join(parts[index:]))
            forms.add("/".join(parts[index:]) + ".md")
        for form in forms:
            exact.add(form)
            normalized[normalize_text(form.removesuffix(".md"))].append(rel_no_ext)
    return exact, normalized


def link_exists(target: str, exact: set[str], normalized: dict[str, list[str]]) -> bool:
    target = target.strip()
    if target in exact or target + ".md" in exact or target.removesuffix(".md") in exact:
        return True
    matches = normalized.get(normalize_text(target.removesuffix(".md")), [])
    return len(set(matches)) == 1


def add_issue(issues: list[dict[str, Any]], severity: str, category: str, path: str, detail: str, **extra: Any) -> None:
    issue = {"severity": severity, "category": category, "path": path, "detail": detail}
    issue.update(extra)
    issues.append(issue)


def required_sections(page_type: str) -> list[set[str]]:
    if page_type == "entity":
        return [{"描述", "description"}, {"相关实体", "related entities"}, {"相关概念", "related concepts"}, {"来源中的提及", "mentions in source"}]
    if page_type == "concept":
        return [{"定义", "definition", "description"}, {"关键特征", "key characteristics"}, {"应用", "applications"}, {"相关概念", "related concepts"}, {"相关实体", "related entities"}, {"来源中的提及", "mentions in source"}]
    if page_type == "analysis":
        return [{"问题", "question"}, {"结论", "conclusion"}, {"依据", "evidence", "references"}]
    return [{"来源", "source"}, {"核心内容", "core content", "summary"}, {"关键实体", "key entities"}, {"关键概念", "key concepts"}, {"主要观点", "main points"}]


def resolve_source_original(root: Path, source_page: Page) -> Path | None:
    target = extract_link_target(source_page.frontmatter.get("source_file"))
    if not target:
        return None
    candidates = [target, target + ".md"] if not target.endswith(".md") else [target]
    for candidate in candidates:
        try:
            path, _ = safe_rel(root, candidate)
        except ValueError:
            continue
        if path.is_file():
            return path
    return None


def extract_mentions(body: str) -> list[tuple[str, str | None]]:
    relevant = ""
    for heading, section in split_sections(body):
        if normalize_text(heading) in {"来源中的提及", "mentions in source"}:
            relevant = section
            break
    if not relevant:
        return []
    results: list[tuple[str, str | None]] = []
    pattern = re.compile(r'^[*-]\s*["“](.+?)["”]\s*(?:[—-]\s*)?(?:\[\[([^\]]+)\]\])?\s*$', re.MULTILINE)
    for match in pattern.finditer(relevant):
        citation = match.group(2).split("|", 1)[0].strip() if match.group(2) else None
        results.append((match.group(1).strip(), citation))
    return results


def page_date(page: Page) -> date | None:
    value = page.frontmatter.get("updated")
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None


def cmd_lint(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    exact_targets, normalized_targets = all_known_targets(root)
    exact_pages, fuzzy_pages = page_lookup(pages, args.wiki_folder)
    issues: list[dict[str, Any]] = []
    for item in unreadable:
        add_issue(issues, "error", "unreadable-page", item["file"], item["error"])
    graph = build_graph(pages, args.wiki_folder)
    incoming: dict[str, set[str]] = {page.rel_no_ext: set() for page in pages}
    for source, targets in graph.items():
        for target in targets:
            incoming.setdefault(target, set()).add(source)

    hashes: dict[str, list[str]] = defaultdict(list)
    alias_owners: dict[str, list[str]] = defaultdict(list)
    body_digests: dict[str, list[str]] = defaultdict(list)
    dead_targets: dict[str, set[str]] = defaultdict(set)
    by_path = {page.rel_no_ext: page for page in pages}
    source_by_path = {page.rel_no_ext: page for page in pages if page.page_type == "source"}

    if pages:
        schema_path = root / args.wiki_folder / "schema" / "config.md"
        log_path = root / args.wiki_folder / "log.md"
        if not schema_path.is_file():
            add_issue(issues, "warning", "missing-schema", schema_path.relative_to(root).as_posix(), "Wiki has content pages but no active schema")
        if not log_path.is_file():
            add_issue(issues, "info", "missing-log", log_path.relative_to(root).as_posix(), "Wiki has content pages but no operation log")
        else:
            for line in read_text(log_path).splitlines():
                if line.startswith("## ") and not LOG_HEADING_RE.match(line):
                    add_issue(issues, "info", "malformed-log-entry", log_path.relative_to(root).as_posix(), f"Heading is not `## [YYYY-MM-DD] <operation> | <title>`: {line}")

    for page in pages:
        fm = page.frontmatter
        if not fm:
            add_issue(issues, "error", "missing-frontmatter", page.rel_file, "Managed page has no YAML frontmatter")
        declared_type = fm.get("type")
        if declared_type != page.page_type:
            add_issue(issues, "error", "type-mismatch", page.rel_file, f"Folder implies {page.page_type!r}, frontmatter declares {declared_type!r}")
        if not H1_RE.search(page.body):
            add_issue(issues, "error", "missing-title", page.rel_file, "Managed page has no H1 title")
        for field in ("created", "updated"):
            value = fm.get(field)
            if not isinstance(value, str) or not DATE_RE.match(value):
                add_issue(issues, "error", "invalid-date", page.rel_file, f"Missing or invalid {field}")
        if fm.get("generation_complete") is not True:
            add_issue(issues, "error", "incomplete-generation", page.rel_file, "generation_complete is missing or not true")

        tags = set(as_list(fm.get("tags")))
        valid_tags = TAGS_BY_TYPE[page.page_type]
        invalid = sorted(tags - valid_tags)
        if invalid:
            add_issue(issues, "warning", "invalid-tag", page.rel_file, f"Invalid controlled tags: {', '.join(invalid)}")
        if not tags:
            add_issue(issues, "warning", "missing-tag", page.rel_file, "Managed page has no controlled tag")

        if page.page_type in {"entity", "concept", "analysis"}:
            sources = as_list(fm.get("sources"))
            if not sources:
                add_issue(issues, "error", "missing-source-citation", page.rel_file, "Knowledge page has no sources")
            for source_value in sources:
                target = extract_link_target(source_value)
                if not target or not link_exists(target, exact_targets, normalized_targets):
                    add_issue(issues, "error", "missing-source-page", page.rel_file, f"Source citation does not resolve: {source_value}")
        if page.page_type in {"entity", "concept"} and not page.aliases:
            add_issue(issues, "info", "missing-alias", page.rel_file, "Entity/concept page has no non-empty alias")
        if page.page_type == "analysis":
            # An analysis synthesizes other pages; once one of them moves on,
            # the synthesis may state something the wiki no longer supports.
            own_date = page_date(page)
            cited_pages = [
                by_path.get(resolve_content_target(target, exact_pages, fuzzy_pages, args.wiki_folder) or "")
                for target in (extract_link_target(value) for value in as_list(fm.get("sources")))
                if target
            ]
            newer = sorted({
                cited.rel_file
                for cited in cited_pages
                if cited is not None and own_date is not None and (page_date(cited) or own_date) > own_date
            })
            if newer:
                add_issue(issues, "info", "stale-analysis", page.rel_file, f"Cited pages updated after this analysis: {', '.join(newer)}")

        headings = {normalize_text(heading) for heading, _ in split_sections(page.body) if heading}
        for alternatives in required_sections(page.page_type):
            if headings.isdisjoint({normalize_text(value) for value in alternatives}):
                add_issue(issues, "warning", "missing-section", page.rel_file, f"Missing section equivalent to: {sorted(alternatives)[0]}")

        seen_aliases: set[str] = set()
        for alias in page.aliases:
            key = normalize_text(alias)
            if key == normalize_text(page.title):
                add_issue(issues, "info", "redundant-alias", page.rel_file, f"Alias duplicates canonical title: {alias}")
            if key in seen_aliases:
                add_issue(issues, "info", "duplicate-alias", page.rel_file, f"Duplicate alias: {alias}")
            seen_aliases.add(key)
            alias_owners[key].append(page.rel_file)
        digest = hashlib.sha256(normalize_text(page.body).encode("utf-8")).hexdigest()
        body_digests[digest].append(page.rel_file)

        if page.page_type == "source":
            source_value = fm.get("source_file")
            if not isinstance(source_value, str) or WIKILINK_RE.search(source_value) is None:
                add_issue(issues, "error", "invalid-source-file-format", page.rel_file, "source_file must be an exact wikilink to the original note")
            digest_value = fm.get("contentHash")
            if isinstance(digest_value, str) and digest_value:
                hashes[digest_value].append(page.rel_file)
            else:
                add_issue(issues, "error", "missing-content-hash", page.rel_file, "Source page has no contentHash")
            original = resolve_source_original(root, page)
            if original is None:
                add_issue(issues, "error", "missing-original-source", page.rel_file, "source_file does not resolve to an original note")

        updated = fm.get("updated")
        if isinstance(updated, str) and DATE_RE.match(updated):
            try:
                if datetime.strptime(updated, "%Y-%m-%d").date() < date.today() - timedelta(days=90):
                    add_issue(issues, "info", "stale-page", page.rel_file, f"Last updated {updated}")
            except ValueError:
                pass

        for link_match in WIKILINK_RE.finditer(page.content):
            target, display = link_match.group(1), link_match.group(2)
            # Embeds (`![[...]]`) and links to non-Markdown attachments
            # (images, PDFs, .canvas, .base) are not page links; reporting
            # them as dead links is noise.
            is_embed = link_match.start() > 0 and page.content[link_match.start() - 1] == "!"
            target_suffix = Path(target.strip()).suffix.lower()
            skip_dead_link = is_embed or target_suffix in ATTACHMENT_SUFFIXES
            if not skip_dead_link and not link_exists(target.strip(), exact_targets, normalized_targets):
                add_issue(issues, "warning", "dead-link", page.rel_file, f"Unresolved target: {target.strip()}")
                dead_targets[target.strip().removesuffix(".md")].add(page.rel_file)
            if re.search(r"(?:entities|concepts|sources|analyses)/(?:entities|concepts|sources|analyses)/", target):
                add_issue(issues, "warning", "polluted-link", page.rel_file, f"Repeated path prefix: {target}")
            if display and re.match(r"^(?:entities|concepts|sources|analyses)/", display.strip()):
                add_issue(issues, "info", "polluted-display", page.rel_file, f"Folder prefix leaked into display: {display.strip()}")

        # Analysis pages are outputs filed back from queries; nothing has to
        # link to them, so an inbound-link check would only add noise.
        if page.page_type != "analysis" and not incoming.get(page.rel_no_ext):
            add_issue(issues, "info", "orphan", page.rel_file, "No incoming link from another managed content page")

    for target, referrers in sorted(dead_targets.items()):
        if len(referrers) > 1:
            add_issue(issues, "info", "missing-page-candidate", target, f"Dead-link target referenced by {len(referrers)} pages; a real page may be warranted", referrers=sorted(referrers))

    for digest, paths in hashes.items():
        if len(paths) > 1:
            for path in paths:
                add_issue(issues, "error", "duplicate-source-hash", path, f"Hash {digest} also used by: {', '.join(p for p in paths if p != path)}")

    for key, paths in alias_owners.items():
        unique = sorted(set(paths))
        if key and len(unique) > 1:
            for path in unique:
                add_issue(issues, "warning", "alias-collision", path, f"Alias also belongs to: {', '.join(p for p in unique if p != path)}", alias=key)

    for paths in body_digests.values():
        if len(paths) > 1:
            for path in paths:
                add_issue(issues, "warning", "duplicate-body", path, f"Body is identical to: {', '.join(p for p in paths if p != path)}")

    entities = {Path(page.rel_file).stem: page.rel_file for page in pages if page.page_type == "entity"}
    concepts = {Path(page.rel_file).stem: page.rel_file for page in pages if page.page_type == "concept"}
    for slug in sorted(set(entities) & set(concepts)):
        add_issue(issues, "error", "cross-type-collision", entities[slug], f"Same slug exists as concept: {concepts[slug]}")
        add_issue(issues, "error", "cross-type-collision", concepts[slug], f"Same slug exists as entity: {entities[slug]}")

    for page in pages:
        if page.page_type not in {"entity", "concept"}:
            continue
        for quote, citation in extract_mentions(page.body):
            source_page: Page | None = None
            if citation:
                resolved = resolve_content_target(citation, exact_pages, fuzzy_pages, args.wiki_folder)
                source_page = source_by_path.get(resolved or "")
            if source_page is None:
                add_issue(issues, "error", "ungrounded-quote", page.rel_file, "Mention has no resolvable source-page citation", quote=quote)
                continue
            original = resolve_source_original(root, source_page)
            grounded = False
            if original:
                _, original_body = split_frontmatter(read_text(original))
                grounded = normalize_text(quote) in normalize_text(original_body)
            if not grounded:
                add_issue(issues, "error", "ungrounded-quote", page.rel_file, f"Quote not found in original source for {source_page.rel_file}", quote=quote)

    node_count = len(graph)
    for node, targets in graph.items():
        threshold = max(12, math.ceil(node_count * 0.3))
        if len(targets) > threshold:
            add_issue(issues, "info", "dense-hub", node + ".md", f"Page has {len(targets)} outgoing managed links; review relationship specificity")

    index_path = root / args.wiki_folder / "index.md"
    expected = {page.rel_no_ext for page in pages}
    if index_path.exists():
        index_links: set[str] = set()
        for match in WIKILINK_RE.finditer(read_text(index_path)):
            resolved = resolve_content_target(match.group(1), exact_pages, fuzzy_pages, args.wiki_folder)
            if resolved is None:
                add_issue(issues, "info", "index-drift", index_path.relative_to(root).as_posix(), f"Index entry does not resolve: {match.group(1).strip()}")
            else:
                index_links.add(resolved)
        for missing in sorted(expected - index_links):
            add_issue(issues, "info", "index-drift", index_path.relative_to(root).as_posix(), f"Missing index entry: {missing}")
    elif expected:
        add_issue(issues, "info", "missing-index", f"{args.wiki_folder}/index.md", "Wiki has content pages but no index")

    issues.sort(key=lambda issue: (SEVERITY_ORDER[issue["severity"]], issue["category"], issue["path"], issue["detail"]))
    counts = {severity: sum(1 for issue in issues if issue["severity"] == severity) for severity in SEVERITY_ORDER}
    categories: dict[str, int] = defaultdict(int)
    for issue in issues:
        categories[issue["category"]] += 1
    json_dump({"summary": {"pages": len(pages), **counts, "categories": dict(sorted(categories.items()))}, "graph": graph_stats(graph), "issues": issues})


def shorten(text: str, limit: int = INDEX_SUMMARY_LIMIT) -> str:
    text = normalize_ws(text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def render_index(pages: list[Page], wiki_folder: str) -> str:
    labels = (("实体", "entity"), ("概念", "concept"), ("来源", "source"), ("分析", "analysis"))
    lines = ["# Wiki Index", "", "> 由 llm-wiki 根据当前页面确定性生成。查询时先读本文件定位候选页面，再打开页面本身。", "", "> 页面名后的 `aliases` 表示别名、缩写或常用译名。", ""]
    for heading, page_type in labels:
        lines.extend([f"## {heading}", ""])
        selected = sorted((page for page in pages if page.page_type == page_type), key=lambda page: (normalize_text(page.title), page.rel_no_ext))
        if not selected:
            lines.extend(["- （暂无）", ""])
            continue
        for page in selected:
            aliases = f" `aliases: {', '.join(page.aliases)}`" if page.aliases else ""
            summary = f" — {shorten(page.summary)}" if page.summary else ""
            lines.append(f"- [[{page.rel_no_ext}|{page.title}]]{aliases}{summary}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def cmd_index(args: argparse.Namespace) -> None:
    root = safe_root(args.vault)
    unreadable: list[dict[str, str]] = []
    pages = load_pages(root, args.wiki_folder, unreadable)
    content = render_index(pages, args.wiki_folder)
    path = root / args.wiki_folder / "index.md"
    changed = not path.exists() or read_text(path) != content
    if args.write and changed:
        atomic_write(path, content)
    json_dump({"write": args.write, "path": path.relative_to(root).as_posix(), "changed": changed, "pageCount": len(pages), "unreadablePages": unreadable, "content": content if not args.write else None})


def cmd_log(args: argparse.Namespace) -> None:
    """Append one fixed-format entry to the wiki log."""
    root = safe_root(args.vault)
    title = normalize_ws(args.title)
    if not title:
        raise ValueError("log title must not be empty")
    path = root / args.wiki_folder / "log.md"
    heading = f"## [{date.today().isoformat()}] {args.operation} | {title}"
    lines = [normalize_ws(line) for line in (args.line or []) if normalize_ws(line)]
    existing = read_text(path) if path.exists() else ""
    if not existing.strip():
        existing = "# Wiki Log\n\n> 按时间追加的操作记录。条目标题格式：`## [YYYY-MM-DD] <operation> | <title>`。\n"
    entry = heading + "\n"
    if lines:
        entry += "\n" + "\n".join(f"- {line}" for line in lines) + "\n"
    atomic_write(path, existing.rstrip("\n") + "\n\n" + entry)
    json_dump({"path": path.relative_to(root).as_posix(), "heading": heading, "lines": len(lines)})


def common(subparser: argparse.ArgumentParser) -> None:
    subparser.add_argument("--vault", default=".", help="Vault root (default: current directory)")
    subparser.add_argument("--wiki-folder", default="wiki", help="Managed wiki folder relative to vault")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Deterministic local operations for the llm-wiki skill")
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Preview or create managed folders and default schema")
    common(init_parser)
    init_parser.add_argument("--write", action="store_true")
    init_parser.set_defaults(func=cmd_init)

    preflight = subparsers.add_parser("preflight", help="Validate source notes and detect duplicates")
    common(preflight)
    preflight.add_argument("--source", action="append", required=True)
    preflight.add_argument("--preserve-case", action="store_true")
    preflight.set_defaults(func=cmd_preflight)

    discover = subparsers.add_parser("discover", help="Expand note folders and report ingestion coverage")
    common(discover)
    discover.add_argument("--path", action="append", help="File or folder to inspect (default: vault root)")
    discover.add_argument("--exclude", action="append", help="Vault-relative glob to exclude")
    discover.add_argument("--preserve-case", action="store_true")
    discover.set_defaults(func=cmd_discover)

    inventory = subparsers.add_parser("inventory", help="Emit managed page inventory as JSON")
    common(inventory)
    inventory.set_defaults(func=cmd_inventory)

    retrieve = subparsers.add_parser("retrieve", help="Rank wiki pages with lexical matching and wikilink PPR")
    common(retrieve)
    retrieve.add_argument("--query", required=True)
    retrieve.add_argument("--keyword", action="append")
    retrieve.add_argument("--top", type=int, default=10)
    retrieve.set_defaults(func=cmd_retrieve)

    lint = subparsers.add_parser("lint", help="Run deterministic read-only wiki integrity scans")
    common(lint)
    lint.set_defaults(func=cmd_lint)

    index = subparsers.add_parser("index", help="Preview or write the deterministic wiki index")
    common(index)
    index.add_argument("--write", action="store_true")
    index.set_defaults(func=cmd_index)

    log = subparsers.add_parser("log", help="Append one `## [date] <operation> | <title>` entry to the wiki log")
    common(log)
    log.add_argument("--operation", required=True, choices=LOG_OPERATIONS)
    log.add_argument("--title", required=True)
    log.add_argument("--line", action="append", help="One bullet of detail; repeatable")
    log.set_defaults(func=cmd_log)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
        return 0
    except (OSError, UnicodeError, ValueError) as exc:
        json_dump({"error": str(exc), "command": args.command})
        return 2


if __name__ == "__main__":
    sys.exit(main())
