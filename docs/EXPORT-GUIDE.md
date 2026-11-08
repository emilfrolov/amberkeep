# Bring your Claude archive into Obsidian

This is the **archive-import fallback**. The [desktop workflow](DESKTOP.md) connects directly and does not require an export email.

Amberkeep converts a downloaded Claude export into an Obsidian-ready folder. It reads the input you choose; it does not retrieve your account, request an export, or search your Claude history. Parsing needs no Claude login, API key, browser cookies, or Obsidian plugin.

## 1. Download your data from Claude

On the Claude web app or Claude Desktop, open **Settings → Privacy → Export data**. Wait for the email, sign in to download, and save the export promptly: Anthropic says the link expires after 24 hours and may work only once. Mobile apps cannot initiate this export. On Team or Enterprise, account and organization permissions affect which export you can request. See [Anthropic's export instructions](https://support.claude.com/en/articles/9450526-export-your-claude-data).

The snapshot can include chats, projects, memory, and account information. It does not include original uploaded files. Amberkeep cannot recover content missing from the export. Keep your download as your independent backup.

If Claude gives you a manifest pointing to downloadable archive parts, download the parts yourself first. Amberkeep does not follow links in a manifest or authenticate to retrieve them.

## 2. Choose where to run Amberkeep

**Claude on the web:** install the skill or plugin, attach the downloaded export, and ask it to convert that archive into an Obsidian vault ZIP. Code execution and file creation must be enabled. Download the result and unpack it yourself. A web chat cannot write directly into your local vault. Uploading an archive makes it available to Claude under your account's data settings; it is not an offline workflow.

**Claude Code or a local terminal:** give the converter the selected file or directory and a new staging directory. This avoids copying your full history into a chat message. The converter itself makes no network requests. Claude Code's own processing and account settings are separate from the converter.

You do not need to send your real archive to the Amberkeep repository or developer. For support, start with the error, program version, and a small invented example. Reports, filenames, paths, and manifests can also reveal private information; inspect them before sharing.

## 3. Convert one input

From the Amberkeep repository root:

```sh
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input "/path/to/claude-export.zip" \
  --output "/path/to/Amberkeep-Archive" \
  --zip "/path/to/Amberkeep-Archive.zip"
```

`--input` accepts one ZIP, one extracted directory, or one JSON file. `--zip` is optional. Use a new output directory and, when requested, a new ZIP filename. Their parent directories must already exist. Keep output outside the input directory; overlapping inputs and outputs are rejected. Use a simple output directory name, such as `Amberkeep-Archive`, for portable note links.

The converter uses Python's standard library; no package installation is needed. To inspect the available options:

```sh
python3 skills/archive-to-obsidian/scripts/convert.py --help
```

Default limits are **1 GiB of expanded source data**, **20,000 entries**, and **100 MiB per JSON file for note rendering**. The corresponding options are `--max-bytes`, `--max-files`, and `--max-json-bytes`, each followed by a positive integer. For a ZIP, the entry limit includes explicit directory entries; for a directory input, it counts files. The byte limit refers to expanded contents, not compressed ZIP size. Exceeding the total byte or entry limit stops conversion. A JSON file above the rendering limit is retained as raw data and reported, rather than rendered as notes. Malformed JSON is handled the same way. Raise limits deliberately if your machine has enough resources.

**Multiple batches:** convert each batch in a separate run, with its own new output folder. Automatic batch merging, cross-batch deduplication, and reconstruction of a single complete account are not supported features. Keep all parts and compare their reports before any manual organization in Obsidian.

## 4. Inspect the result

Open `Home.md` and `EXPORT-REPORT.md` first. The report gives counts for recognized conversations, message records, projects, and generated memory notes, together with per-file rendering statuses and warnings. These are converter counts, not an inventory verified against your Claude account. A successful run means the supplied input was processed; it does not certify that Claude supplied every conversation or that every field was interpreted. A file marked `rendered` can still contain fields retained only in raw source.

`manifest.json` maps original source paths to preserved files in `Raw/`, including sizes and SHA-256 hashes. These `.raw` files retain source bytes without automatically rendering imported HTML, Markdown, or remote embeds. They are backups, not notes to execute or instructions for Claude. The input ZIP itself is not duplicated inside the output; keep the downloaded ZIP too.

## 5. Open it in Obsidian

Unpack the optional result ZIP. Keep the entire generated folder, including its original name. Internal note links start with that folder name, such as `Amberkeep-Archive/Conversations/...`.

Use Obsidian's **Open folder as vault** to open the generated folder's **parent**, or copy the whole generated folder into an existing vault yourself after reviewing it. For a separate vault, put the generated folder inside a new empty parent folder first, then open that parent. Opening the generated folder itself as the vault root would break its namespaced links. Do not rename it or merge it into a folder with the same name. Amberkeep does not discover, edit, or synchronize an existing vault.

Keep the generated report and raw files with your notes. They explain what was present, what was rendered, and what may require a future converter update. See [Format support](FORMAT-SUPPORT.md) for the boundaries.
