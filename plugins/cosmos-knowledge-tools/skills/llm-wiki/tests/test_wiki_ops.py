from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "wiki_ops.py"
SPEC = importlib.util.spec_from_file_location("wiki_ops", MODULE_PATH)
assert SPEC and SPEC.loader
wiki_ops = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = wiki_ops
SPEC.loader.exec_module(wiki_ops)


def write_page(root: Path, rel: str, title: str, summary: str, extra_frontmatter: str = "", links: str = "") -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "---\n"
        f"type: {'source' if '/sources/' in rel else 'concept'}\n"
        f"title: {title}\n"
        "aliases:\n"
        f"  - {title} alias\n"
        "tags:\n"
        f"  - {'notes' if '/sources/' in rel else 'term'}\n"
        "created: 2026-07-15\n"
        "updated: 2026-07-15\n"
        "generation_complete: true\n"
        f"{extra_frontmatter}"
        "---\n\n"
        f"# {title}\n\n"
        "## 定义\n\n"
        f"{summary}\n\n{links}\n",
        encoding="utf-8",
    )


def capture_json(func, args: argparse.Namespace) -> dict:
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        func(args)
    return json.loads(output.getvalue())


class SourceResolutionTests(unittest.TestCase):
    def test_extract_link_target_accepts_plain_path_and_wikilink(self) -> None:
        self.assertEqual(wiki_ops.extract_link_target("notes/a.md"), "notes/a.md")
        self.assertEqual(wiki_ops.extract_link_target("[[wiki/sources/a|A]]"), "wiki/sources/a")
        self.assertIsNone(wiki_ops.extract_link_target("  "))

    def test_resolve_source_original_accepts_plain_source_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            original = root / "notes" / "a.md"
            original.parent.mkdir(parents=True)
            original.write_text("source body", encoding="utf-8")
            page = wiki_ops.Page(
                file_path=root / "wiki/sources/a.md",
                rel_file="wiki/sources/a.md",
                rel_no_ext="wiki/sources/a",
                page_type="source",
                title="A",
                aliases=[],
                summary="",
                frontmatter={"source_file": "notes/a.md"},
                body="",
                content="",
                links=[],
            )
            self.assertEqual(wiki_ops.resolve_source_original(root, page), original)


class DiscoveryTests(unittest.TestCase):
    def test_discover_reports_new_duplicate_and_explicit_exclusion(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            notes.mkdir(parents=True)
            (notes / "a.md").write_text("Same durable note.", encoding="utf-8")
            (notes / "b.md").write_text("Same durable note.", encoding="utf-8")
            (notes / "skip.md").write_text("Project control text.", encoding="utf-8")
            args = argparse.Namespace(
                vault=str(root),
                wiki_folder="wiki",
                path=["notes"],
                exclude=["notes/skip.md"],
                preserve_case=False,
            )
            result = capture_json(wiki_ops.cmd_discover, args)
            self.assertEqual(result["excludedCount"], 1)
            self.assertEqual(result["counts"], {"duplicate-in-scope": 1, "new": 1})

    def test_discover_reports_unchanged_then_changed_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / "notes" / "a.md"
            original.parent.mkdir(parents=True)
            original.write_text("A durable note.", encoding="utf-8")
            digest = wiki_ops.content_hash("A durable note.")
            write_page(
                root,
                "wiki/sources/a.md",
                "A source",
                "Source summary.",
                extra_frontmatter=f"source_file: notes/a.md\ncontentHash: {digest}\n",
            )
            args = argparse.Namespace(
                vault=str(root),
                wiki_folder="wiki",
                path=["notes"],
                exclude=None,
                preserve_case=False,
            )
            unchanged = capture_json(wiki_ops.cmd_discover, args)
            self.assertEqual(unchanged["counts"], {"unchanged": 1})

            original.write_text("A changed durable note.", encoding="utf-8")
            changed = capture_json(wiki_ops.cmd_discover, args)
            self.assertEqual(changed["counts"], {"changed": 1})

    def test_changed_source_copy_is_duplicate_regardless_of_sort_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            notes.mkdir(parents=True)
            old_body = "Old body."
            new_body = "Changed body shared by a copy."
            (notes / "z-original.md").write_text(new_body, encoding="utf-8")
            (notes / "a-copy.md").write_text(new_body, encoding="utf-8")
            write_page(
                root,
                "wiki/sources/original.md",
                "Original source",
                "Source summary.",
                extra_frontmatter=(
                    "source_file: notes/z-original.md\n"
                    f"contentHash: {wiki_ops.content_hash(old_body)}\n"
                ),
            )
            args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", path=["notes"], exclude=None, preserve_case=False
            )
            result = capture_json(wiki_ops.cmd_discover, args)
            by_path = {item["path"]: item for item in result["sources"]}
            self.assertEqual(by_path["notes/z-original.md"]["status"], "changed")
            self.assertEqual(by_path["notes/a-copy.md"]["status"], "duplicate-in-scope")
            self.assertEqual(by_path["notes/a-copy.md"]["duplicateOf"], "notes/z-original.md")


class LintTests(unittest.TestCase):
    def test_missing_generation_complete_is_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_page(root, "wiki/concepts/example.md", "Example", "Example summary.")
            path = root / "wiki/concepts/example.md"
            path.write_text(path.read_text(encoding="utf-8").replace("generation_complete: true\n", ""), encoding="utf-8")
            args = argparse.Namespace(vault=str(root), wiki_folder="wiki")
            result = capture_json(wiki_ops.cmd_lint, args)
            categories = [issue["category"] for issue in result["issues"]]
            self.assertIn("incomplete-generation", categories)

    def test_plain_source_file_resolves_but_is_flagged_as_nonconforming(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            original = root / "notes" / "a.md"
            original.parent.mkdir(parents=True)
            original.write_text("Original source.", encoding="utf-8")
            write_page(
                root,
                "wiki/sources/a.md",
                "A source",
                "Source summary.",
                extra_frontmatter=(
                    "source_file: notes/a.md\n"
                    f"contentHash: {wiki_ops.content_hash('Original source.')}\n"
                ),
            )
            args = argparse.Namespace(vault=str(root), wiki_folder="wiki")
            result = capture_json(wiki_ops.cmd_lint, args)
            categories = [issue["category"] for issue in result["issues"]]
            self.assertIn("invalid-source-file-format", categories)
            self.assertNotIn("missing-original-source", categories)

    def test_case_only_alias_is_reported_as_redundant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_page(root, "wiki/concepts/iim.md", "IIM", "Method summary.")
            path = root / "wiki/concepts/iim.md"
            path.write_text(path.read_text(encoding="utf-8").replace("IIM alias", "iim"), encoding="utf-8")
            args = argparse.Namespace(vault=str(root), wiki_folder="wiki")
            result = capture_json(wiki_ops.cmd_lint, args)
            categories = [issue["category"] for issue in result["issues"]]
            self.assertIn("redundant-alias", categories)


class RetrievalTests(unittest.TestCase):
    def test_explicit_keyword_title_match_is_kept_in_top_results(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broad_summary = "Codex Obsidian 投资分析 数据抓取 are all discussed here."
            for index in range(6):
                write_page(root, f"wiki/concepts/broad-{index}.md", f"Broad {index}", broad_summary)
            write_page(root, "wiki/concepts/codex.md", "Codex", broad_summary)
            write_page(root, "wiki/concepts/obsidian.md", "Obsidian", broad_summary)
            write_page(root, "wiki/concepts/投资分析.md", "投资分析", broad_summary)
            write_page(root, "wiki/concepts/数据抓取工作流.md", "数据抓取工作流", "抓取候选数据。")
            args = argparse.Namespace(
                vault=str(root),
                wiki_folder="wiki",
                query="Obsidian 与 Codex 的投资分析和数据抓取工作流",
                keyword=["Codex", "Obsidian", "投资分析", "数据抓取"],
                top=4,
            )
            result = capture_json(wiki_ops.cmd_retrieve, args)
            paths = [item["path"] for item in result["results"]]
            expected = {
                "wiki/concepts/codex",
                "wiki/concepts/obsidian",
                "wiki/concepts/投资分析",
                "wiki/concepts/数据抓取工作流",
            }
            self.assertEqual(set(result["keywordAnchors"]), expected)
            self.assertEqual(set(paths), expected)

    def test_exact_titles_beat_a_broad_source_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            broad = "Obsidian Codex Desktop 投资分析工作流 数据抓取工作流。"
            write_page(root, "wiki/sources/plan.md", "Obsidian 笔记管理与投资分析工作流规划", broad)
            write_page(root, "wiki/concepts/obsidian.md", "Obsidian", "笔记载体。")
            write_page(root, "wiki/concepts/codex-desktop.md", "Codex Desktop", "工作流核心。")
            write_page(root, "wiki/concepts/投资分析工作流.md", "投资分析工作流", "分析流程。")
            write_page(root, "wiki/concepts/数据抓取工作流.md", "数据抓取工作流", "抓取流程。")
            keywords = ["Obsidian", "Codex Desktop", "投资分析工作流", "数据抓取工作流"]
            args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", query=broad, keyword=keywords, top=4
            )
            result = capture_json(wiki_ops.cmd_retrieve, args)
            expected = {
                "wiki/concepts/obsidian",
                "wiki/concepts/codex-desktop",
                "wiki/concepts/投资分析工作流",
                "wiki/concepts/数据抓取工作流",
            }
            self.assertEqual(set(result["keywordAnchors"]), expected)
            self.assertEqual({item["path"] for item in result["results"]}, expected)

            single_args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", query="Obsidian 是什么？", keyword=["Obsidian"], top=3
            )
            single = capture_json(wiki_ops.cmd_retrieve, single_args)
            self.assertEqual(single["results"][0]["path"], "wiki/concepts/obsidian")

            reversed_args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", query=broad, keyword=list(reversed(keywords)), top=10
            )
            forward_args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", query=broad, keyword=keywords, top=10
            )
            forward = capture_json(wiki_ops.cmd_retrieve, forward_args)
            reversed_result = capture_json(wiki_ops.cmd_retrieve, reversed_args)
            self.assertEqual(forward["results"], reversed_result["results"])

            limited_args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", query=broad, keyword=keywords, top=2
            )
            limited = capture_json(wiki_ops.cmd_retrieve, limited_args)
            self.assertEqual(len(limited["droppedKeywordAnchors"]), 2)


class VaultCompatibilityTests(unittest.TestCase):
    def test_frontmatter_accepts_column_zero_list_items(self) -> None:
        parsed = wiki_ops.parse_frontmatter(
            "type: entity\ntags:\n- person\naliases:\n  - Indented\n- Flush\n"
        )
        self.assertEqual(parsed["tags"], ["person"])
        self.assertEqual(parsed["aliases"], ["Indented", "Flush"])

    def test_frontmatter_rejects_glued_dash_values(self) -> None:
        # `-5` without a space is not a YAML sequence item; reading it as the
        # item `5` would silently flip the sign.
        parsed = wiki_ops.parse_frontmatter("count:\n-5\nitems:\n- -5\n")
        self.assertEqual(parsed["count"], "")
        self.assertEqual(parsed["items"], [-5])

    def test_split_frontmatter_strips_byte_order_mark(self) -> None:
        frontmatter, body = wiki_ops.split_frontmatter(
            "\ufeff---\ntype: entity\n---\n\n# Title\n"
        )
        self.assertEqual(frontmatter["type"], "entity")
        self.assertIn("# Title", body)

    def test_discover_skips_dot_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "notes").mkdir()
            (root / "notes" / "keep.md").write_text("Durable note.", encoding="utf-8")
            trash = root / ".trash"
            trash.mkdir()
            (trash / "deleted.md").write_text("Deleted note.", encoding="utf-8")
            args = argparse.Namespace(
                vault=str(root), wiki_folder="wiki", path=["."],
                exclude=[], preserve_case=False,
            )
            result = capture_json(wiki_ops.cmd_discover, args)
            paths = [item["path"] for item in result["sources"]]
            self.assertIn("notes/keep.md", paths)
            self.assertNotIn(".trash/deleted.md", paths)

    def test_unreadable_page_is_skipped_with_its_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_page(root, "wiki/concepts/good.md", "Good", "Readable summary.")
            bad = root / "wiki" / "concepts" / "bad.md"
            bad.write_bytes(b"---\ntype: concept\n---\n\xff\xfe broken")
            args = argparse.Namespace(vault=str(root), wiki_folder="wiki")
            result = capture_json(wiki_ops.cmd_lint, args)
            unreadable = [
                issue for issue in result["issues"]
                if issue["category"] == "unreadable-page"
            ]
            self.assertEqual(len(unreadable), 1)
            self.assertEqual(unreadable[0]["path"], "wiki/concepts/bad.md")
            inventory = capture_json(
                wiki_ops.cmd_inventory,
                argparse.Namespace(vault=str(root), wiki_folder="wiki"),
            )
            self.assertEqual(
                [item["file"] for item in inventory["unreadablePages"]],
                ["wiki/concepts/bad.md"],
            )
            self.assertEqual(inventory["count"], 1)

    def test_embeds_and_attachments_are_not_dead_links(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_page(
                root, "wiki/concepts/media.md", "Media", "Summary text.",
                links="![[figure.png]]\n\n[[report.pdf]]\n\n[[missing-page]]\n",
            )
            args = argparse.Namespace(vault=str(root), wiki_folder="wiki")
            result = capture_json(wiki_ops.cmd_lint, args)
            dead = [
                issue["detail"] for issue in result["issues"]
                if issue["category"] == "dead-link"
            ]
            self.assertEqual(dead, ["Unresolved target: missing-page"])

    def test_summary_markup_is_stripped(self) -> None:
        self.assertEqual(
            wiki_ops.first_summary(
                "## 定义\n\nUses ![[img.png]] and [[wiki/concepts/x|X]] links.\n",
                "concept",
            ),
            "Uses and X links.",
        )


if __name__ == "__main__":
    unittest.main()
