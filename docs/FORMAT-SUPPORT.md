# Format support and preservation

This guide covers the **archive-import fallback**. For native account sync and semantic notes, see [the desktop guide](DESKTOP.md) and [knowledge graph](KNOWLEDGE-GRAPH.md).

Amberkeep targets data already present in a user-supplied Claude export. Its readable notes are a view of that input, not a reconstruction of your account or a promise of complete historical recovery.

## Official scope versus observed schemas

Anthropic [documents the export's contents and how to request it](https://support.claude.com/en/articles/9450526-export-your-claude-data): chats, projects, memory, and account data are included; original uploaded files are excluded. The linked documentation does not publish a versioned JSON schema. Filenames and shapes below come from open-source authors' observations and implementations. They may change between exports and accounts.

| Observed source | Common shape | Readable result and boundary |
| --- | --- | --- |
| `conversations.json` | Array of conversations with `uuid`, `name`, dates, and `chat_messages`; sometimes `summary` and `account` | Conversation notes. Missing identifiers, dates, or project associations cannot be recovered from context. |
| `chat_messages` | Messages with `uuid`, `sender`, `text`, `content`, dates, `attachments`, and `files` | Transcript content and metadata. The input is the evidence; regenerated or deleted text absent from it cannot be recreated. |
| Message `content` | Typed blocks including `text`, `thinking`, `tool_use`, `tool_result`, and other types | Text where recognized; structured data retained when it cannot be rendered meaningfully. A raw block is not proof that a complete tool execution or reasoning trace was exported. |
| `attachments` and `files` | Attachment metadata may have `file_name`, `file_size`, `file_type`, and `extracted_content`; a file may have only its name | Present extracted text and metadata can be retained. Extracted text is not the original PDF, image, or other uploaded binary. |
| Artifact tool blocks | `tool_use` with `name: "artifacts"`; `input` may contain `id`, `title`, `command`, `content`, `language`, and `version_uuid` | Operations and their payloads can be preserved. Amberkeep does not execute artifact code or promise to rebuild the final runnable artifact. |
| `projects.json` or `projects/<uuid>.json` | Projects with name, description, `prompt_template`, dates, creator, and `docs` | Project notes, instructions, and document text when present. Document entries may contain `uuid`, `filename`, `content`, and `created_at`. |
| `memories.json` | Array of account objects; `conversations_memory` string; `project_memories` mapping project UUIDs to text; sometimes `memory_files` with `path`, `content`, and `updated_at` | Memory notes from exported values. A memory file's path is source metadata, not permission to write to that filesystem path. |
| `users.json` | Array of account records, including names, email addresses, identifiers, and sometimes phone metadata | Account notes from supplied fields. This information can be sensitive. |
| Other JSON, including unfamiliar conversation types | Any JSON object or array, with fields not recognized by a dedicated renderer | Generic data notes where possible, plus raw preservation. This does not mean the format has dedicated semantic support. |

Observation sources:

- [ClaudeExplorer's models](https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/Models.swift) describe conversations, messages, attachments, project documents, account records, and legacy memory objects.
- [Claude Chat Viewer schema notes](https://github.com/osteele/claude-chat-viewer/blob/main/docs/schemas.md) distinguish observed fields from optional fields not present in that author's samples, and describe artifact tool payloads.
- [Memhaul's real-export findings](https://github.com/Tempreon/memhaul/issues/9) report per-project JSON, structured memory files, `design_chats`, and multiple ZIP batches. Observation of a filename does not establish full support for that content type.

The table describes expected input families. Consult `EXPORT-REPORT.md` for what the converter actually recognized in a particular run. A supported filename can still contain an unfamiliar shape. The current renderers show project fields, document content, account records, attachment metadata, and non-text tool blocks as JSON inside notes rather than as separately reconstructed documents or artifacts.

The report and manifest count recognized conversation and message records, project records, generated memory notes, generic data notes, and raw-only files. They do not compare these totals with a live account. A `rendered` status means a view was produced for that source file; it does not mean every field received a dedicated view. Unmapped fields remain in the raw copy even when there is no individual warning about them.

## What raw preservation means

For an accepted input, source files are retained byte for byte under `Raw/`, using generated `.raw` filenames. The manifest records their original paths, lengths, and SHA-256 hashes. Unknown keys do not need a dedicated note renderer to remain in that backup. Unrecognized JSON can also appear as a fenced data note; malformed or oversized JSON remains raw-only with a report entry.

Raw files are not intended for automatic Markdown rendering or execution. Original paths and filenames are not trusted output paths. The archive may contain sensitive data even when the readable note looks harmless.

This is preservation of the supplied file contents, not of every ZIP-container detail. The original ZIP is not embedded in the output; retain it separately. Archive safety checks or total resource limits can reject an input, in which case do not treat the run as a completed backup. See [Export guide](EXPORT-GUIDE.md) for resource options.

## What Amberkeep cannot infer

- Whether the account export includes every chat you ever created, including deleted, unavailable, or organization-restricted content.
- Original uploads whose bytes are absent, or media only mentioned by filename or URL.
- Reliable conversation branches when parent/leaf metadata is absent.
- A conversation's project solely from a similar title, topic, or project memory.
- A complete runnable artifact or missing tool response from partial operations.
- Automatic merging or deduplication of multiple export batches. There is one input per run; use separate new output folders and inspect all reports.

Amberkeep does not download referenced URLs, retrieve your account, or query live Claude memory. In a web Claude session, the result is a downloadable archive ZIP. In Claude Code or a terminal, it is a local staging folder, optionally accompanied by a ZIP. Internal links include the generated folder's original name: open its parent as an Obsidian vault, or copy the entire generated folder into an existing vault. Neither workflow synchronizes an existing Obsidian vault.
