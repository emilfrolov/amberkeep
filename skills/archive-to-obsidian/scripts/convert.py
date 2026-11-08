#!/usr/bin/env python3
"""Convert a supplied Claude export into a new, offline Obsidian note folder.

Only the explicitly supplied ZIP, directory, or JSON file is read. There is no
network access, authentication, Claude account access, or existing-vault scan.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import unicodedata
from urllib.parse import quote
import zipfile


DEFAULT_MAX_BYTES = 1024 * 1024 * 1024
VERSION = "0.1.0"
DEFAULT_MAX_FILES = 20000
DEFAULT_MAX_JSON_BYTES = 100 * 1024 * 1024
DEVICE_NAMES = {"CON", "PRN", "AUX", "NUL"} | {
    f"{prefix}{number}" for prefix in ("COM", "LPT") for number in range(1, 10)
}
BAD_NAME = re.compile(r'[<>:"/\\|?*#\^\[\]\x00-\x1f\x7f]')
MESSAGE_KEYS = ("chat_messages", "messages")
MEMORY_KEYS = {"conversations_memory", "conversation_memory", "project_memories", "memory_files"}


class ConversionError(Exception):
    """Expected input or filesystem error, safe to show without a traceback."""


def json_text(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)


def text(value):
    if value is None:
        return ""
    return value if isinstance(value, str) else str(value)


def heading(value):
    value = " ".join(text(value).split())
    value = html.escape(value, quote=False)
    return re.sub(r'([\\`*_{}\[\]()#!|>~])', r'\\\1', value)


def transcript(value):
    """Retain Markdown as quoted data, with HTML and image embeds disabled."""
    value = html.escape(text(value), quote=False)
    value = re.sub(r"!\s*(?=\[)", r"\\!", value)
    return "\n".join("> " + line for line in value.splitlines()) or "> (empty)"


def fenced(value, language="json"):
    value = text(value)
    longest = max((len(run) for run in re.findall(r"`+", value)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{language}\n{value}\n{fence}"


def slug(value, limit=90):
    value = unicodedata.normalize("NFC", text(value))
    value = re.sub(r"[^\w .-]", "-", value, flags=re.UNICODE)
    value = re.sub(r"[ .-]+", "-", value).strip(".-_") or "record"
    if value.split(".")[0].upper() in DEVICE_NAMES:
        value = "record-" + value
    # Bytes, rather than code points, keep paths portable on common filesystems.
    while len(value.encode("utf-8")) > limit:
        value = value[:-1]
    return value.rstrip(".- ") or "record"


def portable_basename(value):
    if (not value or value.startswith(".") or value.endswith((".", " "))
            or BAD_NAME.search(value) or value.split(".")[0].upper() in DEVICE_NAMES
            or len(value.encode("utf-8")) > 180):
        raise ConversionError("Output names must be portable and cannot contain Windows or Obsidian special characters.")


def no_symlink(path):
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise ConversionError("Symlink paths are not supported.")


def absolute_path(value, *, destination=False):
    raw = Path(value)
    if destination and ".." in raw.parts:
        raise ConversionError("Destination paths cannot contain '..'.")
    path = Path(os.path.abspath(raw))
    no_symlink(path)
    return path


def inside(child, parent):
    return child == parent or parent in child.parents


def validate_paths(input_value, output_value, zip_value):
    source = absolute_path(input_value)
    output = absolute_path(output_value, destination=True)
    target_zip = absolute_path(zip_value, destination=True) if zip_value else None
    if not source.exists():
        raise ConversionError("Input does not exist.")
    for target in (output, target_zip):
        if target is None:
            continue
        portable_basename(target.name)
        if target.exists() or target.is_symlink():
            raise ConversionError("Output already exists; choose a new destination.")
        if not target.parent.is_dir():
            raise ConversionError("Destination parent folders must already exist.")
        if inside(source, target) or (source.is_dir() and inside(target, source)) or target == source:
            raise ConversionError("Input and output paths must not overlap.")
    if target_zip:
        if target_zip.suffix.lower() != ".zip":
            raise ConversionError("--zip must name a new .zip file.")
        if inside(target_zip, output) or inside(output, target_zip):
            raise ConversionError("The ZIP destination must be outside the note folder.")
    return source, output, target_zip


def validate_archive_path(name):
    if not name or "\\" in name or "\x00" in name or name.startswith("/"):
        raise ConversionError("Archive contains an unsafe path.")
    parts = name.rstrip("/").split("/")
    if any(part in ("", ".", "..") for part in parts) or re.match(r"^[A-Za-z]:", name):
        raise ConversionError("Archive contains an unsafe path.")
    return "/".join(parts)


@contextlib.contextmanager
def sources(source, max_bytes, max_files):
    """Yield validated (original path, byte size, opener) source entries."""
    entries = []
    source_kind = "directory"
    archive = None
    try:
        if source.is_dir():
            for root, dirs, files in os.walk(source, followlinks=False):
                dirs.sort()
                files.sort()
                for name in dirs + files:
                    child = Path(root) / name
                    if child.is_symlink():
                        raise ConversionError("Input directory contains a symlink.")
                for name in files:
                    child = Path(root) / name
                    if not stat.S_ISREG(child.stat().st_mode):
                        raise ConversionError("Input contains a non-regular file.")
                    entries.append((child.relative_to(source).as_posix(), child.stat().st_size,
                                    lambda p=child: p.open("rb")))
        elif source.is_file() and zipfile.is_zipfile(source):
            source_kind = "zip"
            archive = zipfile.ZipFile(source)
            if len(archive.infolist()) > max_files:
                raise ConversionError(f"Archive entries exceed --max-files ({max_files}); directory entries count too.")
            seen = set()
            for info in archive.infolist():
                original = validate_archive_path(info.filename)
                canonical = unicodedata.normalize("NFC", original).casefold()
                if canonical in seen:
                    raise ConversionError("Archive contains duplicate or aliased paths.")
                seen.add(canonical)
                if stat.S_ISLNK(info.external_attr >> 16):
                    raise ConversionError("Archive contains a symlink.")
                if info.flag_bits & 1:
                    raise ConversionError("Encrypted archives are not supported.")
                if not info.is_dir():
                    entries.append((original, info.file_size, lambda i=info: archive.open(i, "r")))
        elif source.is_file() and source.suffix.lower() == ".json":
            source_kind = "json"
            entries.append((source.name, source.stat().st_size, lambda: source.open("rb")))
        else:
            raise ConversionError("Input must be an export ZIP, a directory, or a JSON file.")
        if not entries:
            raise ConversionError("Input contains no files.")
        if len(entries) > max_files:
            raise ConversionError(f"Input exceeds --max-files ({max_files}).")
        if sum(size for _, size, _ in entries) > max_bytes:
            raise ConversionError(f"Expanded input exceeds --max-bytes ({max_bytes}).")
        yield source_kind, sorted(entries, key=lambda entry: entry[0])
    finally:
        if archive:
            archive.close()


def identifier(record, fallback):
    for key in ("uuid", "id", "conversation_uuid", "project_uuid", "account_uuid"):
        value = record.get(key)
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            return text(value)
    return fallback


def project_identifier(record):
    for key in ("project_uuid", "project_id"):
        if isinstance(record.get(key), (str, int)):
            return text(record[key])
    project = record.get("project")
    return identifier(project, "") if isinstance(project, dict) else ""


class Renderer:
    def __init__(self, staging, namespace):
        self.root = staging
        self.namespace = namespace
        self.files = []
        self.notes = []
        self.warnings = []
        self.counts = {key: 0 for key in (
            "source_files", "conversations", "messages", "projects", "memory_notes",
            "account_notes", "data_notes", "unknown_content_blocks",
            "attachment_metadata_messages", "raw_only_files")}
        self.relations = []
        self.projects = {}

    def wiki(self, path, label=None):
        name = path[:-3] if path.endswith(".md") else path
        alias = re.sub(r"[\[\]|\r\n]", " ", text(label or Path(name).name))
        return f"[[{self.namespace}/{name}|{html.escape(alias, quote=False)}]]"

    def note(self, folder, title, source_id, pointer, file_record, kind, body, record=None):
        digest = hashlib.sha256((file_record["original_path"] + "#" + pointer + "#" + source_id).encode()).hexdigest()[:12]
        path = f"{folder}/{slug(title)}--{digest}.md"
        target = self.root / path
        target.parent.mkdir(exist_ok=True)
        data = record or {}
        front = {
            "title": text(title), "source_id": source_id, "source_kind": kind,
            "created": data.get("created_at", data.get("created", "")),
            "updated": data.get("updated_at", data.get("updated", "")),
            "source_file": file_record["original_path"],
        }
        # Each JSON-encoded scalar is also a valid YAML value.
        lines = ["---"] + [key + ": " + json.dumps(value, ensure_ascii=False) for key, value in front.items()] + ["---", ""]
        raw_link = "../" + quote(file_record["raw_path"], safe="/")
        lines.extend([f"# {heading(title)}", "", body, "", "## Source", "",
                      f"[Original source bytes]({raw_link})", "",
                      self.wiki("Home.md", "Export index"), ""])
        target.write_text("\n".join(lines), encoding="utf-8")
        self.notes.append({"path": path, "kind": kind, "source_file": file_record["original_path"], "source_id": source_id})
        file_record["notes"].append(path)
        return path

    def conversation(self, record, pointer, file_record):
        source_id = identifier(record, pointer)
        title = text(record.get("name") or record.get("title") or f"Conversation {source_id}")
        message_key = next(key for key in MESSAGE_KEYS if isinstance(record.get(key), list))
        messages = record[message_key]
        body = ["Messages follow the order in the supplied export. Parent and branch metadata are preserved below; this view does not establish a single linear conversation.", ""]
        for index, message in enumerate(messages, 1):
            self.counts["messages"] += 1
            if not isinstance(message, dict):
                body.extend([f"## Message {index}", "", fenced(json_text(message)), ""])
                self.counts["unknown_content_blocks"] += 1
                continue
            speaker = message.get("sender") or message.get("role") or "unknown"
            timestamp = message.get("created_at") or message.get("timestamp") or ""
            body.extend([f"## {index}. {heading(speaker)}" + (f" — {heading(timestamp)}" if timestamp else ""), ""])
            direct = message.get("text")
            content = message.get("content")
            blocks = content if isinstance(content, list) else ([content] if content is not None else [])
            block_texts = [block["text"] for block in blocks if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str)]
            combined = "\n".join(block_texts)
            if isinstance(direct, str) and direct:
                if combined and direct != combined:
                    body.extend(["### Text field", ""])
                body.extend([transcript(direct), ""])
            elif direct is not None and not isinstance(direct, str):
                body.extend(["### Non-text text field", "", fenced(json_text(direct)), ""])
                self.counts["unknown_content_blocks"] += 1
            if blocks and not (isinstance(direct, str) and direct == combined and len(block_texts) == len(blocks)):
                if direct and combined and direct != combined:
                    body.extend(["### Content blocks", ""])
                for block in blocks:
                    if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                        if not (isinstance(direct, str) and direct and direct == combined):
                            body.extend([transcript(block["text"]), ""])
                    elif isinstance(block, str):
                        body.extend([transcript(block), ""])
                    else:
                        body.extend(["### Non-text content", "", fenced(json_text(block)), ""])
                        self.counts["unknown_content_blocks"] += 1
            if not direct and not blocks:
                body.extend(["> (No text field supplied.)", ""])
            metadata = {key: value for key, value in message.items() if key not in ("text", "content")}
            if metadata:
                body.extend(["### Message metadata", "", fenced(json_text(metadata)), ""])
            if message.get("attachments") or message.get("files"):
                self.counts["attachment_metadata_messages"] += 1
        for alternate_key in MESSAGE_KEYS:
            alternate = record.get(alternate_key)
            if alternate_key != message_key and isinstance(alternate, list) and alternate != messages:
                body.extend([f"## Additional message array: {alternate_key}", "", fenced(json_text(alternate)), ""])
                self.counts["messages"] += len(alternate)
                self.warnings.append(f"Conversation in {file_record['original_path']!r} has two different message arrays; the additional array is preserved as JSON in its note.")
        metadata = {key: value for key, value in record.items() if key not in MESSAGE_KEYS}
        body.extend(["## Conversation metadata", "", fenced(json_text(metadata))])
        path = self.note("Conversations", title, source_id, pointer, file_record, "conversation", "\n".join(body), record)
        self.counts["conversations"] += 1
        self.relations.append((path, project_identifier(record)))

    def project(self, record, pointer, file_record):
        source_id = identifier(record, pointer)
        title = text(record.get("name") or record.get("title") or f"Project {source_id}")
        body = "Project fields and document data present in the supplied JSON:\n\n" + fenced(json_text(record))
        path = self.note("Projects", title, source_id, pointer, file_record, "project", body, record)
        self.projects.setdefault(source_id, []).append(path)
        self.counts["projects"] += 1

    def memory(self, record, pointer, file_record):
        source_id = identifier(record, pointer)
        made = 0
        for key in ("conversations_memory", "conversation_memory"):
            if key in record:
                value = record[key]
                body = transcript(value) if isinstance(value, str) else fenced(json_text(value))
                self.note("Memory", "Conversation memory", source_id, pointer + "/" + key, file_record, "memory", body, record)
                made += 1
        projects = record.get("project_memories")
        if isinstance(projects, dict):
            for project_id, value in projects.items():
                body = transcript(value) if isinstance(value, str) else fenced(json_text(value))
                path = self.note("Memory", f"Project memory {project_id}", text(project_id), pointer + "/project_memories/" + text(project_id), file_record, "memory", body, record)
                self.relations.append((path, text(project_id)))
                made += 1
        elif projects is not None:
            self.note("Memory", "Project memories", source_id, pointer + "/project_memories", file_record, "memory", fenced(json_text(projects)), record)
            made += 1
        memory_files = record.get("memory_files")
        if isinstance(memory_files, list):
            for index, memory in enumerate(memory_files):
                title = text(memory.get("path") or memory.get("name") or f"Memory file {index + 1}") if isinstance(memory, dict) else f"Memory file {index + 1}"
                content = memory.get("content") if isinstance(memory, dict) else memory
                body = transcript(content) if isinstance(content, str) else fenced(json_text(content))
                if isinstance(memory, dict):
                    body += "\n\n## Memory file metadata\n\n" + fenced(json_text({key: value for key, value in memory.items() if key != "content"}))
                self.note("Memory", title, source_id, pointer + f"/memory_files/{index}", file_record, "memory", body, memory if isinstance(memory, dict) else record)
                made += 1
        elif memory_files is not None:
            self.note("Memory", "Memory files", source_id, pointer + "/memory_files", file_record, "memory", fenced(json_text(memory_files)), record)
            made += 1
        self.counts["memory_notes"] += made
        return made

    def scan(self, value, pointer, file_record, hint=""):
        if isinstance(value, list):
            for index, child in enumerate(value):
                self.scan(child, pointer + f"/{index}", file_record, hint)
        elif isinstance(value, dict):
            if any(isinstance(value.get(key), list) for key in MESSAGE_KEYS):
                self.conversation(value, pointer, file_record)
                return
            if MEMORY_KEYS.intersection(value):
                self.memory(value, pointer, file_record)
                # Remaining fields remain intact in Raw; nested conversations
                # are still discoverable without reinterpreting memory text.
                for key in ("conversations", "projects"):
                    if key in value:
                        self.scan(value[key], pointer + "/" + key, file_record, key.rstrip("s"))
                return
            if hint == "project" and any(key in value for key in ("uuid", "id", "name", "title")):
                self.project(value, pointer, file_record)
                if "conversations" in value:
                    self.scan(value["conversations"], pointer + "/conversations", file_record, "conversation")
                return
            for key, child in value.items():
                next_hint = "project" if key == "projects" else ("conversation" if key == "conversations" else "")
                self.scan(child, pointer + "/" + key.replace("~", "~0").replace("/", "~1"), file_record, next_hint)

    def render_json(self, value, file_record):
        before = len(self.notes)
        original = file_record["original_path"]
        stem = PurePosixPath(original).stem.lower()
        hint = "project" if stem == "projects" or "projects" in PurePosixPath(original).parts[:-1] else ""
        self.scan(value, "", file_record, hint)
        if len(self.notes) == before:
            if "memor" in stem:
                folder, kind, count = "Memory", "memory", "memory_notes"
            elif any(key in stem for key in ("user", "profile", "account")):
                folder, kind, count = "Account", "account", "account_notes"
            else:
                folder, kind, count = "Data", "data", "data_notes"
            self.note(folder, PurePosixPath(original).stem, original, "", file_record, kind,
                      "Fields from the supplied JSON, preserved as data:\n\n" + fenced(json_text(value)))
            self.counts[count] += 1

    def finish(self, input_metadata, limits):
        for path, project_id in self.relations:
            if not project_id or project_id not in self.projects:
                continue
            with (self.root / path).open("a", encoding="utf-8") as handle:
                handle.write("\n## Related project\n\n" + "\n".join("- " + self.wiki(item) for item in self.projects[project_id]) + "\n")
            for project_path in self.projects[project_id]:
                with (self.root / project_path).open("a", encoding="utf-8") as handle:
                    handle.write("\n- Related note: " + self.wiki(path) + "\n")
        if self.counts["attachment_metadata_messages"]:
            self.warnings.append("Attachment/file metadata occurs in messages. Original uploaded file bytes may be absent from Claude exports; no attachment URLs were fetched.")
        if self.counts["unknown_content_blocks"]:
            self.warnings.append("Some message content types have no dedicated renderer. Their complete supplied JSON is shown as data; original source bytes are also retained.")
        self.counts["source_files"] = len(self.files)
        manifest = {
            "schema_version": 1, "input": input_metadata, "namespace": self.namespace,
            "scope": "Only bytes supplied in this input; not an account-wide completeness claim.",
            "limits": limits, "counts": self.counts, "files": self.files,
            "notes": self.notes, "warnings": self.warnings,
        }
        (self.root / "manifest.json").write_text(json_text(manifest) + "\n", encoding="utf-8")
        groups = {}
        for note in self.notes:
            groups.setdefault(note["path"].split("/")[0], []).append(note)
        home = ["# Claude export index", "", "Views of the supplied archive. Source bytes and unsupported fields are preserved in Raw; consult the report before treating this as a complete account backup.", "",
                self.wiki("EXPORT-REPORT.md", "Export report"), ""]
        for group, notes in sorted(groups.items()):
            home.extend([f"## {group}", ""])
            home.extend("- " + self.wiki(note["path"]) for note in sorted(notes, key=lambda item: item["path"]))
            home.append("")
        (self.root / "Home.md").write_text("\n".join(home), encoding="utf-8")
        report = ["# Export report", "", "This report covers the supplied input only. Export schemas vary; original uploaded attachments and other account data may not be supplied by Claude. The converter never connects to Claude or downloads remote files.", "", "A rendered status means views were generated, not that every field has a dedicated Markdown view. Retained Raw files contain the original fields.", "", "## Counts", ""]
        report.extend(f"- {key}: {value}" for key, value in self.counts.items())
        report.extend(["", "## Warnings", ""])
        report.extend("- " + warning for warning in self.warnings)
        if not self.warnings:
            report.append("- No parsing warnings. This does not establish account completeness.")
        report.extend(["", "## Source files", "", "`manifest.json` maps every original path to a byte-identical Raw file with size and SHA-256. Raw files have a `.raw` suffix to keep imported Markdown and HTML from automatically rendering in Obsidian.", ""])
        for entry in self.files:
            report.append("- " + heading(entry["original_path"]) + " — " + entry["status"] + " — [source bytes](" + quote(entry["raw_path"], safe="/") + ")")
        report.extend(["", self.wiki("Home.md", "Export index"), ""])
        (self.root / "EXPORT-REPORT.md").write_text("\n".join(report), encoding="utf-8")
        return manifest


def load_json(path):
    duplicates = []
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                duplicates.append(key)
            result[key] = value
        return result
    def reject_constant(value):
        raise ValueError("Non-standard JSON numeric value")
    value = json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=pairs, parse_constant=reject_constant)
    # JSON permits escaped lone surrogates; UTF-8 Markdown cannot represent them.
    json_text(value).encode("utf-8")
    return value, len(duplicates)


def hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def exclusive_binary(path):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    return os.fdopen(descriptor, "wb")


def publish(staging, output):
    """Reserve the new destination exclusively; never replace an existing one."""
    output.mkdir(mode=0o700)
    made_files = []
    made_dirs = []
    try:
        for source in sorted(staging.rglob("*")):
            target = output / source.relative_to(staging)
            if source.is_dir():
                target.mkdir()
                made_dirs.append(target)
            else:
                with source.open("rb") as src, exclusive_binary(target) as dst:
                    made_files.append(target)
                    shutil.copyfileobj(src, dst)
    except BaseException:
        for item in reversed(made_files):
            item.unlink(missing_ok=True)
        for item in reversed(made_dirs):
            item.rmdir()
        output.rmdir()
        raise


def convert(input_path, output_path, zip_path=None, *, max_bytes=DEFAULT_MAX_BYTES,
            max_files=DEFAULT_MAX_FILES, max_json_bytes=DEFAULT_MAX_JSON_BYTES):
    if any(not isinstance(value, int) or value <= 0 for value in (max_bytes, max_files, max_json_bytes)):
        raise ConversionError("Resource limits must be positive integers.")
    source, output, target_zip = validate_paths(input_path, output_path, zip_path)
    limits = {"max_bytes": max_bytes, "max_files": max_files, "max_json_bytes": max_json_bytes}
    staged_zip = None
    published_output = False
    try:
        with sources(source, max_bytes, max_files) as (source_kind, entries):
            with tempfile.TemporaryDirectory(prefix=".export-stage-", dir=output.parent) as temporary:
                staging = Path(temporary)
                (staging / "Raw").mkdir()
                renderer = Renderer(staging, output.name)
                total = 0
                for original, declared_size, opener in entries:
                    name_hash = hashlib.sha256(original.encode("utf-8")).hexdigest()[:16]
                    raw_path = "Raw/" + name_hash + "-" + slug(PurePosixPath(original).name) + ".raw"
                    raw_target = staging / raw_path
                    digest = hashlib.sha256()
                    size = 0
                    with opener() as src, raw_target.open("xb") as dst:
                        for block in iter(lambda: src.read(1024 * 1024), b""):
                            size += len(block)
                            total += len(block)
                            if total > max_bytes:
                                raise ConversionError(f"Expanded input exceeds --max-bytes ({max_bytes}).")
                            digest.update(block)
                            dst.write(block)
                    if size != declared_size:
                        raise ConversionError("A source file changed size during conversion; retry with an unchanged export.")
                    entry = {"original_path": original, "raw_path": raw_path, "sha256": digest.hexdigest(), "size": size, "status": "raw-only", "notes": []}
                    renderer.files.append(entry)
                    if PurePosixPath(original).suffix.lower() == ".json":
                        if size > max_json_bytes:
                            renderer.warnings.append(f"JSON rendering limit exceeded for {original!r}; original bytes retained in Raw.")
                        else:
                            try:
                                value, duplicate_count = load_json(raw_target)
                                renderer.render_json(value, entry)
                                entry["status"] = "rendered"
                                if duplicate_count:
                                    renderer.warnings.append(f"Duplicate JSON object keys in {original!r}; views use their final values, while Raw retains the original bytes.")
                            except (ValueError, UnicodeError, RecursionError) as exc:
                                entry["status"] = "partially-rendered" if entry["notes"] else "raw-only"
                                renderer.warnings.append(f"Could not render JSON {original!r} ({type(exc).__name__}); original bytes retained in Raw.")
                    if not entry["notes"]:
                        renderer.counts["raw_only_files"] += 1
                input_metadata = {"kind": source_kind, "name": source.name}
                if source.is_file():
                    input_metadata["sha256"] = hash_file(source)
                manifest = renderer.finish(input_metadata, limits)
                if target_zip:
                    file_descriptor, temporary_zip = tempfile.mkstemp(prefix=".export-zip-", suffix=".tmp", dir=target_zip.parent)
                    os.close(file_descriptor)
                    staged_zip = Path(temporary_zip)
                    with zipfile.ZipFile(staged_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                        for path in sorted(staging.rglob("*")):
                            if path.is_file():
                                archive.write(path, arcname=output.name + "/" + path.relative_to(staging).as_posix())
                publish(staging, output)
                published_output = True
                if target_zip:
                    # Exclusive creation is intentional: os.replace could clobber
                    # a file another process created after path validation.
                    with staged_zip.open("rb") as src, exclusive_binary(target_zip) as dst:
                        try:
                            shutil.copyfileobj(src, dst)
                        except BaseException:
                            target_zip.unlink(missing_ok=True)
                            raise
                result = {"output": str(output), "counts": manifest["counts"], "warnings": len(manifest["warnings"])}
                if target_zip:
                    result["zip"] = str(target_zip)
                return result
    except BaseException:
        if published_output:
            shutil.rmtree(output)
        raise
    finally:
        if staged_zip:
            staged_zip.unlink(missing_ok=True)


def positive_integer(value):
    try:
        number = int(value)
        if number <= 0:
            raise ValueError
        return number
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=f"Amberkeep {VERSION}")
    parser.add_argument("--input", required=True, help="Supplied export ZIP, directory, or JSON file")
    parser.add_argument("--output", required=True, help="New note folder; its parent must exist")
    parser.add_argument("--zip", dest="zip_path", help="Optional new ZIP outside the note folder")
    parser.add_argument("--max-bytes", type=positive_integer, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--max-files", type=positive_integer, default=DEFAULT_MAX_FILES)
    parser.add_argument("--max-json-bytes", type=positive_integer, default=DEFAULT_MAX_JSON_BYTES)
    arguments = parser.parse_args(argv)
    try:
        result = convert(arguments.input, arguments.output, arguments.zip_path,
                         max_bytes=arguments.max_bytes, max_files=arguments.max_files,
                         max_json_bytes=arguments.max_json_bytes)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ConversionError, OSError, zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, UnicodeError) as exc:
        print("Export error: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
