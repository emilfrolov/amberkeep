<p align="center">
  <img src="assets/amberkeep-hero.png" alt="Amberkeep — keep your conversations and own your archive" width="100%">
</p>

<h1 align="center">Amberkeep</h1>
<p align="center"><strong>Your conversations. Connected.</strong><br>Bring your Claude history into an evidence-linked Obsidian knowledge graph.</p>
<p align="center">
  <a href="https://github.com/emilfrolov/amberkeep/actions/workflows/tests.yml"><img src="https://github.com/emilfrolov/amberkeep/actions/workflows/tests.yml/badge.svg?branch=main&amp;event=push" alt="Tests (main)"></a>
  &nbsp; macOS desktop preview &nbsp;·&nbsp; MIT
</p>
<p align="center">
  <a href="https://github.com/emilfrolov/amberkeep/releases/tag/v0.2.0">Desktop preview</a> ·
  <a href="docs/INSTALLATION.md">Install</a> ·
  <a href="docs/KNOWLEDGE-GRAPH.md">How the graph works</a> ·
  <a href="docs/PRIVACY.md">Privacy</a> ·
  <a href="COMMUNITY.md">Community</a>
</p>

---

Connect your own Claude account once inside Obsidian. Amberkeep synchronizes accessible conversations and supported project and memory material into linked notes, then helps turn that material into concepts, decisions, and questions with quotations leading back to their sources.

History sync can run automatically while Obsidian is open. Semantic analysis uses either **Claude Desktop through a local extension** when you ask, or an **explicitly configured local Ollama model** after each sync. No Anthropic API key is required.

> **0.2.0 is an experimental desktop preview.** Direct retrieval uses Claude's unsupported website API, and embedded sign-in can fail or change. Validation is limited to automated tests and a local Linux Electron fixture; a live macOS login and complete real-account workflow have not been validated. The graph represents accessible sources and completed analysis, not a verified reconstruction of everything you have ever discussed.

## Download the desktop preview

| Download | Purpose |
| --- | --- |
| [Obsidian plugin ZIP](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-obsidian-v0.2.0.zip) | Direct history sync, managed notes, dashboard, and the local bridge |
| [Claude Desktop extension](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-desktop-v0.2.0.mcpb) | Let your current Claude session read synchronized sources and save evidence-backed knowledge |
| [Synthetic knowledge-graph demo](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-knowledge-demo-v0.2.0.zip) | Try a ready-made demo vault with invented sources and hand-authored example analysis |

The [v0.2.0 release page](https://github.com/emilfrolov/amberkeep/releases/tag/v0.2.0) contains the preview downloads. The demo is not a recording of a real AI analysis or a real account sync. The earlier [v0.1.0 release](https://github.com/emilfrolov/amberkeep/releases/tag/v0.1.0) is the archive-import release.

## Set up once on macOS

1. **Install the Obsidian plugin.** Unpack the plugin ZIP into `YOUR-VAULT/.obsidian/plugins/amberkeep/`, then enable Amberkeep in **Settings → Community plugins**. Keep that vault open.
2. **Connect Claude.** Open Amberkeep's dashboard, choose **Connect Claude**, and sign in to your own account in its isolated panel. The first successful connection starts synchronization. It does not read Claude Desktop cookies or macOS Keychain entries.
3. **Choose semantic analysis.** Open the `.mcpb` file in Claude Desktop, select the same Obsidian vault, and enable its tools in a conversation. Or configure an installed local Ollama model in Amberkeep's settings for automatic analysis.

Normal installation needs no terminal setup, Python, or separately installed Node.js. [Full installation instructions](docs/INSTALLATION.md) cover folder placement, sign-in limitations, and updates.

For Claude Desktop, start with:

> Use Amberkeep to sync my history and build my knowledge graph in Obsidian. Check synchronization progress, then process pending sources in manageable batches. Read every page of each source, extract useful concepts, decisions, and open questions, and save them with exact quotations linking back to their source messages. Report what remains pending or failed, then open the graph.

A large history may need a later request to continue. Completed sources are tracked by their current content hash; reading one page does not mark a whole source as analysed.

## What the graph contains

| Layer | What it gives you |
| --- | --- |
| Source notes | Conversations, available project material, and supported memory records with stable identities and message anchors |
| Structural links | Available project and source associations |
| Lexical navigation | Labelled recurring-term topics and candidate excerpts; these are wording-based suggestions |
| Semantic knowledge | Model-written concepts, decisions, questions, people, tools, and relationships with validated source quotations |

The graph uses Obsidian's native wikilinks. **Open knowledge graph** opens the managed graph area; you can follow evidence links into source messages or inspect a smaller neighborhood with Obsidian's local graph.

Evidence validation checks the current source hash, message identifiers, and verbatim quotations. It does not prove that a model's interpretation is correct. [Read how the graph works](docs/KNOWLEDGE-GRAPH.md).

## Keep it growing

After you explicitly connect, history sync defaults to every 15 minutes while Obsidian is open. **Automatic history sync** can be turned off or changed in settings. Enabled connections can resume synchronization on later launches.

- With **Claude Desktop**, ask the current chat to analyse pending sources. There is no unattended cloud-model session running behind the scenes.
- With an installed **local Ollama model**, enter its exact name in **Local Ollama model (optional)**. Pending sources are analysed after sync while Obsidian and Ollama are running. Amberkeep does not install a model, and the setting is empty by default.

Oversized or invalid analysis remains pending. The dashboard distinguishes synchronized sources, analysed sources, warnings, and unfinished work. Partial syncs keep earlier cached records; they do not silently delete source notes.

## Keep control of your notes and data

Generated notes live under `Amberkeep/` by default. You can write outside their managed blocks. If a generated block was edited, Amberkeep preserves it and saves a proposed update under `Conflicts/`. It does not delete existing notes to resolve missing sources or conflicts.

Native synchronization makes authenticated requests to Claude. Its source cache and knowledge data are stored in your vault's plugin directory and may be included in vault sync or backups. Claude Desktop analysis sends the requested source pages to the current model session; local analysis sends them to the loopback Ollama service you selected. There is no Amberkeep telemetry or developer-operated data service. See [privacy and data handling](docs/PRIVACY.md).

## Archive import remains available

If native sign-in or direct retrieval does not work for your account, the independent archive converter can still process a downloaded Claude export. It uses Python 3.10+ with no third-party dependencies and makes no network requests.

Use the [archive export guide](docs/EXPORT-GUIDE.md), [format support guide](docs/FORMAT-SUPPORT.md), or the [archive skill ZIP](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-skill-v0.2.0.zip). That skill imports supplied files; it is separate from the native Obsidian connection.

## Documentation and community

- [Install and update](docs/INSTALLATION.md) · [Desktop workflow](docs/DESKTOP.md)
- [Knowledge graph](docs/KNOWLEDGE-GRAPH.md) · [Privacy](docs/PRIVACY.md) · [Support](SUPPORT.md)
- [Community](COMMUNITY.md) · [Contribute](CONTRIBUTING.md) · [Maintainer guide](docs/MAINTAINING.md)
- [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

The desktop source is in `obsidian-plugin/` and `desktop-extension/`; Node.js 22 is used for development and CI. Runtime packages are bundled for installation. See the contribution and maintainer guides for development checks.

## License and affiliation

[MIT](LICENSE). Created by [emilfrolov](https://github.com/emilfrolov).

Amberkeep is an independent community project, not affiliated with or endorsed by Anthropic or Obsidian. Claude and Obsidian are trademarks of their respective owners.
