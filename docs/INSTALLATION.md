# Install Amberkeep

Choose the skill for Claude chat, the community plugin for Claude Code, or the local Python command. All three use the same bundled converter. Amberkeep does not require an Anthropic API key, an Obsidian plugin, or an Obsidian account.

## Claude chat: skill ZIP

1. Download `amberkeep-skill-v0.1.0.zip` from the [latest release](https://github.com/emilfrolov/amberkeep/releases/latest).
2. In Claude, open **Customize → Skills**, choose **Add**, then **Upload a skill**. Interface labels can change; consult [Claude's custom-skill instructions](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills) if your account shows a different route.
3. Upload the ZIP without unpacking it. It contains one `archive-to-obsidian/` folder with `SKILL.md` and the converter.
4. Enable code execution and file creation if your account requires it. Organization administrators may restrict skills or code execution.
5. Attach your downloaded export and ask Amberkeep to convert it into a new Obsidian archive.

The chat version runs inside Claude's file workspace. It returns a ZIP for you to download; it does not write into Obsidian on your computer. Uploading an export to Claude shares it with Claude under your account's terms and privacy settings. Use local conversion for sensitive archives you want to keep on your computer.

## Claude Code: community marketplace

Run these commands inside Claude Code:

```text
/plugin marketplace add emilfrolov/amberkeep
/plugin install amberkeep@amberkeep-community
```

Then use `/amberkeep:archive-to-obsidian`, or ask to convert an export at an explicit local path. Python 3.10 or newer must be available to the local session.

This repository is its own community marketplace. Installing from it does not imply inclusion in Anthropic's official directory.

### Manual skill folder

Alternatively, copy `skills/archive-to-obsidian/` from this repository to either:

```text
~/.claude/skills/archive-to-obsidian/
```

or a project's:

```text
.claude/skills/archive-to-obsidian/
```

The copied folder must contain `SKILL.md`, `scripts/convert.py`, and `references/format-support.md`. Open a new Claude Code session after installing. Do not install both the standalone skill and the plugin unless you intentionally want duplicate skill entries.

## Plugin ZIP: manual testing

The release also includes `amberkeep-plugin-v0.1.0.zip`. On Claude surfaces that support plugin uploads, use **Customize → Plugins → Add → Upload plugin**. The ZIP contains one plugin folder with `.claude-plugin/plugin.json` and the skill. Surface support and organization settings vary; the standalone skill and local converter remain separate installation choices.

## Local terminal

```bash
git clone https://github.com/emilfrolov/amberkeep.git
cd amberkeep
python3 --version
python3 skills/archive-to-obsidian/scripts/convert.py --help
```

Use `python` or `py -3` instead of `python3` if that is how your Python installation is exposed. Python must be version 3.10 or newer. No `pip install` is necessary.

```bash
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input "/path/to/export.zip" \
  --output "/path/to/Claude-Archive" \
  --zip "/path/to/Claude-Archive.zip"
```

Choose a new output folder and ZIP in an existing parent directory. Keep them outside the input directory. The converter refuses to overwrite an existing destination.

## Update or uninstall

- Skill upload: replace the uploaded Amberkeep skill with the new release through Claude's skill settings.
- Claude Code plugin: refresh the marketplace and update `amberkeep@amberkeep-community` using Claude Code's plugin manager.
- Manual folder: replace the installed skill folder with the new version.
- Terminal: pull or download the new release.

Uninstalling the skill or plugin does not delete generated archives. You control their files and backups.
