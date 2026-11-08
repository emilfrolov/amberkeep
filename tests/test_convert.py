"""End-to-end checks for preservation, readable views and archive boundaries.

All account records below are synthetic. No test contacts Claude or any remote
service, and no real vault is read or changed.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills" / "archive-to-obsidian" / "scripts" / "convert.py"


class ConvertTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / "Source"
        self.source.mkdir()
        self.output = self.base / "Amberkeep-fixture"

    def write(self, name, value):
        path = self.source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(value, bytes):
            path.write_bytes(value)
        else:
            path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def run_cli(self, source=None, output=None, *extra):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--input", str(source or self.source),
             "--output", str(output or self.output), *map(str, extra)],
            capture_output=True, text=True, encoding="utf-8", timeout=30,
        )

    def succeed(self, result):
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def fail_cleanly(self, result, output=None):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertTrue(result.stderr.strip(), "A failed conversion needs a useful error")
        self.assertNotIn("Traceback", result.stderr)
        self.assertFalse((output or self.output).exists())

    def manifest(self, output=None):
        return json.loads(((output or self.output) / "manifest.json").read_text("utf-8"))

    def markdown(self, output=None):
        return {path.relative_to(output or self.output).as_posix(): path.read_text("utf-8")
                for path in (output or self.output).rglob("*.md")}

    def full_fixture(self):
        self.write("conversations.json", [
            {
                "uuid": "conversation-one",
                "name": "Дневник / Research: α",
                "created_at": "2026-01-01T10:00:00Z",
                "chat_messages": [
                    {"uuid": "m1", "sender": "human", "text": "FIRST-HUMAN-MESSAGE"},
                    {
                        "uuid": "m2", "sender": "assistant",
                        "text": "DIVERGENT-TEXT-VERSION",
                        "content": [
                            {"type": "text", "text": "DIVERGENT-CONTENT-VERSION"},
                            {"type": "tool_use", "name": "shell", "input": {
                                "command": "touch DO-NOT-EXECUTE-THIS"}},
                            {"type": "future_block", "payload": "UNKNOWN-CONTENT-PAYLOAD"},
                        ],
                        "attachments": [{"file_name": "paper.pdf", "url":
                            "https://example.invalid/do-not-download", "file_size": 14}],
                    },
                    {"uuid": "m3", "sender": "human", "text": "LAST-HUMAN-MESSAGE"},
                ],
            },
            {
                "uuid": "conversation-two", "name": "Дневник / Research: α",
                "chat_messages": [{"sender": "assistant", "text": "SECOND-CONVERSATION"}],
            },
            {"uuid": "conversation-empty", "name": "Empty conversation", "chat_messages": []},
        ])
        self.write("projects.json", [{
            "uuid": "project-one", "name": "Synthetic project",
            "description": "PROJECT-DESCRIPTION", "prompt_template": "PROJECT-INSTRUCTIONS",
        }])
        self.write("projects/project-two.json", {
            "uuid": "project-two", "name": "Nested project", "description": "NESTED-PROJECT",
        })
        self.write("memories.json", {
            "account_uuid": "synthetic-account",
            "conversations_memory": "ACCOUNT-MEMORY-TEXT",
            "project_memories": [{"project_uuid": "project-one", "memory": "PROJECT-MEMORY-TEXT"}],
            "memory_files": [{"path": "notes/fact.md", "content": "MEMORY-FILE-TEXT"}],
        })
        self.write("users.json", [{
            "uuid": "synthetic-user", "email": "fixture@example.invalid",
            "full_name": "Fixture User", "preferences": {"writing": "ACCOUNT-PREFERENCE"},
        }])
        self.write("future-format.json", {"future": {"field": "UNKNOWN-SCHEMA-TEXT"}})
        self.write("files/данные.bin", b"\x00\xffattachment-bytes\n")
        self.write("malformed.json", b'{"broken": "MALFORMED-JSON"')

    def assert_raw_preserved(self, original_files, output=None):
        output = output or self.output
        manifest = self.manifest(output)
        entries = {entry["original_path"]: entry for entry in manifest["files"]}
        self.assertEqual(set(entries), set(original_files))
        raw_paths = []
        for name, original in original_files.items():
            with self.subTest(original=name):
                entry = entries[name]
                raw = output / entry["raw_path"]
                self.assertTrue(raw.resolve().is_relative_to(output.resolve()))
                self.assertEqual(raw.read_bytes(), original)
                self.assertEqual(entry["size"], len(original))
                self.assertEqual(entry["sha256"], hashlib.sha256(original).hexdigest())
                self.assertTrue(entry["raw_path"].startswith("Raw/"))
                self.assertTrue(entry["raw_path"].endswith(".raw"))
                raw_paths.append(entry["raw_path"].casefold())
        self.assertEqual(len(raw_paths), len(set(raw_paths)), "Raw files must never collide")

    def test_complete_directory_preserves_every_source_and_readable_message(self):
        self.full_fixture()
        originals = {p.relative_to(self.source).as_posix(): p.read_bytes()
                     for p in self.source.rglob("*") if p.is_file()}
        self.succeed(self.run_cli())
        self.assert_raw_preserved(originals)
        notes = self.markdown()
        joined = "\n".join(notes.values())
        for marker in [
            "FIRST-HUMAN-MESSAGE", "DIVERGENT-TEXT-VERSION", "DIVERGENT-CONTENT-VERSION",
            "LAST-HUMAN-MESSAGE", "SECOND-CONVERSATION", "paper.pdf",
            "PROJECT-DESCRIPTION", "PROJECT-INSTRUCTIONS", "NESTED-PROJECT",
            "ACCOUNT-MEMORY-TEXT", "PROJECT-MEMORY-TEXT", "MEMORY-FILE-TEXT",
            "ACCOUNT-PREFERENCE", "UNKNOWN-SCHEMA-TEXT",
        ]:
            with self.subTest(marker=marker):
                self.assertIn(marker, joined)
        self.assertIn("Home.md", notes)
        self.assertIn("EXPORT-REPORT.md", notes)
        manifest = self.manifest()
        self.assertEqual(manifest["counts"]["conversations"], 3)
        self.assertEqual(manifest["counts"]["messages"], 4)
        self.assertEqual(manifest["counts"]["source_files"], len(originals))
        self.assertTrue(manifest["warnings"], "Malformed input must appear in the report")
        self.assertFalse((ROOT / "DO-NOT-EXECUTE-THIS").exists())
        self.assertFalse((Path.cwd() / "DO-NOT-EXECUTE-THIS").exists())
        self.assertFalse((self.base / "DO-NOT-EXECUTE-THIS").exists())

    def test_duplicate_titles_create_distinct_notes_and_links_resolve(self):
        self.full_fixture()
        self.succeed(self.run_cli())
        notes = self.markdown()
        first = [path for path, text in notes.items() if "FIRST-HUMAN-MESSAGE" in text]
        second = [path for path, text in notes.items() if "SECOND-CONVERSATION" in text]
        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertNotEqual(first[0], second[0])
        seen_links = 0
        for path, text in notes.items():
            for raw_target in re.findall(r"(?<!!)\[\[([^\]]+)\]\]", text):
                target = raw_target.split("|", 1)[0].split("#", 1)[0]
                with self.subTest(source=path, link=target):
                    self.assertTrue(target.startswith(self.output.name + "/"))
                    relative = target.removeprefix(self.output.name + "/")
                    candidate = self.output / relative
                    if not candidate.is_file():
                        candidate = candidate.with_suffix(".md")
                    self.assertTrue(candidate.is_file(), "A generated wikilink must have a target")
                seen_links += 1
        self.assertGreater(seen_links, 3)

    def test_single_json_input_accepts_unicode_and_preserves_its_bytes(self):
        source = self.write("conversations.json", [{
            "uuid": "c-unicode", "name": "Привет 🌍",
            "chat_messages": [{"sender": "human", "text": "こんにちは — Привет — مرحبا"}],
        }])
        self.succeed(self.run_cli(source))
        self.assert_raw_preserved({source.name: source.read_bytes()})
        self.assertIn("こんにちは — Привет — مرحبا", "\n".join(self.markdown().values()))

    def test_wrapped_conversations_and_dictionary_memory_variants(self):
        self.write("conversations.json", {"conversations": [{
            "uuid": "wrapped-chat", "name": "Wrapped conversation",
            "chat_messages": [{"sender": "human", "text": "WRAPPED-MESSAGE"}],
        }]})
        self.write("memories.json", {
            "project_memories": {"project-a": "DICTIONARY-PROJECT-MEMORY"},
            "memory_files": {"profile.md": "DICTIONARY-MEMORY-FILE"},
        })
        self.succeed(self.run_cli())
        joined = "\n".join(self.markdown().values())
        for marker in ["WRAPPED-MESSAGE", "DICTIONARY-PROJECT-MEMORY", "DICTIONARY-MEMORY-FILE"]:
            self.assertIn(marker, joined)
        self.assertEqual(self.manifest()["counts"]["conversations"], 1)

    def test_conversation_with_two_message_arrays_does_not_hide_alternate_data(self):
        self.write("conversations.json", [{
            "uuid": "dual-array-chat", "name": "Both message fields",
            "chat_messages": [{"sender": "human", "text": "PRIMARY-MESSAGE-ARRAY"}],
            "messages": [{"role": "assistant", "text": "ALTERNATE-MESSAGE-ARRAY"}],
        }])
        self.succeed(self.run_cli())
        joined = "\n".join(self.markdown().values())
        self.assertIn("PRIMARY-MESSAGE-ARRAY", joined)
        self.assertIn("ALTERNATE-MESSAGE-ARRAY", joined)

    def test_zip_input_and_output_match_folder_tree(self):
        self.full_fixture()
        archive = self.base / "export.zip"
        originals = {p.relative_to(self.source).as_posix(): p.read_bytes()
                     for p in self.source.rglob("*") if p.is_file()}
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
            for name, data in originals.items():
                zipped.writestr(name, data)
        destination_zip = self.base / "obsidian-notes.zip"
        self.succeed(self.run_cli(archive, self.output, "--zip", destination_zip))
        self.assert_raw_preserved(originals)
        actual_files = {p.relative_to(self.output).as_posix(): p.read_bytes()
                        for p in self.output.rglob("*") if p.is_file()}
        with zipfile.ZipFile(destination_zip) as zipped:
            archived_files = {name: zipped.read(name) for name in zipped.namelist()
                              if not name.endswith("/")}
        self.assertEqual(archived_files, {
            self.output.name + "/" + name: data for name, data in actual_files.items()
        })

    def test_note_identifiers_are_stable_between_runs(self):
        self.full_fixture()
        second_parent = self.base / "Second"
        second_parent.mkdir()
        second = second_parent / self.output.name
        self.succeed(self.run_cli())
        self.succeed(self.run_cli(output=second))
        first_paths = {note["path"] for note in self.manifest()["notes"]}
        second_paths = {note["path"] for note in self.manifest(second)["notes"]}
        self.assertEqual(first_paths, second_paths)
        self.assertEqual(len(first_paths), len(self.manifest()["notes"]))

    def test_unknown_and_malformed_json_remain_byte_exact_with_report(self):
        originals = {
            "future.json": b'{"new_shape":{"value":"KEEP-ME"}}',
            "broken.json": b'{unparseable',
            "not-json.dat": b"\x00\xff\x01",
        }
        for name, data in originals.items():
            self.write(name, data)
        self.succeed(self.run_cli())
        self.assert_raw_preserved(originals)
        self.assertIn("KEEP-ME", "\n".join(self.markdown().values()))
        manifest = self.manifest()
        self.assertTrue(any("broken.json" in str(w) for w in manifest["warnings"]))
        self.assertGreaterEqual(manifest["counts"]["raw_only_files"], 2)

    def test_large_json_is_preserved_without_attempting_a_view(self):
        original = self.write("large.json", {"payload": "x" * 2048}).read_bytes()
        self.succeed(self.run_cli(None, None, "--max-json-bytes", "512"))
        self.assert_raw_preserved({"large.json": original})
        manifest = self.manifest()
        self.assertEqual(manifest["counts"]["raw_only_files"], 1)
        self.assertTrue(any("large.json" in str(w) for w in manifest["warnings"]))

    def test_source_html_and_markdown_are_inactive_raw_files(self):
        originals = {
            "injected.md": b"![[other-private-note]]\n<script>alert('no')</script>",
            "injected.html": b'<script src="https://example.invalid/no"></script>',
        }
        for name, data in originals.items():
            self.write(name, data)
        self.succeed(self.run_cli())
        self.assert_raw_preserved(originals)
        self.assertFalse(list((self.output / "Raw").rglob("*.md")))
        self.assertFalse(list((self.output / "Raw").rglob("*.html")))

    def test_existing_output_is_never_modified(self):
        self.write("data.json", {"hello": "world"})
        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_bytes(b"user-file")
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(marker.read_bytes(), b"user-file")
        self.assertEqual(list(self.output.iterdir()), [marker])

    def test_existing_zip_prevents_any_output_creation(self):
        self.write("data.json", {"hello": "world"})
        archive = self.base / "keep.zip"
        archive.write_bytes(b"user-archive")
        self.fail_cleanly(self.run_cli(None, None, "--zip", archive))
        self.assertEqual(archive.read_bytes(), b"user-archive")

    def test_input_output_overlap_is_rejected(self):
        self.write("data.json", {"hello": "world"})
        overlapping = self.source / "New vault"
        self.fail_cleanly(self.run_cli(output=overlapping), overlapping)

    def test_output_zip_inside_source_is_rejected(self):
        self.write("data.json", {"hello": "world"})
        archive = self.source / "new.zip"
        self.fail_cleanly(self.run_cli(None, None, "--zip", archive))
        self.assertFalse(archive.exists())

    @unittest.skipUnless(hasattr(Path, "symlink_to"), "Symlinks unavailable")
    def test_symlink_in_directory_input_is_rejected(self):
        outside = self.base / "outside.txt"
        outside.write_bytes(b"do-not-read")
        (self.source / "link.txt").symlink_to(outside)
        self.fail_cleanly(self.run_cli())
        self.assertEqual(outside.read_bytes(), b"do-not-read")

    @unittest.skipUnless(hasattr(Path, "symlink_to"), "Symlinks unavailable")
    def test_output_through_symlink_parent_is_rejected(self):
        self.write("data.json", {"hello": "world"})
        actual = self.base / "Actual"
        actual.mkdir()
        link = self.base / "Link"
        link.symlink_to(actual, target_is_directory=True)
        output = link / "New vault"
        self.fail_cleanly(self.run_cli(output=output), output)
        self.assertEqual(list(actual.iterdir()), [])

    def test_zip_unsafe_member_names_are_rejected_without_extraction(self):
        for index, name in enumerate([
            "../outside.txt", "/absolute.txt", "C:/drive.txt", "..\\outside.txt",
            "folder\\data.json", "safe/../../outside.txt",
        ]):
            with self.subTest(name=name):
                archive = self.base / (str(index) + ".zip")
                with zipfile.ZipFile(archive, "w") as zipped:
                    zipped.writestr(name, "do-not-extract")
                self.fail_cleanly(self.run_cli(archive))
        self.assertFalse((self.base / "outside.txt").exists())

    def test_zip_symlink_is_rejected(self):
        archive = self.base / "symlink.zip"
        link = zipfile.ZipInfo("link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr(link, "../../outside")
        self.fail_cleanly(self.run_cli(archive))

    def test_zip_duplicate_file_names_fail_instead_of_losing_a_version(self):
        archive = self.base / "duplicate.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("same.json", '{"first":1}')
            # zipfile warns about the intentionally malformed source archive.
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                zipped.writestr("same.json", '{"second":2}')
        self.fail_cleanly(self.run_cli(archive))

    def test_uncompressed_zip_size_limit_is_enforced(self):
        archive = self.base / "compressed.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr("large.bin", b"x" * 200_000)
        self.fail_cleanly(self.run_cli(archive, None, "--max-bytes", "1024"))

    def test_directory_byte_limit_and_file_count_limit_are_enforced(self):
        self.write("one.dat", b"a" * 100)
        self.write("two.dat", b"b" * 100)
        self.fail_cleanly(self.run_cli(None, None, "--max-bytes", "150"))
        self.fail_cleanly(self.run_cli(None, None, "--max-files", "1"))

    def test_invalid_limits_and_unreadable_archive_fail_cleanly(self):
        self.write("data.json", {"hello": "world"})
        for flag, value in [("--max-files", "0"), ("--max-bytes", "-1"),
                            ("--max-json-bytes", "0")]:
            with self.subTest(flag=flag):
                self.fail_cleanly(self.run_cli(None, None, flag, value))
        broken = self.base / "broken.zip"
        broken.write_bytes(b"not-a-zip")
        self.fail_cleanly(self.run_cli(broken))


if __name__ == "__main__":
    unittest.main()
