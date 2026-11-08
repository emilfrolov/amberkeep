# Format support and import boundaries

This skill converts one explicitly supplied Claude export at a time. It runs
offline with Python's standard library. It does not access a Claude account,
memory tools, previous chats, email, remote attachment URLs, or an existing vault.

## Command

From the skill folder, run:

```sh
python3 scripts/convert.py --input "/path/export.zip" --output "/path/staging/Claude-Archive" --zip "/path/staging/Claude-Archive.zip"
```

`--input` accepts a ZIP, a directory, or a single `.json` file. `--output` is a
new directory. `--zip` is optional and must be a new `.zip` outside that directory.
Destination parent folders must already exist. Input and output cannot overlap.
Existing destinations are refused. Destination names must avoid Windows and
Obsidian special characters, device names, and trailing dots or spaces.

The command prints a small JSON result with output paths, counts, and the number
of warnings. Expected errors go to stderr and return a nonzero exit status.

## Recognized views

- Conversations with `chat_messages` or `messages`, including arrays or nested
  `conversations` wrappers. Each conversation gets a Markdown note with message
  speakers, timestamps, text, and metadata. Different simultaneous message arrays
  are preserved separately, with a warning.
- Projects in `projects` containers, `projects.json`, or JSON files under a
  `projects/` directory. Supplied project IDs connect related conversation and
  memory notes when matching records are present.
- Memory records containing `conversations_memory`, `conversation_memory`,
  `project_memories`, or `memory_files`. Other memory JSON gets a readable data
  view when its filename identifies it as memory.
- Account, user, and profile JSON, plus other valid JSON as readable data notes.
- Unknown message content blocks as literal JSON, without executing them.

These are best-effort recognizers, not a guaranteed official export schema.
Message order follows the supplied export. Parent and branch metadata remain
available; the rendered sequence does not prove one linear conversation.
HTML and automatic image or Obsidian embeds in transcript text are suppressed.

## Output and retained originals

The output contains `Home.md`, `EXPORT-REPORT.md`, `manifest.json`, and applicable
note folders: `Conversations/`, `Projects/`, `Memory/`, `Account/`, and `Data/`.

Every supplied source file is retained byte-for-byte under `Raw/`. Filenames are
mapped to portable names with a `.raw` suffix so imported Markdown or HTML does
not automatically render in Obsidian. `manifest.json` records the original path,
mapped path, size, SHA-256, status, and generated note paths. Restore an original
filename manually using this mapping when needed. The input ZIP itself is not
duplicated in the output; its SHA-256 is recorded, and its contained files are
retained in `Raw/`.

A source status of `rendered` means that recognizable views or a generic JSON
view were produced. It does **not** mean every original field has a dedicated
Markdown view. Unknown fields remain in the retained source bytes. A
`partially-rendered` status reports an interrupted view conversion; `raw-only`
means no Markdown view was generated for that source file. Review the report and
manifest, including warnings, before relying on the result.

Original uploaded attachments may be absent from Claude's export. Available
source bytes are retained; attachment metadata is not a substitute for a file,
and the converter never downloads a missing attachment. Multiple archive batches
are separate runs; the script does not transparently merge them.

## Resource limits

| Flag | Default | Behavior |
| --- | --- | --- |
| `--max-bytes` | `1073741824` (1 GiB) | Maximum total expanded source bytes; exceeding it fails the run. |
| `--max-files` | `20000` | Maximum files for a directory, or all ZIP entries including explicit directories; exceeding it fails the run. |
| `--max-json-bytes` | `104857600` (100 MiB) | Maximum bytes in one JSON file for rendering; larger JSON is retained in `Raw/` with a warning. |

All limits must be positive integers. Malformed or unsupported JSON is also
retained in `Raw/` with a warning. Unsafe archive paths, symlinks, encrypted ZIPs,
and duplicate or aliased ZIP paths are rejected. Files are staged before a new
destination is created exclusively; the whole folder does not appear atomically.

## Manual Obsidian import

Copy the **whole output folder**, for example `Claude-Archive/`, into an existing
Obsidian vault. Alternatively, put it in a new empty parent folder and open that
parent folder as a new vault. Open `Claude-Archive/Home.md` inside Obsidian.

Wikilinks include the output folder name as a namespace. Keep that folder name
and structure. Opening `Claude-Archive/` itself as the vault root, flattening its
contents into a vault root, or renaming it breaks those paths unless the links
are updated.

The result covers only the supplied input. Neither successful conversion nor an
empty warning list establishes that all account data was exported or retained
by Claude.
