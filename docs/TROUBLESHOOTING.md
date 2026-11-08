# Troubleshooting

This page covers archive conversion. For direct sign-in, synchronization, and semantic analysis, see [desktop troubleshooting](DESKTOP.md).

## Claude cannot see the skill

Check that code execution is enabled and that your account or organization permits custom skills. Upload the release's **skill ZIP**, rather than the repository source ZIP. Its root contains exactly one `archive-to-obsidian/` folder with `SKILL.md`.

In Claude Code, open a new session after manual installation. If installed as a plugin, look for `/amberkeep:archive-to-obsidian` in the plugin manager or command picker.

## The converter refuses an output path

The output folder and optional ZIP must be new, and their parent folders must already exist. Keep them outside the input directory. Choose a portable, unique folder name without slashes, wikilink delimiters, or Windows-reserved names. Symbolic links are intentionally rejected for source and destination paths.

Rename an earlier output or choose a new destination. Amberkeep does not overwrite or merge into existing notes.

## I see raw files but fewer Markdown notes than expected

Read `EXPORT-REPORT.md`. Unsupported or oversized JSON may be retained as raw source without a dedicated Markdown view. Claude exports can change format, and a successful conversion does not mean that every field was recognized.

Keep the original export. Report the structural issue with a small **synthetic** example and the report's counts; never attach your real archive to a public issue.

## My original attachments are missing

Claude's official exports do not include the original files you uploaded. Amberkeep can preserve attachment metadata, available extracted text, and bytes actually present in the supplied input. It does not fetch missing files from URLs or reconstruct original PDFs and images from their extracted text.

## Internal links do not resolve

Keep the whole generated folder intact, including its original name. Links use that folder as a namespace so conversations with similar titles are less likely to collide with your other notes.

Open the **parent** folder as a vault or copy the generated folder into an existing vault. If you open the generated folder itself as the vault root, its namespaced links will no longer match the vault-relative paths.

If a folder of the same name already exists in your vault, rerun conversion with a unique output folder name before copying. Do not merge two archives with identical namespace names.

## The export has several ZIP batches

Convert each batch into a separate folder with a unique name. This release does not automatically combine batches, deduplicate conversations across exports, or synchronize later changes. A ZIP inside another ZIP is preserved as a source file, not recursively imported.

## The archive exceeds a limit

Run the converter with `--help` for the current limits and overrides. Total source bytes and file-count limits stop the import. A JSON file exceeding the JSON parsing limit is preserved raw with a warning rather than parsed into notes. Raise limits only when you have enough memory and disk space.

## An archive is rejected as unsafe

ZIP paths that escape the archive root, symbolic links, ambiguous paths, and conflicting source entries are rejected. Do not disable these checks to import an untrusted ZIP. Request a fresh official export or inspect a copy locally with tools you trust.

## A tool call or artifact is shown as JSON

That is source data, not a failed code execution. Amberkeep does not run exported tools or code. Artifact operations and versions may remain in message data; they are not promised as a rebuilt final application or artifact.
