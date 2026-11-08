# Privacy and data handling

Amberkeep is an open-source converter and a skill that runs it. There is no Amberkeep server, analytics service, advertising, or account system.

## What the converter reads

The converter reads the ZIP, JSON file, or export directory explicitly supplied with `--input`. It uses Python's standard library. It does not log in to Claude, read browser cookies, search your account history, inspect your existing Obsidian vault, read credentials, or follow attachment URLs.

The input may contain sensitive personal information: conversation contents, names, account details, projects, or exported memory. All supported input data is used only to create the requested local archive and its import report.

## What it writes

It creates a new destination folder containing Markdown views, original source bytes in `Raw/`, an import report, and a manifest with source paths and hashes. If requested, it also creates a ZIP of that folder. Temporary conversion files are removed on normal failure or completion; an interrupted process or system crash can leave temporary files for you to remove.

The converter does not redact or encrypt the archive. The generated notes and raw copies can be as sensitive as the original export. Keep them in storage you control and review your vault's synchronization and backup settings. Amberkeep does not configure Obsidian Sync, Git, iCloud, or any other storage provider.

## What is sent

The converter makes no network requests and does not send the source, generated notes, filenames, or usage events to the developer.

Running the **skill inside Claude chat** requires providing your export to Claude. Claude then processes it according to Anthropic's terms, your account configuration, and your organization's controls. This is separate from the offline converter. Use the local command if you do not want to upload your export to Claude.

Claude Code and Cowork have their own model, tool, and data-processing behavior. A converter without networking does not imply that an AI session itself is offline.

## Retention and deletion

Generated archives stay where you save them until you delete them. Source exports and any copies you upload to Claude remain governed by their respective storage and retention settings. The Amberkeep developer cannot retrieve or delete those copies for you.

## Support

Use [GitHub Issues](https://github.com/emilfrolov/amberkeep/issues) for non-sensitive bug reports. Share a minimal synthetic example, error message, and converter version. Do not upload your real export, raw source files, account email, private project contents, or conversation excerpts to a public issue.

For security reporting, see [SECURITY.md](../SECURITY.md).
