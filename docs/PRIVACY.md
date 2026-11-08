# Privacy and data handling

Amberkeep has two workflows: an experimental desktop integration that connects to Claude, and an offline converter for a supplied export. There is no Amberkeep-operated server, telemetry, analytics, or developer account system. The desktop workflow is not an offline workflow.

## Desktop data flow

| Operation | Data and destination |
| --- | --- |
| Connect Claude | You sign in on Claude's website inside an isolated persistent Obsidian webview session. |
| Synchronize history | Authenticated read-only GET requests retrieve accessible source data from `claude.ai` through that session. |
| Write the graph | Source notes, model summaries, and evidence links are written inside your selected vault. |
| Analyse with Claude Desktop | Requested source pages and metadata enter your current Claude Desktop conversation under your account's terms and settings. |
| Analyse with a local model | Complete eligible source text is sent to the loopback Ollama service you explicitly configure. |

Direct collection uses Claude's unsupported website API. It does not establish account-wide completeness, and native snapshots are not byte-identical HTTP-response archives. Interactive sign-in itself follows Claude's normal authentication flow; the source collector does not create or edit your chats.

## Authentication

The plugin keeps a separate persistent browser partition in Obsidian's browser profile. It does not read Claude Desktop cookies, import another browser's profile, or access macOS Keychain credentials. Claude authentication cookies stay outside the vault and are not stored in synced plugin settings.

Enter login credentials and one-time codes only in Claude's own sign-in interface. Do not paste them into a chat, issue, plugin setting, or support attachment. Some identity providers block embedded login; the preview cannot guarantee support for those accounts.

**Disconnect** cancels active work and disables automatic synchronization. It also tries to clear only the plugin's isolated cookie store when the host exposes the required session API. If that API is unavailable, the interface reports that the session may remain signed in on reconnect. You can sign out through Claude in the plugin's own sign-in panel. Amberkeep does not clear another application's credentials.

## Storage in your vault

The default generated-note root is `Amberkeep/`. It contains synchronized source text, lexical suggestions, model synthesis, and evidence quotations. Private material can therefore appear in note titles, links, graph labels, and search results.

The plugin directory, normally `.obsidian/plugins/amberkeep/`, also stores:

- `snapshot.json`: synchronized and normalized source records, including returned JSON retained with supported records.
- `knowledge.json`: accepted semantic results and their evidence.
- `graph-index.json`: generated-note identities and paths used to maintain graph updates.
- `data.json`: plugin settings such as the generated folder, sync interval, connection-enabled flag, and optional local-model configuration.

These files are not encrypted or redacted by Amberkeep. Your vault sync, Git repository, backups, or other Obsidian plugins may have access to them according to their own configuration. Review those settings before connecting sensitive history. The developer cannot retrieve or delete your local copies.

Updates preserve user text and frontmatter outside identified generated blocks. If an owned block has changed, a proposed replacement is saved under the generated root's `Conflicts/` folder. Source disappearance or a partial scan does not automatically delete existing notes. Older graph material may be retained and labelled stale instead of remaining a current asserted connection.

## The local Desktop bridge

When Obsidian's plugin is running, it opens an ephemeral port on `127.0.0.1`. A random bearer token and that port are written to:

```text
~/.amberkeep/connections/<canonical-vault-path-hash>.json
```

The connection directory is restricted to the local user with mode `0700`; the connection file uses mode `0600`. It lives outside the vault. The token is a local bridge credential, not a Claude session token. Do not share the connection file.

The Claude Desktop companion reads this file for the vault you explicitly selected. The bridge rejects browser-origin requests, requires its token, and does not enable CORS or expose arbitrary filesystem endpoints. Normal plugin shutdown closes the bridge and removes its own active connection file. Other processes running as your local user remain within your computer's trust boundary.

## Model processing

### Claude Desktop

Reading a source through an MCP tool makes the requested text and metadata available to the current Claude session. Anthropic's terms, account configuration, organization controls, tool approvals, and retention rules govern that processing. The bridge's loopback transport does not make the model session offline.

### Optional local Ollama model

This option is disabled until you select an installed model. Amberkeep accepts loopback HTTP(S) addresses with an explicit port and rejects remote endpoints, credentials in the address, and known cloud-model identifiers. It does not install or download a model.

A separately configured inference service can have its own logging, retention, and routing behavior. A loopback address alone does not prove that inference remains on your computer. Use an actual local model and review Ollama's configuration. Source and response limits can leave material pending rather than silently analysing a prefix.

## Offline archive conversion

The separate Python converter reads only the ZIP, JSON file, or directory you explicitly supply. It makes no network requests, uses no credentials, and creates a new output rather than scanning or updating your existing vault. Accepted source files are copied byte for byte into `Raw/`, with their paths, sizes, and SHA-256 hashes recorded in a manifest.

Its output and optional ZIP can be as sensitive as the original export. If you run the archive skill inside Claude and upload an export, Claude receives that input under your account's settings; only local terminal conversion keeps that conversion independent of an AI session.

## Stop, remove, and get help

Disconnecting stops collection but does not erase the cache, generated notes, or text already provided to a model. Disable the Obsidian plugin to close the local bridge, and disable or remove the Desktop companion if you no longer want its tools available. Delete local cache and generated material yourself when appropriate, while preserving personal notes and any backups you intend to keep. Claude's own retention and deletion controls apply to data already processed there.

Use [GitHub Issues](https://github.com/emilfrolov/amberkeep/issues) for non-sensitive reports with invented examples. Never publish real source caches, conversation excerpts, reports containing private filenames, cookies, login codes, or connection tokens. See [SECURITY.md](../SECURITY.md) for security reporting.
