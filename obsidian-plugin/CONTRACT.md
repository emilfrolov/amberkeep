# Desktop implementation contract

Internal contracts for the Amberkeep desktop integration. All modules are CommonJS, testable with Node's built-in test runner; only the Obsidian entry point imports `obsidian`.

## Snapshot

```js
{
  version: 1, fetchedAt: 'ISO', complete: true, warnings: [],
  organizations: [{id, name}],
  conversations: [{id, organizationId, title, createdAt, updatedAt, projectId,
    messages: [{id, role, text, createdAt, parentId, raw}], raw}],
  projects: [{id, organizationId, title, description, instructions, updatedAt,
    documents: [{id, title, text, raw}], raw}],
  memories: [{id, organizationId, title, text, projectId, updatedAt, raw}]
}
```

UUIDs are string IDs, not paths. Preserve all returned message branches. `raw` retains supplied JSON; native snapshots do not claim byte-identical HTTP responses. Failed or partial scans retain previously cached records and set `complete:false` with warnings, never delete source notes.

## Client

`new ClaudeClient(fetchJson, options)` where `fetchJson(path, {signal}?)` performs an authenticated same-origin GET and throws an Error with numeric `status` for HTTP failure. Client exports `ClaudeClient` and its pure normalizers.

`await client.sync(previousSnapshotOrNull, {signal, organizationIds, onProgress})` returns the merged snapshot. `organizationIds` omitted means all accessible chat organizations; authorization failures are reported. Progress is `{phase, current, total, message}`. Incremental detail fetch uses source ID + `updatedAt`; missing timestamps always fetch.

## Knowledge engine

`listSources(snapshot)` returns `{id, title, kind, organizationId, hash, messages:[{id,role,text}], ...}` for conversations and supported project/memory material. Source IDs include organization and source UUID.

`buildGraph(snapshot, enrichments, {root:'Amberkeep',pathMap})` returns `{notes:[{id,path,title,kind,content}], nodes, edges, stats}`. Content is the generated note BODY, not frontmatter. New paths use readable titles plus stable ID suffixes; `pathMap` maps source IDs to validated existing paths so later title changes preserve links. Paths include the root. Graph uses real native wikilinks and message block anchors. No universal-home links in every note.

`validateKnowledge(payload, source)` validates and returns a normalized enrichment or throws. Payload:

```js
{sourceId, sourceHash,
 concepts:[{title, kind:'concept'|'decision'|'question'|'person'|'tool', summary,
   evidence:[{messageId,quote}]}],
 relations:[{from,to,type:'related_to'|'uses'|'depends_on'|'answers'|'supersedes'}]
}
```

Require current source hash, existing message IDs, and verbatim evidence quotations. No arbitrary output paths or unverified references. At most 30 concepts/source, 60 relations, evidence at least one item/concept. AI synthesis is labelled separately from source text and lexical suggestions.

Enrichments are an array of validated payloads, one current payload per source. Sources with no matching enrichment hash are pending; analysing one source never marks others complete.

## Vault writer

`new VaultWriter(vault, {root:'Amberkeep'})`, `await writer.writeNotes(notes)` returns `{created,updated,unchanged,conflicts,conflictPaths}`. Use `vault.create` and `vault.process`. Exact `amberkeep_id` ownership and generated-block hashes protect existing notes. Preserve text/frontmatter outside the block. If an owned generated block was edited, save a proposed version under `root/Conflicts/`, without overwriting it. Never delete files. Reject paths outside root and malformed IDs. No filesystem dependency in writer.

## Local MCP bridge

Obsidian binds an ephemeral port on `127.0.0.1`. A 32-byte random bearer token and endpoint are written with mode 0600 to `~/.amberkeep/connections/<sha256(canonical-vault-path)>.json`; the directory is mode 0700. This avoids per-application temporary-directory differences on macOS and keeps tokens outside synced vault settings. Desktop extension receives the explicitly selected vault directory and reads this connection file for each request. Reject non-loopback Host and requests with browser Origin. No CORS, no arbitrary file endpoints.

Authenticated routes: GET `/status`; POST `/sync`; POST `/cancel`; GET `/pending?limit=5`; GET `/sources/<encoded-source-id>?offset=0&limit=30000`; POST `/knowledge` with the payload above; POST `/open-graph`. Sync starts asynchronously. Source reads are paged and retain message IDs; list-pending does not expose all transcripts. Status distinguishes synchronized sources, analysed sources, pending sources, partial failures, and login required.

Source page response: `{sourceId, sourceHash, title, kind, messages:[{id,role,text}], offset, nextOffset, done}`. Offset/limit are character offsets over message text; page boundaries retain IDs. MCP clients read all pages before representing a source as fully analysed.

MCP tools mirror routes: `amberkeep_status`, `amberkeep_sync`, `amberkeep_list_pending`, `amberkeep_read_source`, `amberkeep_save_knowledge`, `amberkeep_open_graph`. No API key; Claude Desktop performs semantic extraction through those tools. Native login is a separate isolated Claude session and does not reuse Claude Desktop cookies.
