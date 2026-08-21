from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock
import zipfile


SCRIPT = Path(__file__).parents[1] / "scripts" / "raw_to_markdown.py"
SPEC = importlib.util.spec_from_file_location(
    "raw_to_markdown_comprehensive_target", SCRIPT
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RawToMarkdownComprehensiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.vault = Path(self.temp.name)
        self.raw = self.vault / "raw" / "研究 资料$"
        self.raw.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_recursive_plan_skips_converter_lock_and_temp_artifacts(self) -> None:
        (self.raw / "source.txt").write_text("source", encoding="utf-8")
        (self.raw / ".orphan.md.raw-to-markdown.lock").write_text(
            "lock", encoding="utf-8"
        )
        (self.raw / ".orphan.md.raw-to-markdown-a1b2c3d4.tmp").write_text(
            "temp", encoding="utf-8"
        )

        items = MODULE.build_plan([str(self.raw)], self.vault, recursive=True)

        self.assertEqual(
            [item.action for item in items], ["skipped", "skipped", "create"]
        )
        self.assertNotIn("unsupported", {item.action for item in items})

    def test_user_temp_name_is_not_mistaken_for_converter_artifact(self) -> None:
        source = self.raw / ".report.md.notes.tmp"
        source.write_text("user file", encoding="utf-8")

        item = MODULE.build_plan([str(source)], self.vault, recursive=False)[0]

        self.assertEqual(item.action, "unsupported")

    def test_broken_output_symlink_is_a_preflight_conflict(self) -> None:
        source = self.raw / "occupied.txt"
        output = source.with_suffix(".md")
        source.write_text("source", encoding="utf-8")
        output.symlink_to(self.raw / "missing-target.md")

        item = MODULE.build_plan([str(source)], self.vault, recursive=False)[0]

        self.assertEqual(item.action, "conflict")
        self.assertIn("exists", item.reason.lower())

    def test_symlinked_source_escaping_raw_is_rejected(self) -> None:
        outside = self.vault / "outside.txt"
        outside.write_text("outside", encoding="utf-8")
        alias = self.raw / "alias.txt"
        alias.symlink_to(outside)

        item = MODULE.build_plan([str(alias)], self.vault, recursive=False)[0]

        self.assertEqual(item.action, "invalid")

    def test_raw_root_symlink_escaping_vault_is_rejected(self) -> None:
        vault = self.vault / "nested-vault"
        external_raw = self.vault / "external-raw"
        vault.mkdir()
        external_raw.mkdir()
        source = external_raw / "source.txt"
        source.write_text("outside nested vault", encoding="utf-8")
        (vault / "raw").symlink_to(external_raw, target_is_directory=True)

        item = MODULE.build_plan([str(source)], vault, recursive=False)[0]

        self.assertEqual(item.action, "invalid")
        self.assertIn("resolves outside", item.reason)

    def test_raw_root_symlink_into_wiki_is_rejected(self) -> None:
        vault = self.vault / "nested-vault"
        wiki = vault / "wiki"
        vault.mkdir()
        wiki.mkdir()
        source = wiki / "must-not-convert.txt"
        source.write_text("knowledge layer", encoding="utf-8")
        (vault / "raw").symlink_to(wiki, target_is_directory=True)

        item = MODULE.build_plan([str(source)], vault, recursive=False)[0]

        self.assertEqual(item.action, "invalid")
        self.assertIsNone(item.output)

    def test_duplicate_requests_are_deduplicated(self) -> None:
        source = self.raw / "duplicate.txt"
        source.write_text("source", encoding="utf-8")

        items = MODULE.build_plan(
            [str(source), str(source), source.relative_to(self.vault).as_posix()],
            self.vault,
            recursive=False,
        )

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].action, "create")

    def test_preflight_blocker_prevents_every_write_and_engine_load(self) -> None:
        supported = self.raw / "valid.txt"
        unsupported = self.raw / "legacy.doc"
        supported.write_text("valid", encoding="utf-8")
        unsupported.write_bytes(b"legacy")

        with mock.patch.object(MODULE, "load_engine") as load_engine:
            results, exit_code = MODULE.run_convert(
                [str(supported), str(unsupported)], self.vault, recursive=False
            )

        self.assertEqual(exit_code, 2)
        self.assertEqual({item["action"] for item in results}, {"create", "unsupported"})
        load_engine.assert_not_called()
        self.assertFalse(supported.with_suffix(".md").exists())

    def test_no_op_does_not_load_or_version_engine(self) -> None:
        source = self.raw / "stable.txt"
        source.write_text("stable", encoding="utf-8")
        _, first_exit = MODULE.run_convert([str(source)], self.vault, recursive=False)
        self.assertEqual(first_exit, 0)

        with (
            mock.patch.object(MODULE, "load_engine") as load_engine,
            mock.patch.object(MODULE, "engine_version") as engine_version,
        ):
            results, second_exit = MODULE.run_convert(
                [str(source)], self.vault, recursive=False
            )

        self.assertEqual(second_exit, 0)
        self.assertEqual(results[0]["action"], "no-op")
        load_engine.assert_not_called()
        engine_version.assert_not_called()

    def test_engine_receives_disposable_copy_not_original(self) -> None:
        source = self.raw / "isolated.txt"
        original = b"authoritative source"
        source.write_bytes(original)
        observed: dict[str, object] = {}

        class MutatingEngine:
            def convert_local(self, temporary_source: Path) -> SimpleNamespace:
                observed["path"] = temporary_source
                observed["before"] = temporary_source.read_bytes()
                temporary_source.write_bytes(b"converter mutation")
                return SimpleNamespace(text_content="converted marker")

        with (
            mock.patch.object(MODULE, "load_engine", return_value=MutatingEngine()),
            mock.patch.object(
                MODULE, "engine_version", return_value=MODULE.pinned_engine_version()
            ),
        ):
            results, exit_code = MODULE.run_convert(
                [str(source)], self.vault, recursive=False
            )

        self.assertEqual(exit_code, 0, results)
        self.assertEqual(observed["before"], original)
        self.assertNotEqual(Path(observed["path"]), source)
        self.assertEqual(source.read_bytes(), original)

    def test_empty_converter_result_leaves_no_output_or_lock(self) -> None:
        source = self.raw / "empty.txt"
        source.write_text("source", encoding="utf-8")

        class EmptyEngine:
            def convert_local(self, _temporary_source: Path) -> SimpleNamespace:
                return SimpleNamespace(text_content=" \r\n ")

        with (
            mock.patch.object(MODULE, "load_engine", return_value=EmptyEngine()),
            mock.patch.object(
                MODULE, "engine_version", return_value=MODULE.pinned_engine_version()
            ),
        ):
            results, exit_code = MODULE.run_convert(
                [str(source)], self.vault, recursive=False
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual(results[0]["action"], "failed")
        self.assertIn("empty Markdown", results[0]["reason"])
        self.assertFalse(source.with_suffix(".md").exists())
        self.assertFalse((self.raw / ".empty.md.raw-to-markdown.lock").exists())

    def test_existing_lock_is_preserved_and_blocks_conversion(self) -> None:
        source = self.raw / "locked.txt"
        source.write_text("source", encoding="utf-8")
        lock = self.raw / ".locked.md.raw-to-markdown.lock"
        lock.write_text("other process", encoding="utf-8")

        class Engine:
            def convert_local(self, _temporary_source: Path) -> SimpleNamespace:
                return SimpleNamespace(text_content="converted")

        with (
            mock.patch.object(MODULE, "load_engine", return_value=Engine()),
            mock.patch.object(
                MODULE, "engine_version", return_value=MODULE.pinned_engine_version()
            ),
        ):
            results, exit_code = MODULE.run_convert(
                [str(source)], self.vault, recursive=False
            )

        self.assertEqual(exit_code, 1)
        self.assertIn("lock already exists", results[0]["reason"])
        self.assertEqual(lock.read_text(encoding="utf-8"), "other process")
        self.assertFalse(source.with_suffix(".md").exists())

    def test_lock_initialization_failure_cleans_its_own_lock(self) -> None:
        output = self.raw / "lock-failure.md"
        lock = MODULE.OutputLock(output)
        try:
            with (
                mock.patch.object(MODULE.os, "write", side_effect=OSError("disk full")),
                self.assertRaises(OSError),
            ):
                with lock:
                    pass
            self.assertFalse(lock.path.exists())
            self.assertIsNone(lock.fd)
        finally:
            if lock.fd is not None:
                os.close(lock.fd)
                lock.fd = None
            if lock.path.exists():
                lock.path.unlink()

    def test_lock_fstat_failure_closes_descriptor_without_guessing_ownership(self) -> None:
        output = self.raw / "fstat-failure.md"
        lock = MODULE.OutputLock(output)
        try:
            with (
                mock.patch.object(MODULE.os, "fstat", side_effect=OSError("fstat failed")),
                self.assertRaises(OSError),
            ):
                with lock:
                    pass
            self.assertIsNone(lock.fd)
            self.assertTrue(lock.path.exists())
        finally:
            if lock.fd is not None:
                os.close(lock.fd)
                lock.fd = None
            if lock.path.exists():
                lock.path.unlink()

    def test_lock_release_does_not_delete_a_replacement_lock(self) -> None:
        output = self.raw / "replacement.md"
        lock = MODULE.OutputLock(output)

        with lock:
            lock.path.unlink()
            lock.path.write_text("replacement lock", encoding="utf-8")

        self.assertEqual(lock.path.read_text(encoding="utf-8"), "replacement lock")

    def test_lock_metadata_handles_partial_os_writes(self) -> None:
        output = self.raw / "partial-write.md"
        lock = MODULE.OutputLock(output)
        real_write = MODULE.os.write
        calls = 0

        def write_one_byte(fd: int, data: memoryview) -> int:
            nonlocal calls
            calls += 1
            return real_write(fd, data[:1])

        with mock.patch.object(MODULE.os, "write", side_effect=write_one_byte):
            with lock:
                self.assertTrue(lock.path.exists())

        self.assertGreater(calls, 1)
        self.assertFalse(lock.path.exists())
        self.assertIsNone(lock.fd)

    def test_lock_zero_byte_write_fails_and_cleans_owned_lock(self) -> None:
        output = self.raw / "zero-write.md"
        lock = MODULE.OutputLock(output)

        with (
            mock.patch.object(MODULE.os, "write", return_value=0),
            self.assertRaises(OSError),
        ):
            with lock:
                pass

        self.assertFalse(lock.path.exists())
        self.assertIsNone(lock.fd)

    def test_atomic_create_failure_cleans_staging_file(self) -> None:
        output = self.raw / "atomic.md"

        with (
            mock.patch.object(MODULE.os, "link", side_effect=OSError("link failed")),
            self.assertRaises(OSError),
        ):
            MODULE.create_output(output, b"content")

        self.assertFalse(output.exists())
        self.assertEqual(list(self.raw.glob(".atomic.md.*.tmp")), [])

    def test_batch_runtime_failure_does_not_delete_successful_sidecars(self) -> None:
        first = self.raw / "a-success.txt"
        second = self.raw / "b-failure.txt"
        first.write_text("first", encoding="utf-8")
        second.write_text("second", encoding="utf-8")

        class PartlyFailingEngine:
            def convert_local(self, temporary_source: Path) -> SimpleNamespace:
                if temporary_source.name == second.name:
                    raise RuntimeError("format-specific failure")
                return SimpleNamespace(text_content="successful conversion")

        with (
            mock.patch.object(
                MODULE, "load_engine", return_value=PartlyFailingEngine()
            ),
            mock.patch.object(
                MODULE, "engine_version", return_value=MODULE.pinned_engine_version()
            ),
        ):
            results, exit_code = MODULE.run_convert(
                [str(first), str(second)], self.vault, recursive=False
            )

        self.assertEqual(exit_code, 1)
        self.assertEqual([item["action"] for item in results], ["created", "failed"])
        self.assertTrue(first.with_suffix(".md").exists())
        self.assertFalse(second.with_suffix(".md").exists())

    def test_unexpected_engine_initialization_failure_is_structured_cli_error(self) -> None:
        source = self.raw / "engine-init.txt"
        source.write_text("source", encoding="utf-8")
        stdout = io.StringIO()

        with (
            mock.patch.object(
                MODULE, "load_engine", side_effect=RuntimeError("engine init crashed")
            ),
            contextlib.redirect_stdout(stdout),
        ):
            exit_code = MODULE.main(
                ["convert", "--vault", str(self.vault), str(source)]
            )

        report = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 1)
        self.assertFalse(report["ok"])
        self.assertEqual(report["items"][0]["action"], "failed")
        self.assertIn("engine init crashed", report["items"][0]["reason"])

    def test_frontmatter_hashes_and_final_newline_are_self_consistent(self) -> None:
        source = self.raw / "来源 文件$.txt"
        source.write_text("line one\r\nline two\r\n\r\n", encoding="utf-8")

        results, exit_code = MODULE.run_convert(
            [str(source)], self.vault, recursive=False
        )

        self.assertEqual(exit_code, 0, results)
        content = source.with_suffix(".md").read_text(encoding="utf-8")
        metadata, body, canonical = MODULE.parse_frontmatter(content)
        self.assertTrue(canonical)
        self.assertEqual(tuple(metadata), MODULE.PROVENANCE_KEYS)
        self.assertEqual(
            metadata["conversion_body_sha256"],
            MODULE.sha256_bytes(body.encode("utf-8")),
        )
        self.assertEqual(
            metadata["conversion_metadata_sha256"], MODULE.metadata_sha256(metadata)
        )
        self.assertTrue(content.endswith("\n"))
        self.assertFalse(content.endswith("\n\n"))
        self.assertIn("[[raw/研究 资料$/来源 文件$.txt]]", body)

    def test_recomputed_but_invalid_timestamp_is_rejected(self) -> None:
        source = self.raw / "timestamp.txt"
        source.write_text("source", encoding="utf-8")
        _, exit_code = MODULE.run_convert([str(source)], self.vault, recursive=False)
        self.assertEqual(exit_code, 0)
        output = source.with_suffix(".md")
        metadata, body = MODULE.split_frontmatter(output.read_text(encoding="utf-8"))
        metadata["converted_at"] = "not-a-timeZ"
        metadata["conversion_metadata_sha256"] = MODULE.metadata_sha256(metadata)
        output.write_text(MODULE.render_frontmatter(metadata) + body, encoding="utf-8")

        item = MODULE.build_plan([str(source)], self.vault, recursive=False)[0]

        self.assertEqual(item.action, "conflict")
        self.assertIn("timestamp", item.reason.lower())

    def test_engine_version_mismatch_is_structured_cli_failure(self) -> None:
        source = self.raw / "version.txt"
        source.write_text("source", encoding="utf-8")
        stdout = io.StringIO()

        with (
            mock.patch.object(
                MODULE,
                "engine_version",
                side_effect=MODULE.ConversionError("wrong engine version"),
            ),
            contextlib.redirect_stdout(stdout),
        ):
            exit_code = MODULE.main(
                ["convert", "--vault", str(self.vault), str(source)]
            )

        report = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 1)
        self.assertFalse(report["ok"])
        self.assertEqual(report["items"][0]["action"], "failed")
        self.assertIn("wrong engine version", report["items"][0]["reason"])
        self.assertFalse(source.with_suffix(".md").exists())

    def test_short_sparse_pdf_false_tables_are_detected(self) -> None:
        prose = "这是一段被错误塞进稀疏表格的连续正文" * 4
        false_tables = "\n".join(
            line
            for _ in range(3)
            for line in (f"| {prose} |  |  |", "| --- | --- | --- |")
        )

        self.assertTrue(MODULE.has_pathological_pdf_tables(false_tables))

    def test_long_genuine_pdf_table_is_not_mistaken_for_false_tables(self) -> None:
        header = "| Scenario | Evidence | Result |\n| --- | --- | --- |"
        rows = "\n".join(
            f"| Case {index} | {'substantive evidence ' * 4} | Pass {index} |"
            for index in range(30)
        )

        self.assertFalse(MODULE.has_pathological_pdf_tables(f"{header}\n{rows}"))

    def test_multiple_long_genuine_pdf_tables_do_not_trigger_prose_fallback(self) -> None:
        tables = []
        for table_index in range(4):
            rows = ["| Scenario | Evidence | Result |", "| --- | --- | --- |"]
            rows.extend(
                f"| Case {table_index}-{row} | {'substantive evidence ' * 4} | Pass |"
                for row in range(5)
            )
            tables.append("\n".join(rows))

        self.assertFalse(MODULE.has_pathological_pdf_tables("\n\n".join(tables)))

    def test_pdf_cleanup_removes_repeated_text_footers(self) -> None:
        cleaned = MODULE.clean_pdf_pages(
            [
                "期刊 2024年第1期\n第一页正文。\n版权所有 请勿转载",
                "期刊 2024年第2期\n第二页正文。\n版权所有 请勿转载",
            ],
            "unmatched-title",
        )

        self.assertIn("第一页正文。", cleaned)
        self.assertIn("第二页正文。", cleaned)
        self.assertNotIn("版权所有", cleaned)

    def test_pdf_cleanup_preserves_repeated_url_continuations_at_page_bottom(self) -> None:
        repeated_url = (
            "energy-transitions．org/publications/"
            "china-2050-a-fully-developed-rich-zero-carbon-economy。"
        )
        cleaned = MODULE.clean_pdf_pages(
            [
                f"期刊 2024年第1期\n第一页正文。\n{repeated_url}\n版权所有 请勿转载",
                f"期刊 2024年第2期\n第二页正文。\n{repeated_url}\n版权所有 请勿转载",
            ],
            "unmatched-title",
        )

        self.assertEqual(cleaned.count(repeated_url), 2)
        self.assertNotIn("版权所有", cleaned)

    def test_pdf_cleanup_preserves_distinct_citations_at_page_bottom(self) -> None:
        citation_one = "期刊名，2023，12(3):45-60."
        citation_two = "期刊名，2024，13(4):61-70."
        cleaned = MODULE.clean_pdf_pages(
            [
                f"期刊 2024年第1期\n第一页正文。\n{citation_one}\n版权所有 请勿转载",
                f"期刊 2024年第2期\n第二页正文。\n{citation_two}\n版权所有 请勿转载",
            ],
            "unmatched-title",
        )

        self.assertIn(citation_one, cleaned)
        self.assertIn(citation_two, cleaned)
        self.assertNotIn("版权所有", cleaned)

    def test_pdf_cleanup_preserves_unfinished_citations_without_terminal_punctuation(
        self,
    ) -> None:
        citation_one = "期刊名，2023，12(3):45-60"
        citation_two = "期刊名，2024，13(4):61-70"
        cleaned = MODULE.clean_pdf_pages(
            [
                f"期刊 2024年第1期\n第一页正文。\n{citation_one}\n版权所有 请勿转载",
                f"期刊 2024年第2期\n第二页正文。\n{citation_two}\n版权所有 请勿转载",
            ],
            "unmatched-title",
        )

        self.assertIn(citation_one, cleaned)
        self.assertIn(citation_two, cleaned)
        self.assertNotIn("版权所有", cleaned)

    def test_pdf_cleanup_keeps_standalone_number_inside_body(self) -> None:
        cleaned = MODULE.clean_pdf_pages(
            ["期刊 2024年第1期\n年度数据如下：\n2024\n该年增长显著。\n8"],
            "unmatched-title",
        )

        self.assertRegex(cleaned, r"年度数据如下：\s*2024")
        self.assertNotRegex(cleaned, r"(?m)^8$")

    def test_pdf_cleanup_keeps_ambiguous_number_on_sparse_page(self) -> None:
        cleaned = MODULE.clean_pdf_pages(
            ["年度数据如下：\n2024\n该年增长显著。"],
            "unmatched-title",
        )

        self.assertRegex(cleaned, r"年度数据如下：\s*2024")

    def test_real_engine_converts_structured_text_families(self) -> None:
        samples = {
            "plain.txt": ("plain conversion marker", "plain conversion marker"),
            "rows.csv": ("name,value\ncsv conversion marker,7\n", "csv conversion marker"),
            "tabs.tsv": ("name\tvalue\ntsv conversion marker\t8\n", "tsv conversion marker"),
            "page.html": (
                "<html><body><h1>html conversion marker</h1></body></html>",
                "html conversion marker",
            ),
            "legacy.htm": (
                "<html><body><p>htm conversion marker</p></body></html>",
                "htm conversion marker",
            ),
            "data.json": (
                '{"marker": "json conversion marker", "value": 9}',
                "json conversion marker",
            ),
            "tree.xml": (
                "<root><marker>xml conversion marker</marker></root>",
                "xml conversion marker",
            ),
        }
        for name, (content, _marker) in samples.items():
            (self.raw / name).write_text(content, encoding="utf-8")

        results, exit_code = MODULE.run_convert(
            [str(self.raw / name) for name in samples],
            self.vault,
            recursive=False,
        )

        self.assertEqual(exit_code, 0, results)
        self.assertEqual({item["action"] for item in results}, {"created"})
        for name, (_content, marker) in samples.items():
            output = (self.raw / name).with_suffix(".md").read_text(encoding="utf-8")
            self.assertIn(marker, output)

    def test_real_engine_converts_zip_and_epub(self) -> None:
        zip_source = self.raw / "archive.zip"
        with zipfile.ZipFile(zip_source, "w") as archive:
            archive.writestr("folder/content.txt", "zip conversion marker")

        epub_source = self.raw / "book.epub"
        container = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"""
        package = """<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">test-book</dc:identifier>
    <dc:title>Test</dc:title><dc:language>en</dc:language>
  </metadata>
  <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="chapter"/></spine>
</package>"""
        chapter = (
            '<html xmlns="http://www.w3.org/1999/xhtml"><body>'
            "<h1>epub conversion marker</h1></body></html>"
        )
        with zipfile.ZipFile(epub_source, "w") as archive:
            archive.writestr(
                "mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED
            )
            archive.writestr("META-INF/container.xml", container)
            archive.writestr("OEBPS/content.opf", package)
            archive.writestr("OEBPS/chapter.xhtml", chapter)

        results, exit_code = MODULE.run_convert(
            [str(zip_source), str(epub_source)], self.vault, recursive=False
        )

        self.assertEqual(exit_code, 0, results)
        self.assertIn(
            "zip conversion marker", zip_source.with_suffix(".md").read_text(encoding="utf-8")
        )
        self.assertIn(
            "epub conversion marker", epub_source.with_suffix(".md").read_text(encoding="utf-8")
        )

    def test_pinned_engine_registers_every_declared_binary_converter(self) -> None:
        engine = MODULE.load_engine()
        registered = {
            type(registration.converter).__name__ for registration in engine._converters
        }

        self.assertTrue(
            {
                "DocxConverter",
                "PdfConverter",
                "PptxConverter",
                "XlsConverter",
                "XlsxConverter",
                "OutlookMsgConverter",
                "EpubConverter",
                "ZipConverter",
            }.issubset(registered)
        )


if __name__ == "__main__":
    unittest.main()
