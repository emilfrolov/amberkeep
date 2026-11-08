# Amberkeep for Claude Desktop

This companion gives Claude Desktop the tools to build an evidence-linked knowledge graph in Obsidian. It works with the **Amberkeep Obsidian plugin**: the plugin synchronizes history, and Claude analyses that history through these tools when you ask.

No API key is required. This extension does not read Claude Desktop cookies or macOS Keychain entries. It connects only to the authenticated loopback bridge for the vault you choose.

## Set up once on macOS

1. Install and enable the Amberkeep Obsidian plugin in your vault, then keep that vault open.
2. In the plugin, connect the same Claude account you use in Claude Desktop. This is a separate, isolated login; your existing Desktop login is not automatically shared.
3. Download `amberkeep-desktop.mcpb` from the Amberkeep release and double-click it to install the local extension in Claude Desktop. Review the requested configuration and tools. Your account or organization may restrict local extensions.
4. Choose the **vault directory**, not its `.obsidian` subdirectory, when prompted. The extension uses Claude Desktop's Node runtime, so normal installation needs no terminal setup or package installation.
5. Allow the Amberkeep tools in the conversation where you want to build your knowledge graph.

If your Claude Desktop version does not open the bundle directly, use its **Settings → Extensions** interface to install the local `.mcpb` file.

## Ask Claude to build the graph

For example:

> Use Amberkeep to synchronize my Claude history and build its knowledge graph in Obsidian. Process pending sources in batches. Extract useful concepts, decisions, tools, people, and open questions; connect them and keep quotations linking each claim to its source. Show me how many sources remain when you stop.

Claude can check synchronization progress, read source pages, and save grounded knowledge. The tools require the current source hash and exact message quotations. A source must have been read completely in the current MCP connection before its analysis can be saved.

**History synchronization and semantic analysis are different operations.** The plugin can synchronize history automatically; it does not independently run Claude's model. Model analysis occurs in the Claude Desktop conversation using these tools, subject to that session's context, tool approvals, and usage limits. Large histories may need several batches or a later request to continue.

To resume:

> Continue analysing the pending Amberkeep sources. Keep already completed sources and tell me the remaining count.

Do not treat a graph as a verified inventory of every fact you ever discussed. It contains sources that were actually accessible and the analysis actually completed. AI synthesis remains an interpretation, even when accompanied by genuine supporting quotations.

## Tools

| Tool | Purpose |
| --- | --- |
| `amberkeep_status` | Check connection, login, sync progress, and analysis counts |
| `amberkeep_sync` | Start incremental history synchronization in Obsidian |
| `amberkeep_list_pending` | Find sources whose current version still needs analysis |
| `amberkeep_read_source` | Read a source in pages, with stable message IDs and its current hash |
| `amberkeep_save_knowledge` | Submit grounded concepts, decisions, questions, and relationships |
| `amberkeep_open_graph` | Open the graph in Obsidian |

These tools do not expose arbitrary filesystem reads or writes. Knowledge notes are validated and written by the Obsidian plugin in its managed area.

## Privacy

When Claude reads a source through a tool, the source text is sent into your Claude Desktop conversation and processed under your Claude account's policies. Choose an appropriate account and review tool permissions before analysing sensitive history. The developer does not receive the contents.

The vault selection is stored as extension configuration. The plugin writes a local connection file containing a random bearer token under `~/.amberkeep/connections/`, outside the synced vault. The directory is owner-only and the connection file has owner-only permissions; its filename is a hash of the canonical vault path. This per-user location works even when Obsidian and Claude Desktop have different temporary directories. The token is not a Claude credential. Every tool request reloads the connection file and is hard-coded to `127.0.0.1`; redirects and external hosts are rejected.

## Troubleshooting

- **“Open the selected vault…”**: open that vault in Obsidian and enable or reload Amberkeep. The plugin must be running.
- **Connection expired**: reload the Obsidian plugin, then retry. No token needs to be copied manually.
- **Wrong vault**: update the vault directory in the Desktop extension's configuration.
- **Source changed**: read its current pages again and regenerate the analysis. The old hash is intentionally refused.
- **“Read every source page…”**: start at offset `0` and follow `nextOffset` until `done` is true in the current MCP connection. This prevents treating one excerpt as a complete long source.
- **Login or collection warning**: resolve it in the Obsidian plugin. A partial collection must not be described as a complete migration.

## Develop or inspect

From this directory, with Node 18 or newer:

```bash
npm ci
npm test
npm run build
```

`npm run verify` also runs a real MCP stdio smoke test against the built standalone server.

The build uses the official MCP SDK and Anthropic's MCPB packer, bundles the server into a readable standalone `dist/server.js`, validates the manifest, and creates `dist/amberkeep-desktop.mcpb`. Runtime npm installation is not needed. The bundle contains dependency notices and this project's MIT license.

The tests use synthetic sources, a local mock Obsidian bridge, and a real MCP stdio client. They do not establish successful live Claude sign-in or compatibility with your installed macOS applications.
