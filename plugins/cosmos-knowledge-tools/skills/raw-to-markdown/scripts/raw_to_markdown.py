#!/usr/bin/env python3
"""Safely convert explicitly selected raw/ files into same-directory Markdown."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import math
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import sys
import tempfile
from typing import Iterable


SCHEMA = "raw-to-markdown/v2"
ENGINE_DISTRIBUTION = "markitdown"
NO_POSTPROCESSOR = "none"
PDF_PROSE_POSTPROCESSOR = "pdf-prose-v1"
SUPPORTED_EXTENSIONS = frozenset(
    {
        ".csv",
        ".docx",
        ".epub",
        ".htm",
        ".html",
        ".json",
        ".msg",
        ".pdf",
        ".pptx",
        ".tsv",
        ".txt",
        ".xls",
        ".xlsx",
        ".xml",
        ".zip",
    }
)
PROVENANCE_KEYS = (
    "conversion_schema",
    "converted_from",
    "converted_from_path",
    "converted_from_format",
    "converted_from_sha256",
    "conversion_body_sha256",
    "conversion_engine",
    "conversion_engine_version",
    "conversion_postprocessor",
    "converted_at",
    "conversion_metadata_sha256",
)
SIGNED_PROVENANCE_KEYS = PROVENANCE_KEYS[:-1]
FRONTMATTER_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
SHA256_RE = re.compile(r"\A[0-9a-f]{64}\Z")
MARKDOWN_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
MARKDOWN_TABLE_SEPARATOR_RE = re.compile(
    r"^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$"
)
CONVERTER_LOCK_RE = re.compile(r"^\..+\.md\.raw-to-markdown\.lock$")
CONVERTER_TEMP_RE = re.compile(
    r"^\..+\.md\.raw-to-markdown-[A-Za-z0-9_-]+\.tmp$"
)
PDF_PAGE_NUMBER_RE = re.compile(r"^\d{1,4}$")
PDF_NOISE_RE = re.compile(r"^(?:书){2,}$")
PDF_HEADING_LEVEL_TWO_RE = re.compile(r"^[一二三四五六七八九十百]{1,5}、")
PDF_HEADING_LEVEL_THREE_RE = re.compile(
    r"^[（(][一二三四五六七八九十百0-9]{1,5}[）)](?![:：])"
)
PDF_REFERENCE_RE = re.compile(r"^[［\[]\d+[］\]]")
PDF_BLOCK_START_RE = re.compile(
    r"^(?:摘\s*要|关键词|中图分类号|收稿日期|基金项目|作者简介|DOI|Abstract|Key\s+words)\s*[:：]",
    re.IGNORECASE,
)
PDF_STANDALONE_METADATA_RE = re.compile(
    r"^(?:DOI|中图分类号|收稿日期)\s*[:：]", re.IGNORECASE
)
PDF_FOOTNOTE_RE = re.compile(r"^[①②③④⑤⑥⑦⑧⑨⑩]")
PDF_LATIN_AUTHOR_RE = re.compile(
    r"^[A-Z]{2,}\s+[A-Z][A-Za-z'’\-]+(?:\d+(?:，\d+)*)?$"
)
PDF_AFFILIATION_RE = re.compile(r"^\([1-9][．.]\s*(?!\d)")
PDF_EDITOR_RE = re.compile(r"^[（(]责任编辑")
PDF_EXPLICIT_FOOTER_RE = re.compile(
    r"(?:版权所有|请勿转载|保密|内部资料|copyright|all rights reserved|confidential|©)",
    re.IGNORECASE,
)
CJK_CHARACTER_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


class ConversionError(RuntimeError):
    """Raised for safe, user-actionable conversion failures."""


@dataclass(frozen=True)
class PlanItem:
    source: str
    output: str | None
    action: str
    reason: str


class OutputLock:
    """Cooperative same-directory lock for one Markdown sidecar."""

    def __init__(self, output: Path) -> None:
        self.path = output.parent / f".{output.name}.raw-to-markdown.lock"
        self.fd: int | None = None
        self.device: int | None = None
        self.inode: int | None = None

    def __enter__(self) -> "OutputLock":
        try:
            self.fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as exc:
            raise ConversionError(f"Output lock already exists: {self.path.name}") from exc
        try:
            identity = os.fstat(self.fd)
            self.device = identity.st_dev
            self.inode = identity.st_ino
            payload = json.dumps(
                {
                    "pid": os.getpid(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                },
                sort_keys=True,
            ).encode("utf-8")
            remaining = memoryview(payload)
            while remaining:
                written = os.write(self.fd, remaining)
                if written <= 0:
                    raise OSError("Could not write output lock metadata")
                remaining = remaining[written:]
            os.fsync(self.fd)
        except BaseException:
            self._release()
            raise
        return self

    def _release(self) -> None:
        fd = self.fd
        device = self.device
        inode = self.inode
        self.fd = None
        try:
            if fd is not None and device is not None and inode is not None:
                current = os.stat(self.path, follow_symlinks=False)
                if current.st_dev == device and current.st_ino == inode:
                    self.path.unlink()
        except FileNotFoundError:
            pass
        finally:
            if fd is not None:
                os.close(fd)
            self.device = None
            self.inode = None

    def __exit__(self, exc_type, exc, traceback) -> None:
        self._release()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_markdown(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n").strip()


def has_pathological_pdf_tables(value: str) -> bool:
    """Detect prose-heavy pages that MarkItDown misclassified as Markdown tables."""

    lines = [line for line in normalize_markdown(value).splitlines() if line.strip()]
    if not lines:
        return False
    table_rows = [line for line in lines if MARKDOWN_TABLE_ROW_RE.fullmatch(line)]
    separators = [
        line for line in table_rows if MARKDOWN_TABLE_SEPARATOR_RE.fullmatch(line)
    ]
    prose_rows = [
        line
        for line in table_rows
        if len(re.sub(r"[|\s:\-]", "", line)) >= 45
    ]
    fragmented_prose_rows = []
    sparse_prose_rows = []
    for line in prose_rows:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        empty_cells = sum(not cell for cell in cells)
        if len(cells) >= 3 and empty_cells >= max(2, math.ceil(len(cells) / 2)):
            fragmented_prose_rows.append(line)
        if len(cells) >= 3 and sum(bool(cell) for cell in cells) == 1:
            sparse_prose_rows.append(line)
    large_document_pattern = (
        len(table_rows) >= 20
        and len(separators) >= 4
        and len(table_rows) / len(lines) >= 0.18
        and len(fragmented_prose_rows) >= 8
    )
    short_sparse_pattern = (
        len(table_rows) >= 6
        and len(separators) >= 2
        and len(table_rows) / len(lines) >= 0.5
        and len(sparse_prose_rows) >= 3
    )
    return large_document_pattern or short_sparse_pattern


def normalize_pdf_margin_key(line: str) -> str:
    compact = re.sub(r"\s+", "", line.strip())
    return re.sub(r"\d+", "#", compact)


def is_plausible_pdf_footer(line: str) -> bool:
    """Keep footer removal conservative so recurring citations are preserved."""

    key = normalize_pdf_margin_key(line)
    return (
        4 <= len(key) <= 40
        and PDF_EXPLICIT_FOOTER_RE.search(line) is not None
        and not re.search(r"(?:https?|www|doi|/)", line, re.IGNORECASE)
        and not line.rstrip().endswith(("。", "．", ".", "！", "？", "!", "?", "；", ";"))
    )


def remove_pdf_page_numbers_at_margins(lines: list[str]) -> list[str]:
    """Remove pure-number labels only within two meaningful page-edge lines."""

    meaningful_indexes = [
        index
        for index, line in enumerate(lines)
        if line.strip() and not PDF_NOISE_RE.fullmatch(line.strip())
    ]
    if not meaningful_indexes:
        return lines
    if len(meaningful_indexes) <= 4:
        return lines
    margin_indexes = set(meaningful_indexes[:2] + meaningful_indexes[-2:])
    return [
        line
        for index, line in enumerate(lines)
        if not (
            index in margin_indexes and PDF_PAGE_NUMBER_RE.fullmatch(line.strip())
        )
    ]


def repeated_pdf_margin_keys(pages: list[list[str]]) -> set[str]:
    """Find recurring first/last lines without removing one-off title content."""

    if len(pages) < 2:
        return set()
    occurrences: Counter[str] = Counter()
    for lines in pages:
        nonempty = [line.strip() for line in lines if line.strip()]
        footer_lines = [line for line in nonempty[-2:] if is_plausible_pdf_footer(line)]
        margin_lines = nonempty[:2] + footer_lines
        keys = {
            normalize_pdf_margin_key(line)
            for line in margin_lines
            if len(normalize_pdf_margin_key(line)) >= 4
        }
        occurrences.update(keys)
    threshold = max(2, math.ceil(len(pages) * 0.3))
    return {key for key, count in occurrences.items() if count >= threshold}


def clean_pdf_inline_text(line: str) -> str:
    line = re.sub(r"[\t\u00a0]+", " ", line.strip())
    line = re.sub(r" {2,}", " ", line)
    line = re.sub(
        r"(?<=[\u3400-\u4dbf\u4e00-\u9fff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff])",
        "",
        line,
    )
    line = re.sub(
        r"(?<=[\u3400-\u4dbf\u4e00-\u9fff])\s+(?=\d)", "", line
    )
    line = re.sub(
        r"(?<=\d)\s+(?=[\u3400-\u4dbf\u4e00-\u9fff])", "", line
    )
    line = re.sub(r"(?<=\d)\s+(?=[年月日个亿万%％])", "", line)
    line = re.sub(r"(?<=[年月日个亿万])\s+(?=\d)", "", line)
    line = re.sub(r"(?<=\d)\s+(?=\()", "", line)
    line = re.sub(r"\s+([，。；：！？、）》】］])", r"\1", line)
    line = re.sub(r"([（(《【\[［“])\s+", r"\1", line)
    return line.strip()


def compact_pdf_comparison_text(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff]", "", value)


def join_pdf_wrapped_lines(left: str, right: str) -> str:
    if not left:
        return right
    if left.endswith(("-", "‐", "‑")) and right[:1].isalpha():
        return left[:-1] + right
    if right[:1] in "，。；：！？、）》】］,.;:!?)]}" or left[-1:] in "（《【［“([{":
        return left + right
    if left[-1:].isdigit() and right.startswith("("):
        return left + right
    if CJK_CHARACTER_RE.fullmatch(left[-1:]) or CJK_CHARACTER_RE.fullmatch(right[:1]):
        return left + right
    if left[-1:].isdigit() and CJK_CHARACTER_RE.fullmatch(right[:1]):
        return left + right
    return left + " " + right


def clean_pdf_pages(page_texts: list[str], title_hint: str) -> str:
    """Turn text-oriented PDF pages into readable Markdown prose."""

    pages = [
        remove_pdf_page_numbers_at_margins(
            text.replace("\r\n", "\n").replace("\r", "\n").splitlines()
        )
        for text in page_texts
    ]
    repeated_margins = repeated_pdf_margin_keys(pages)
    main_pages: list[list[str]] = []
    note_pages: list[list[str]] = []
    for lines in pages:
        split_at: int | None = None
        for index, line in enumerate(lines):
            if index >= len(lines) * 0.55 and PDF_FOOTNOTE_RE.match(line.strip()):
                split_at = index
                break
        if split_at is None:
            main_pages.append(lines)
        else:
            main_pages.append(lines[:split_at])
            note_pages.append(lines[split_at:])

    compact_title = compact_pdf_comparison_text(title_hint)
    blocks: list[str] = []
    buffer = ""

    def flush() -> None:
        nonlocal buffer
        if buffer:
            blocks.append(buffer)
            buffer = ""

    for page_lines in main_pages:
        for raw_line in page_lines:
            line = clean_pdf_inline_text(raw_line)
            if not line:
                flush()
                continue
            if PDF_NOISE_RE.fullmatch(line):
                continue
            if normalize_pdf_margin_key(line) in repeated_margins:
                continue

            compact_line = compact_pdf_comparison_text(line)
            if (
                len(compact_title) >= 6
                and compact_title == compact_line
                and len(line) <= len(title_hint) + 12
            ):
                flush()
                blocks.append(f"# {line}")
                continue
            if PDF_HEADING_LEVEL_TWO_RE.match(line):
                flush()
                blocks.append(f"## {line}")
                continue
            if PDF_HEADING_LEVEL_THREE_RE.match(line):
                flush()
                blocks.append(f"### {line}")
                continue
            if re.fullmatch(r"参考文献\s*[:：]?", line):
                flush()
                blocks.append("## 参考文献")
                continue
            if PDF_STANDALONE_METADATA_RE.match(line):
                flush()
                blocks.append(line)
                continue

            starts_block = bool(
                PDF_BLOCK_START_RE.match(line)
                or PDF_REFERENCE_RE.match(line)
                or PDF_FOOTNOTE_RE.match(line)
                or PDF_LATIN_AUTHOR_RE.fullmatch(line)
                or PDF_AFFILIATION_RE.match(line)
                or PDF_EDITOR_RE.match(line)
            )
            if starts_block:
                flush()
            buffer = join_pdf_wrapped_lines(buffer, line)

            if (
                line.endswith(("。", "！", "？"))
                or (
                    line.endswith("．")
                    and not line.endswith(("［J］．", "[J]."))
                )
                or PDF_LATIN_AUTHOR_RE.fullmatch(line)
                or (
                    (PDF_AFFILIATION_RE.match(line) or PDF_EDITOR_RE.match(line))
                    and line.endswith(")")
                )
            ):
                flush()
    flush()

    notes: list[str] = []
    note_buffer = ""
    for page_lines in note_pages:
        for raw_line in page_lines:
            line = clean_pdf_inline_text(raw_line)
            if not line:
                continue
            if PDF_NOISE_RE.fullmatch(line):
                continue
            if normalize_pdf_margin_key(line) in repeated_margins:
                continue
            if PDF_FOOTNOTE_RE.match(line) and note_buffer:
                notes.append(note_buffer)
                note_buffer = ""
            note_buffer = join_pdf_wrapped_lines(note_buffer, line)
        if note_buffer:
            notes.append(note_buffer)
            note_buffer = ""

    if notes:
        try:
            reference_index = blocks.index("## 参考文献")
        except ValueError:
            reference_index = len(blocks)
        blocks[reference_index:reference_index] = ["## 注释", *notes]

    return "\n\n".join(block for block in blocks if block.strip())


def extract_pdf_prose(source: Path) -> str:
    try:
        import pdfplumber
    except ImportError as exc:
        raise ConversionError(
            "pdfplumber is unavailable for PDF prose post-processing"
        ) from exc

    page_texts: list[str] = []
    try:
        with pdfplumber.open(source) as pdf:
            for page in pdf.pages:
                page_texts.append(page.extract_text(x_tolerance=3, y_tolerance=3) or "")
    except Exception as exc:
        raise ConversionError(f"PDF prose extraction failed: {exc}") from exc

    title_hint = source.stem.split("_", 1)[0]
    return clean_pdf_pages(page_texts, title_hint)


def postprocess_conversion(source: Path, converted: str) -> tuple[str, str]:
    if source.suffix.lower() != ".pdf":
        return converted, NO_POSTPROCESSOR
    if converted.strip() and not has_pathological_pdf_tables(converted):
        return converted, NO_POSTPROCESSOR
    cleaned = extract_pdf_prose(source)
    if not cleaned.strip():
        return converted, NO_POSTPROCESSOR
    return cleaned, PDF_PROSE_POSTPROCESSOR


def parse_frontmatter(content: str) -> tuple[dict[str, str], str, bool]:
    match = FRONTMATTER_RE.match(content)
    if not match:
        return {}, content, False

    metadata: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line or ":" not in line:
            return metadata, content[match.end() :], False
        key, raw_value = line.split(":", 1)
        key = key.strip()
        if not key or key in metadata:
            return metadata, content[match.end() :], False
        raw_value = raw_value.strip()
        try:
            value = json.loads(raw_value)
        except json.JSONDecodeError:
            return metadata, content[match.end() :], False
        if not isinstance(value, str):
            return metadata, content[match.end() :], False
        metadata[key] = str(value)
    body = content[match.end() :]
    canonical = (
        tuple(metadata) == PROVENANCE_KEYS
        and render_frontmatter(metadata) + body == content
    )
    return metadata, body, canonical


def split_frontmatter(content: str) -> tuple[dict[str, str], str]:
    metadata, body, _ = parse_frontmatter(content)
    return metadata, body


def render_frontmatter(metadata: dict[str, str]) -> str:
    lines = ["---"]
    for key in PROVENANCE_KEYS:
        lines.append(f"{key}: {json.dumps(metadata[key], ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def metadata_sha256(metadata: dict[str, str]) -> str:
    payload = "\n".join(
        f"{key}={json.dumps(metadata[key], ensure_ascii=False)}"
        for key in SIGNED_PROVENANCE_KEYS
    ).encode("utf-8")
    return sha256_bytes(payload)


def ensure_under_raw(path: Path, vault: Path) -> tuple[Path, str]:
    vault = vault.resolve()
    raw_entry = vault / "raw"
    raw_root = raw_entry.resolve(strict=True)
    try:
        raw_root.relative_to(vault)
    except ValueError as exc:
        raise ConversionError("Vault raw/ resolves outside the vault") from exc
    if raw_root != raw_entry:
        raise ConversionError("Vault raw/ must be a real directory, not a symbolic link")
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(raw_root)
        source_rel = resolved.relative_to(vault).as_posix()
    except ValueError as exc:
        raise ConversionError(f"Path is outside raw/: {path}") from exc
    return resolved, source_rel


def expand_sources(
    requested: Iterable[str], vault: Path, recursive: bool
) -> tuple[list[tuple[Path, str]], list[PlanItem]]:
    candidates: list[Path] = []
    issues: list[PlanItem] = []
    for raw_value in requested:
        candidate = Path(raw_value)
        if not candidate.is_absolute():
            candidate = vault / candidate
        if not candidate.exists():
            issues.append(PlanItem(raw_value, None, "invalid", "Path does not exist"))
            continue
        if candidate.is_dir():
            try:
                candidate, _ = ensure_under_raw(candidate, vault)
            except (ConversionError, OSError) as exc:
                issues.append(PlanItem(raw_value, None, "invalid", str(exc)))
                continue
            if not recursive:
                issues.append(
                    PlanItem(raw_value, None, "invalid", "Directory requires --recursive")
                )
                continue
            candidates.extend(path for path in candidate.rglob("*") if path.is_file())
        else:
            candidates.append(candidate)

    resolved: dict[str, tuple[Path, str]] = {}
    for candidate in candidates:
        try:
            source, source_rel = ensure_under_raw(candidate, vault)
        except (ConversionError, OSError) as exc:
            issues.append(PlanItem(str(candidate), None, "invalid", str(exc)))
            continue
        resolved[source_rel] = (source, source_rel)
    if not resolved and not issues:
        issues.append(PlanItem("<selection>", None, "invalid", "No files found"))
    return [resolved[key] for key in sorted(resolved)], issues


def classify_source(source: Path, source_rel: str) -> PlanItem:
    extension = source.suffix.lower()
    output = source.with_suffix(".md")
    output_rel = Path(source_rel).with_suffix(".md").as_posix()

    if (
        source.name.startswith(("~$", "._"))
        or source.name == ".DS_Store"
        or CONVERTER_LOCK_RE.fullmatch(source.name)
        or CONVERTER_TEMP_RE.fullmatch(source.name)
    ):
        return PlanItem(source_rel, None, "skipped", "Temporary or metadata file")
    if extension == ".md":
        return PlanItem(source_rel, None, "skipped", "Source is already Markdown")
    if extension not in SUPPORTED_EXTENSIONS:
        return PlanItem(
            source_rel,
            None,
            "unsupported",
            f"Unsupported extension: {extension or '<none>'}",
        )
    if output.is_symlink():
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Output path already exists as a symbolic link",
        )
    if not output.exists():
        return PlanItem(source_rel, output_rel, "create", "Sidecar does not exist")

    try:
        existing = output.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return PlanItem(source_rel, output_rel, "conflict", f"Cannot read existing Markdown: {exc}")

    metadata, body, canonical = parse_frontmatter(existing)
    if not canonical:
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Existing Markdown provenance is incomplete or non-canonical",
        )
    expected_link = f"[[{source_rel}]]"
    expected_values = {
        "conversion_schema": SCHEMA,
        "converted_from": expected_link,
        "converted_from_path": source_rel,
        "converted_from_format": extension.lstrip("."),
        "conversion_engine": ENGINE_DISTRIBUTION,
        "conversion_engine_version": pinned_engine_version(),
    }
    if any(metadata.get(key) != value for key, value in expected_values.items()):
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Existing Markdown provenance does not match this source",
        )
    if not SHA256_RE.fullmatch(metadata.get("converted_from_sha256", "")):
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Source SHA-256 provenance is invalid",
        )
    if not SHA256_RE.fullmatch(metadata.get("conversion_body_sha256", "")):
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Body SHA-256 provenance is invalid",
        )
    if metadata.get("conversion_metadata_sha256") != metadata_sha256(metadata):
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Provenance metadata was edited",
        )
    postprocessor = metadata.get("conversion_postprocessor")
    if postprocessor not in {NO_POSTPROCESSOR, PDF_PROSE_POSTPROCESSOR}:
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Conversion postprocessor is invalid",
        )
    if extension != ".pdf" and postprocessor != NO_POSTPROCESSOR:
        return PlanItem(
            source_rel,
            output_rel,
            "conflict",
            "Non-PDF sidecar has a PDF postprocessor",
        )
    try:
        if not metadata["converted_at"].endswith("Z"):
            raise ValueError("timestamp must be UTC")
        datetime.fromisoformat(metadata["converted_at"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return PlanItem(source_rel, output_rel, "conflict", "Conversion timestamp is invalid")

    recorded_body_hash = metadata.get("conversion_body_sha256", "")
    actual_body_hash = sha256_bytes(body.encode("utf-8"))
    if not recorded_body_hash or recorded_body_hash != actual_body_hash:
        return PlanItem(
            source_rel,
            output_rel,
            "edited-conflict",
            "Generated Markdown body was edited",
        )

    current_source_hash = sha256_file(source)
    if metadata.get("converted_from_sha256") == current_source_hash:
        return PlanItem(source_rel, output_rel, "no-op", "Source and sidecar hashes match")
    return PlanItem(
        source_rel,
        output_rel,
        "stale-conflict",
        "Source changed after conversion; existing Markdown is preserved",
    )


def classify_sources(sources: list[tuple[Path, str]]) -> list[PlanItem]:
    items: list[PlanItem] = []
    for source, source_rel in sources:
        try:
            items.append(classify_source(source, source_rel))
        except OSError as exc:
            # An unreadable source (permissions, I/O error) is a per-item
            # failure, not a crash of the whole plan.
            items.append(PlanItem(source_rel, None, "failed", f"Cannot read source: {exc}"))
        except ConversionError as exc:
            # e.g. a missing or unpinned bundled requirements.txt while
            # verifying provenance; keep the plan structured.
            items.append(PlanItem(source_rel, None, "failed", str(exc)))
    output_owners: dict[str, list[str]] = {}
    for item in items:
        if item.output is None or item.action in {"skipped", "unsupported"}:
            continue
        output_owners.setdefault(item.output, []).append(item.source)

    collisions = {
        output: owners for output, owners in output_owners.items() if len(owners) > 1
    }
    if not collisions:
        return items

    revised: list[PlanItem] = []
    for item in items:
        owners = collisions.get(item.output or "")
        if owners:
            revised.append(
                PlanItem(
                    item.source,
                    item.output,
                    "conflict",
                    f"Multiple sources map to the same sidecar: {', '.join(owners)}",
                )
            )
        else:
            revised.append(item)
    return revised


def build_plan(requested: Iterable[str], vault: Path, recursive: bool) -> list[PlanItem]:
    sources, issues = expand_sources(requested, vault, recursive)
    return issues + classify_sources(sources)


def load_engine():
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise ConversionError(
            "MarkItDown is unavailable. Install requirements.txt with "
            "micromamba run -n cosmos uv pip."
        ) from exc
    return MarkItDown(enable_builtins=True, enable_plugins=False)


def pinned_engine_version() -> str:
    # The bundled requirements.txt is the single source of the pinned engine
    # version; duplicating the number here made a one-sided bump a hard failure.
    requirements = Path(__file__).resolve().parent.parent / "requirements.txt"
    try:
        lines = requirements.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ConversionError(f"Cannot read {requirements.name}: {exc}") from exc
    for line in lines:
        match = re.match(
            rf"{ENGINE_DISTRIBUTION}(?:\[[^\]]*\])?==([A-Za-z0-9.]+)\s*$", line.strip()
        )
        if match:
            return match.group(1)
    raise ConversionError(f"{requirements.name} does not pin {ENGINE_DISTRIBUTION}")


def engine_version() -> str:
    try:
        version = importlib.metadata.version(ENGINE_DISTRIBUTION)
    except importlib.metadata.PackageNotFoundError as exc:
        raise ConversionError("Cannot determine MarkItDown version") from exc
    pinned = pinned_engine_version()
    if version != pinned:
        raise ConversionError(
            f"MarkItDown version {version} does not match pinned {pinned}"
        )
    return version


def build_document(
    source: Path,
    source_rel: str,
    converted: str,
    version: str,
    postprocessor: str,
) -> str:
    converted = normalize_markdown(converted)
    if not converted:
        raise ConversionError(
            f"Converter produced empty Markdown for {source_rel}; "
            "scanned/image-only content may require OCR"
        )

    source_link = f"[[{source_rel}]]"
    body = (
        "> [!source] 转换来源\n"
        f"> 原始文件：{source_link}\n"
        "> 本页由 `raw-to-markdown` 自动转换；原文件是权威来源。\n\n"
        f"{converted}\n"
    )
    metadata = {
        "conversion_schema": SCHEMA,
        "converted_from": source_link,
        "converted_from_path": source_rel,
        "converted_from_format": source.suffix.lower().lstrip("."),
        "converted_from_sha256": sha256_file(source),
        "conversion_body_sha256": sha256_bytes(body.encode("utf-8")),
        "conversion_engine": ENGINE_DISTRIBUTION,
        "conversion_engine_version": version,
        "conversion_postprocessor": postprocessor,
        "converted_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
    }
    metadata["conversion_metadata_sha256"] = metadata_sha256(metadata)
    return render_frontmatter(metadata) + body


def create_output(path: Path, content: bytes) -> None:
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.raw-to-markdown-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_name = handle.name
        try:
            os.link(temp_name, path)
        except FileExistsError as exc:
            raise ConversionError(
                "Output appeared after planning; refusing to overwrite it"
            ) from exc
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def run_convert(
    requested: Iterable[str], vault: Path, recursive: bool
) -> tuple[list[dict[str, str | None]], int]:
    sources, issues = expand_sources(requested, vault, recursive)
    plan = issues + classify_sources(sources)
    blockers = [
        item
        for item in plan
        if item.action
        in {"invalid", "unsupported", "conflict", "edited-conflict", "stale-conflict", "failed"}
    ]
    if blockers:
        return [asdict(item) for item in plan], 2

    needs_engine = any(item.action not in {"no-op", "skipped"} for item in plan)
    engine = load_engine() if needs_engine else None
    version = engine_version() if needs_engine else pinned_engine_version()
    results: list[dict[str, str | None]] = []
    source_map = {source_rel: source for source, source_rel in sources}
    for item in plan:
        if item.action == "skipped":
            results.append(asdict(item))
            continue
        source = source_map[item.source]
        if item.action == "no-op":
            live = classify_source(source, item.source)
            if live.action == "no-op":
                results.append(asdict(live))
            else:
                results.append(
                    {
                        "source": item.source,
                        "output": item.output,
                        "action": "failed",
                        "reason": f"Source or output changed after planning: {live.reason}",
                    }
                )
            continue
        original_hash = sha256_file(source)
        output = source.with_suffix(".md")
        try:
            with OutputLock(output):
                live = classify_source(source, item.source)
                if live.action != item.action:
                    raise ConversionError(f"State changed after planning: {live.reason}")
                with tempfile.TemporaryDirectory(prefix="raw-to-markdown-") as temp_dir:
                    safe_source = Path(temp_dir) / source.name
                    shutil.copyfile(source, safe_source)
                    if engine is None:
                        raise ConversionError("Converter engine was not initialized")
                    converted = engine.convert_local(safe_source).text_content
                    converted, postprocessor = postprocess_conversion(
                        safe_source, converted
                    )
                document = build_document(
                    source,
                    item.source,
                    converted,
                    version,
                    postprocessor,
                )
                if sha256_file(source) != original_hash:
                    raise ConversionError("Original source changed during conversion")
                live = classify_source(source, item.source)
                if live.action != item.action:
                    raise ConversionError(f"Output changed during conversion: {live.reason}")
                written = document.encode("utf-8")
                create_output(output, written)
                verified = classify_source(source, item.source)
                if verified.action != "no-op":
                    raise ConversionError(
                        "Post-write verification failed: "
                        f"{verified.reason}; the output was preserved because this Skill never "
                        "deletes or overwrites existing Markdown"
                    )
            results.append(
                {
                    "source": item.source,
                    "output": item.output,
                    "action": "created",
                    "reason": "Conversion and verification succeeded",
                }
            )
        except Exception as exc:  # converters expose several format-specific exceptions
            results.append(
                {
                    "source": item.source,
                    "output": item.output,
                    "action": "failed",
                    "reason": str(exc),
                }
            )
    exit_code = 0 if all(item["action"] != "failed" for item in results) else 1
    return results, exit_code


def json_report(command: str, items: list[dict[str, str | None]], exit_code: int) -> None:
    print(
        json.dumps(
            {"command": command, "ok": exit_code == 0, "items": items},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument(
            "sources",
            nargs="+",
            help="Files or explicitly requested folders under raw/",
        )
        subparser.add_argument(
            "--vault", default=".", help="Vault root; defaults to current directory"
        )
        subparser.add_argument(
            "--recursive",
            action="store_true",
            help="Allow explicitly requested folders",
        )

    plan = subparsers.add_parser("plan", help="Preview sidecar actions without writing")
    add_common(plan)

    convert = subparsers.add_parser("convert", help="Convert sources after explicit authorization")
    add_common(convert)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    vault = Path(args.vault).resolve()
    if not (vault / "raw").is_dir():
        json_report(
            args.command,
            [asdict(PlanItem(str(vault / "raw"), None, "invalid", "Vault has no raw/ directory"))],
            2,
        )
        return 2

    if args.command == "plan":
        items = [asdict(item) for item in build_plan(args.sources, vault, args.recursive)]
        unsafe = {
            "invalid",
            "unsupported",
            "conflict",
            "edited-conflict",
            "stale-conflict",
            "failed",
        }
        exit_code = 2 if any(item["action"] in unsafe for item in items) else 0
        json_report("plan", items, exit_code)
        return exit_code

    try:
        results, exit_code = run_convert(args.sources, vault, args.recursive)
    except Exception as exc:
        results = [
            asdict(
                PlanItem(
                    "<runtime>",
                    None,
                    "failed",
                    f"{type(exc).__name__}: {exc}",
                )
            )
        ]
        exit_code = 1
    json_report("convert", results, exit_code)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
