<p align="center">
  <img src="assets/amberkeep-hero.png" alt="Amberkeep — preserve your conversations in an archive you own" width="100%">
</p>

<p align="center">
  <a href="https://github.com/emilfrolov/amberkeep/actions/workflows/tests.yml"><img src="https://github.com/emilfrolov/amberkeep/actions/workflows/tests.yml/badge.svg" alt="Tests"></a>
  &nbsp; Python 3.10+ &nbsp;·&nbsp; MIT &nbsp;·&nbsp; No dependencies
</p>

<h1 align="center">Amberkeep</h1>
<p align="center"><strong>Your conversations, preserved.</strong><br>Turn a Claude data export into a linked Obsidian archive.</p>
<p align="center">
  <a href="https://github.com/emilfrolov/amberkeep/releases/latest">Download</a> ·
  <a href="docs/INSTALLATION.md">Installation</a> ·
  <a href="docs/EXPORT-GUIDE.md">Export guide</a> ·
  <a href="docs/PRIVACY.md">Privacy</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

---

Long conversations deserve a life beyond a chat window. Amberkeep turns the data you download from Claude into Markdown you can browse, link, search, and keep in Obsidian.

Install it as a Claude skill, use it as a Claude Code plugin, or run the same converter directly with Python. The converter has **no third-party dependencies, no network requests, and no telemetry**.

> **Early release:** Amberkeep imports the data present in the export you provide. It cannot retrieve deleted conversations, recover files missing from the export, or guarantee that every export variant has a dedicated Markdown view. Every accepted source file is preserved byte for byte, and the import report explains recognition gaps.

## What you get

| From your export | In your Obsidian archive |
| --- | --- |
| Conversations and messages | A note per conversation, speaker labels, timestamps, and a linked index |
| Projects | Project notes and available project document content |
| Exported memory | Notes for available conversation memory, project memory, and memory files |
| Account data and other JSON | Readable data notes and the original source |
| Tool calls, artifacts, and unfamiliar content | Preserved source data; supported content rendered without executing it |
| Every source file | Original bytes in `Raw/`, with a path map and SHA-256 hashes |

Amberkeep creates a **new folder** and can produce a ZIP. You choose whether to open it as a separate vault or copy the entire folder into an existing vault. It never updates your existing notes or installs an Obsidian plugin.

## Start here

### 1. Download your Claude data

In Claude on the web or desktop, open **Settings → Privacy → Export data**. Download the export using the link sent to your account email. See the [export guide](docs/EXPORT-GUIDE.md) for account restrictions and export limitations.

### 2. Choose how to run Amberkeep

**Claude chat — upload a skill**

1. Download `amberkeep-skill-v0.1.0.zip` from [Releases](https://github.com/emilfrolov/amberkeep/releases/latest).
2. In Claude, open **Customize → Skills → Add → Upload a skill** and upload the ZIP. Enable code execution and file creation if required by your account.
3. Attach the data export and ask:

   > Use Amberkeep to convert this Claude export into an Obsidian archive. Include all conversations, projects, and exported memory. Keep the original source data and give me the ZIP and import report.

Uploading your archive to Claude shares its contents with Claude under your account's settings. Use the local option below if you want to keep conversion on your computer.

**Claude Code — install the community plugin**

```text
/plugin marketplace add emilfrolov/amberkeep
/plugin install amberkeep@amberkeep-community
```

Then ask Amberkeep to convert the export at an explicit local path, or invoke `/amberkeep:archive-to-obsidian`. The marketplace above is this repository's community listing; Amberkeep is independently published.

**Terminal — run locally**

Requires Python 3.10 or newer. No package installation is needed.

```bash
git clone https://github.com/emilfrolov/amberkeep.git
cd amberkeep
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input "/path/to/claude-export.zip" \
  --output "/path/to/Claude-Archive" \
  --zip "/path/to/Claude-Archive.zip"
```

The output folder and ZIP must not already exist; their parent folders must exist. An extracted export directory or a single JSON file is also accepted. For additional options, run the command with `--help`.

### 3. Open the archive in Obsidian

Unzip the result if necessary. Open its parent folder as a vault, or copy the **whole generated folder** into your vault. Preserve its name and internal structure so the namespaced links keep resolving. Begin with the generated index and read `EXPORT-REPORT.md` before discarding any source data.

## Try it without personal data

The repository includes a small [synthetic export](examples/demo-export). It contains invented conversations, a project, memory, account data, and an unfamiliar content block.

```bash
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input examples/demo-export \
  --output /tmp/Amberkeep-Demo \
  --zip /tmp/Amberkeep-Demo.zip
```

Example requests:

- “Convert this export into a new Obsidian archive and show the conversation and message counts.”
- “Import the project notes and exported memory too, and tell me what was only preserved as raw data.”
- “Build the archive locally from `/path/to/export.zip`; save it in a new folder and give me the import report.”

## Designed to preserve, not guess

Claude's export format can change, and Anthropic does not publish a stable export schema. Amberkeep recognizes observed formats and retains the original bytes alongside the Markdown views. See [format support](docs/FORMAT-SUPPORT.md) for the difference between supported rendering and source preservation.

- Missing or unsupported data is reported rather than silently advertised as restored.
- Original uploaded files are generally absent from Claude exports. Attachment descriptions and extracted text are not the original files.
- Imported code, tools, and artifact content are treated as data. The converter does not execute them or fetch attachment URLs.
- Multiple export batches are processed separately; this release does not merge or synchronize archives.

## Documentation

- [Installation and manual skill setup](docs/INSTALLATION.md)
- [Getting your export and moving it into Obsidian](docs/EXPORT-GUIDE.md)
- [Supported formats and limitations](docs/FORMAT-SUPPORT.md)
- [Privacy and data handling](docs/PRIVACY.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Development

```bash
python3 -m unittest discover -s tests -v
python3 tools/build_release.py
```

Release archives are written to `dist/`. The skill ZIP contains the skill folder; the plugin ZIP contains the plugin and documentation. Neither includes personal exports or generated archives.

The initial release is verified with synthetic fixtures and Claude Code's plugin validator. A real-account export and a live Claude chat/Cowork session have not been validated. Compatibility reports using minimal synthetic reproductions are welcome.

## License and affiliation

[MIT](LICENSE). Created by [emilfrolov](https://github.com/emilfrolov).

Amberkeep is an independent community project. It is not affiliated with or endorsed by Anthropic or Obsidian. Claude and Obsidian are trademarks of their respective owners.
