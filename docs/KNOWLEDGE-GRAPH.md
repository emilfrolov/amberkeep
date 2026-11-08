# Understanding the knowledge graph

Amberkeep's desktop graph combines preserved source material with generated navigation and optional model analysis. These layers have different meanings. A dense graph alone does not establish that every connection is useful or supported by evidence.

## Three layers of connections

| Layer | How it is created | What it means |
| --- | --- | --- |
| Structural | The synchronized source identifiers and available project associations | A source belongs to a project or refers to another represented source. Missing associations are not inferred from similar titles. |
| Lexical | Recurring terms detected in synchronized text | A navigation suggestion based on shared wording. It is not a model's conclusion or a verified conceptual relationship. |
| Semantic | Claude Desktop or an explicitly configured local Ollama model reads a source and submits validated concepts and relationships | Model-generated synthesis linked to specific source quotations. It remains an interpretation that you can inspect. |

The graph uses Obsidian's native notes, wikilinks, and message block anchors. You can inspect source notes directly or use Obsidian's local graph to explore a smaller neighborhood. Amberkeep does not add a universal link to an index on every note just to make the graph appear connected.

## From synchronized sources to semantic notes

The Obsidian plugin first synchronizes accessible conversations and supported project and memory material. It retains the returned source JSON and makes stable source records available to the Claude Desktop companion.

In an active Claude Desktop session, the tools support this sequence:

1. `amberkeep_status` distinguishes synchronized sources, analysed sources, pending analysis, login requirements, and partial failures.
2. `amberkeep_sync` starts a source sync. The client checks status while the asynchronous operation runs.
3. `amberkeep_list_pending` selects a small set of sources whose current content does not have a matching semantic result.
4. `amberkeep_read_source` reads a source with message identifiers. Long sources are paged; the model must read all pages before describing its analysis as covering the complete source.
5. `amberkeep_save_knowledge` submits the concepts, relationships, source identifier, current source hash, and supporting quotations.
6. `amberkeep_open_graph` asks the connected Obsidian instance to open its graph.

These tools are available only when the Desktop extension is connected to an open vault with Amberkeep enabled. See the [desktop setup guide](DESKTOP.md).

As an alternative, an explicitly configured local Ollama model can process pending sources automatically after synchronization. It sends the complete source as data and submits its result to the same knowledge validator. No Claude Desktop chat is needed for that mode. See [automatic local analysis](DESKTOP.md#optional-automatic-semantic-analysis-with-a-local-model) for installation, inference limits, and the distinction between a loopback endpoint and an actually local model.

## What a semantic result contains

A concept can represent a **concept**, **decision**, **question**, **person**, or **tool**. It has a title, a model-written summary, and evidence referring to existing message IDs with verbatim quotations.

Supported relationship types are `related_to`, `uses`, `depends_on`, `answers`, and `supersedes`. They describe the model's proposed connections among the submitted concepts. They do not turn a shared word into a proven dependency or establish facts outside the synchronized source.

For each submitted source result, Amberkeep checks:

- The source identifier exists and the submitted hash matches its current content.
- Evidence refers to an existing message ID and contains a verbatim quotation from that message.
- Every concept includes evidence, and relationship references belong to the submitted concepts.
- The result stays within its limits: at most 30 concepts and 60 relationships for one source.

The model cannot supply arbitrary output paths or point evidence at an unrelated file. Source text, lexical suggestions, and model synthesis are labelled separately in generated notes.

Evidence validation establishes that a quoted passage exists in the current source. It does not prove that the model's summary or interpretation is correct. Follow the evidence links and review a decision or claimed relationship before relying on it.

## Resume analysis without losing track

Amberkeep associates one current semantic result with each source hash. Saving an analysis for one source does not mark other sources as complete.

When a source changes, its earlier result no longer matches the current hash and the source becomes pending again. A later Claude Desktop session can pick up the pending work. This makes a large history manageable across batches and sessions.

Source polling and model analysis are separate stages. With an explicitly configured local model, synchronization is followed by serial analysis of pending sources while Obsidian and the local inference service are running. Without that configuration, ask Claude Desktop to process pending sources when you want to extend or refresh the semantic layer.

Local analysis never deliberately truncates a source. A source above its 120,000-character serialized-input limit, an expired 120-second request, or an invalid response stays pending while other sources can continue. A global unavailable-model problem can stop the batch. The model's own context capacity and hardware requirements also matter; the client cannot establish model quality merely from a successful HTTP response. Use the paged Desktop workflow for sources that exceed local analysis limits.

An empty pending count means the currently represented sources have matching stored results. It does not certify that every conversation in your Claude account was retrievable or that every concept worth keeping was discovered.

## Stable notes and your edits

New filenames use readable titles and a stable ID suffix. A persistent path registry keeps the original path when Claude changes a conversation title or reorders records. For this preview, keep managed files in their generated locations; manually moving or renaming them in Obsidian is not tracked by the registry.

Managed notes have an Amberkeep ownership identifier and a generated block whose hash is checked before an update. Writing outside the block is preserved. If you edit inside the managed block, the writer leaves your version in place and saves a proposed replacement under the generated root's `Conflicts/` folder.

Amberkeep does not delete notes or silently resolve conflicting personal edits. Review proposed replacements yourself, and keep your own synthesis outside managed blocks when you want future updates to remain straightforward.

When a generated node no longer belongs to the current graph, its previous body is retained as literal text and tagged `amberkeep/stale`. The graph command excludes that tag. This preserves old interpretations for review without silently presenting them as current evidence.

## Reading sync and analysis status

Use the counts together rather than treating one number as a completeness badge:

- **Synchronized sources:** source records currently represented by the local snapshot.
- **Analysed sources:** sources with a stored semantic result matching their current content hash.
- **Pending sources:** current sources awaiting a matching result, including new or changed material.
- **Partial failures and warnings:** account access, retrieval, or processing problems that need attention before assuming a full scan.
- **Conflicts:** existing generated blocks whose changes were preserved instead of overwritten.

Native sync retains earlier cached records after a partial failure and does not automatically remove notes that disappear from later listings. Check timestamps and warnings when determining how current a source is.

## What this graph does not promise

The desktop integration uses an unsupported source API and is experimental. It cannot guarantee complete historical access, recover deleted source data or missing original attachments, or infer trustworthy relationships from unavailable messages.

The semantic graph is an inspectable working interpretation of available material. It is not a substitute for source evidence or a validated personal profile. Automatic local analysis requires a configured, available local model; the Claude Desktop alternative requires an active model session. Its cache and notes live in your selected vault; review your vault sync and backup settings as described in [desktop data handling](DESKTOP.md#data-and-privacy).
