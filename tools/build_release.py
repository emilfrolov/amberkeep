#!/usr/bin/env python3
"""Build distributable Amberkeep ZIPs from an explicit, public-file allowlist."""

from __future__ import annotations

import hashlib
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "archive-to-obsidian"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def files_in(path: Path):
    if path.is_symlink():
        raise ValueError(f"Refusing a symlink in release input: {path.name}")
    if path.is_file():
        yield path
        return
    if not path.is_dir():
        raise ValueError(f"Missing release input: {path.relative_to(ROOT)}")
    for item in sorted(path.rglob("*")):
        if item.is_symlink():
            raise ValueError(f"Refusing a symlink: {item.relative_to(ROOT)}")
        if "__pycache__" in item.parts or item.suffix == ".pyc":
            continue
        if item.is_file():
            yield item


def write_zip(path: Path, entries):
    temporary = path.with_suffix(".zip.tmp")
    if path.is_symlink() or temporary.is_symlink():
        raise ValueError("Refusing a symlink in release output")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for source, destination in sorted(entries, key=lambda pair: pair[1]):
                info = zipfile.ZipInfo(destination, FIXED_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, source.read_bytes())
        with zipfile.ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise ValueError("Release ZIP integrity check failed")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--desktop', action='store_true', help='Include prebuilt Obsidian and Claude Desktop distributions')
    options = parser.parse_args()
    manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if manifest["name"] != "amberkeep" or not all(c in "0123456789." for c in version):
        raise ValueError("Unexpected plugin name or release version")
    for required in (SKILL / "SKILL.md", SKILL / "scripts" / "convert.py", SKILL / "references" / "format-support.md", ROOT / "assets" / "icon.png", ROOT / "assets" / "amberkeep-hero.png"):
        if not required.is_file() or required.is_symlink():
            raise ValueError(f"Missing or unsafe release file: {required.relative_to(ROOT)}")
    destination = ROOT / "dist"
    if destination.is_symlink():
        raise ValueError("Refusing symlinked dist directory")
    destination.mkdir(exist_ok=True)

    skill_entries = [(file, "archive-to-obsidian/" + file.relative_to(SKILL).as_posix()) for file in files_in(SKILL)]
    skill_entries.append((ROOT / "LICENSE", "archive-to-obsidian/LICENSE"))
    skill_path = destination / f"amberkeep-skill-v{version}.zip"
    write_zip(skill_path, skill_entries)

    plugin_entries = []
    for name in ("README.md", "LICENSE", "CHANGELOG.md", "COMMUNITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SUPPORT.md", "SECURITY.md", "docs", "assets", "skills", "examples", "tests", "tools"):
        for file in files_in(ROOT / name):
            plugin_entries.append((file, "amberkeep/" + file.relative_to(ROOT).as_posix()))
    plugin_entries.append((ROOT / ".claude-plugin" / "plugin.json", "amberkeep/.claude-plugin/plugin.json"))
    plugin_path = destination / f"amberkeep-plugin-v{version}.zip"
    write_zip(plugin_path, plugin_entries)

    demo_path = destination / f"amberkeep-demo-v{version}.zip"
    with tempfile.TemporaryDirectory(prefix="amberkeep-release-") as temporary:
        demo_output = Path(temporary) / "Amberkeep-Demo"
        result = subprocess.run([
            sys.executable, str(SKILL / "scripts" / "convert.py"),
            "--input", str(ROOT / "examples" / "demo-export"),
            "--output", str(demo_output),
        ], check=True, capture_output=True, text=True)
        summary = json.loads(result.stdout)
        write_zip(demo_path, [(file, "Amberkeep-Demo/" + file.relative_to(demo_output).as_posix()) for file in sorted(demo_output.rglob("*")) if file.is_file()])

    outputs = [skill_path, plugin_path, demo_path]
    desktop_demo = None
    if options.desktop:
        native = ROOT / 'obsidian-plugin'
        for name in ('main.js', 'manifest.json', 'styles.css'):
            if not (native / name).is_file():
                raise ValueError('Build the Obsidian plugin before --desktop')
        native_path = destination / f'amberkeep-obsidian-v{version}.zip'
        write_zip(native_path, [(native / name, 'amberkeep/' + name) for name in ('main.js', 'manifest.json', 'styles.css')] + [(ROOT / 'LICENSE', 'amberkeep/LICENSE')])
        extension = ROOT / 'desktop-extension' / 'dist' / 'amberkeep-desktop.mcpb'
        if not extension.is_file() or extension.is_symlink():
            raise ValueError('Build the Claude Desktop extension before --desktop')
        extension_path = destination / f'amberkeep-desktop-v{version}.mcpb'
        if extension_path.is_symlink():
            raise ValueError('Refusing a symlink in release output')
        extension_path.write_bytes(extension.read_bytes())
        knowledge_path = destination / f'amberkeep-knowledge-demo-v{version}.zip'
        with tempfile.TemporaryDirectory(prefix='amberkeep-knowledge-demo-') as temporary:
            knowledge_output = Path(temporary) / 'Amberkeep-Demo'
            result = subprocess.run(['node', str(ROOT / 'tools' / 'build_knowledge_demo.js'), '--output', str(knowledge_output)], check=True, capture_output=True, text=True)
            desktop_demo = json.loads(result.stdout)
            write_zip(knowledge_path, [(file, 'Amberkeep-Demo/' + file.relative_to(knowledge_output).as_posix()) for file in sorted(knowledge_output.rglob('*')) if file.is_file()])
        outputs.extend([native_path, extension_path, knowledge_path])
    checksums = "".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in outputs)
    (destination / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")
    print(json.dumps({"version": version, "files": [path.name for path in outputs] + ["SHA256SUMS.txt"], "demo": summary, "knowledge_demo": desktop_demo}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, KeyError) as error:
        print(f"Release build failed: {error}", file=sys.stderr)
        raise SystemExit(1)
