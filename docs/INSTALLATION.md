# Install Amberkeep on macOS

This guide installs the **v0.2.0 desktop preview**: an Obsidian plugin for direct synchronization, plus an optional Claude Desktop companion for semantic analysis. The companion can be replaced by an explicitly configured local Ollama model.

Direct synchronization uses Claude's unsupported website API. A live macOS login and complete real-account sync have not yet been validated. Automated tests and a local Linux Electron fixture do not establish compatibility with every account or installed app version.

## Requirements and downloads

- macOS with Obsidian 1.7 or newer and a local filesystem vault.
- Permission to install community plugins in that vault.
- Your own Claude account. For the companion workflow, a Claude Desktop version and account configuration that allow local extensions.

Download from the explicit [v0.2.0 preview release](https://github.com/emilfrolov/amberkeep/releases/tag/v0.2.0):

| File | Install in |
| --- | --- |
| [amberkeep-obsidian-v0.2.0.zip](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-obsidian-v0.2.0.zip) | Your Obsidian vault |
| [amberkeep-desktop-v0.2.0.mcpb](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-desktop-v0.2.0.mcpb) | Claude Desktop, if using Claude for semantic analysis |
| [amberkeep-knowledge-demo-v0.2.0.zip](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-knowledge-demo-v0.2.0.zip) | A separate demo vault in Obsidian |

Normal installation needs no Python, separately installed Node.js, terminal commands, or API key. The Obsidian plugin ships bundled JavaScript; the `.mcpb` companion uses Claude Desktop's runtime.

## 1. Install the Obsidian plugin

1. Unpack `amberkeep-obsidian-v0.2.0.zip`.
2. In Finder, open your chosen vault. Press **Command–Shift–.** if you need to show its hidden `.obsidian` folder.
3. Create `plugins/amberkeep/` inside `.obsidian/` if it does not exist, and place the plugin files there:

   ```text
   YOUR-VAULT/
     .obsidian/
       plugins/
         amberkeep/
           manifest.json
           main.js
           styles.css
   ```

   Avoid an extra nested `amberkeep/` directory: `manifest.json` must be directly inside the plugin folder shown above.
4. Open the vault in Obsidian. Go to **Settings → Community plugins**, enable community plugins if needed, and enable **Amberkeep**. Reload Obsidian if it does not appear.
5. Open Amberkeep using its ribbon icon, status-bar item, or **Amberkeep: Open dashboard** command.

This is a manual community installation. The preview is not listed in Obsidian's community-plugin browser.

## 2. Connect Claude once

Choose **Connect Claude** in Amberkeep's dashboard or settings. Sign in to your own account inside the panel. Use **Check connection** if it does not finish automatically. Successful connection enables collection and starts the first synchronization.

This isolated persistent sign-in is separate from Claude Desktop's login. It does not import that app's cookies or read Keychain. A normal email login code, when required, is entered in Claude's sign-in interface. Google or another identity provider may block the embedded panel; the preview does not bypass that restriction.

The default **Knowledge folder** is `Amberkeep`. After connection, **Automatic history sync** defaults to every 15 minutes while Obsidian is open, and enabled connections can resume on later launches. Change the interval or choose **Off** in settings. **Disconnect** disables collection; notes and caches remain.

Synchronization creates source notes and structural or lexical navigation. To create the model-written semantic layer, choose one of the following analysis modes.

## 3A. Use your current Claude Desktop session

1. Keep the connected vault open in Obsidian.
2. Double-click `amberkeep-desktop-v0.2.0.mcpb`. If needed, install the file through Claude Desktop's **Settings → Extensions** interface.
3. When prompted for **Obsidian vault**, select the same vault directory—not its `.obsidian` subdirectory.
4. Enable or approve Amberkeep's tools in the Claude conversation where you want to work. Account or organization policies may restrict extensions and tool use.
5. Ask Claude:

   > Use Amberkeep to sync my history and build its knowledge graph in Obsidian. Check sync progress, then process pending sources in batches. Read every page of each source, extract useful concepts, decisions, and questions, and save them with exact source quotations. Report pending work and failures, then open the graph.

The companion reads the selected plugin's authenticated local bridge. It does not log in independently or access arbitrary vault files. Long histories may require a later request to continue; completed analysis is tracked against each source's current hash.

See the [companion guide](../desktop-extension/README.md) for tool behavior and connection troubleshooting.

## 3B. Run semantic analysis automatically with Ollama

Use this option if you want pending sources analysed after synchronization without an active Claude Desktop conversation.

1. Install and run [Ollama](https://ollama.com/) yourself. Select an installed local model suitable for your hardware and source context length.
2. In Amberkeep settings, enter its exact name under **Local Ollama model (optional)**. This field is empty by default. **List models** can help find installed local names.
3. Check **Local Ollama address**; its default is `http://127.0.0.1:11434`. Only loopback addresses with an explicit port are accepted.
4. Use **Sync now**, or **Analyse pending locally** for already synchronized sources. With automatic history sync enabled, later source updates can trigger local analysis while Obsidian and Ollama remain open.

Amberkeep does not install models or configure a paid inference API. Known cloud-model names and remote endpoints are refused. Review the local service's own configuration; its inference and logging behavior remain your responsibility.

Sources above the local serialized-input limit, invalid evidence, and failed requests stay pending. Use the companion's paged workflow for sources too large for local analysis. See [the desktop guide](DESKTOP.md#optional-automatic-semantic-analysis-with-a-local-model) for the current limits.

## Inspect the result

The dashboard separates synchronized source counts, AI-analysed sources, pending work, and warnings. Use **Open knowledge graph** to open the managed area in Obsidian. Enable Obsidian's **Graph view** core plugin if required.

Follow a concept's evidence links to its source messages. Lexical topics and candidate excerpts are labelled as suggestions; they are not the same as completed model analysis. Edited generated blocks produce proposed replacements under the managed root's `Conflicts/` folder instead of silently overwriting your changes.

For a private-data-free preview, unpack the knowledge-demo ZIP and open its demo vault folder in Obsidian. Its sources and example enrichments are invented and hand-authored; it does not demonstrate a live account sync or model run.

## Update or uninstall

To update the Obsidian plugin, disable it, replace its distributed `main.js`, `manifest.json`, and `styles.css`, then enable it again. Preserve existing `data.json`, `snapshot.json`, `knowledge.json`, and `graph-index.json` if you want to retain settings, synchronized material, and analysis. Install a newer companion `.mcpb` through Claude Desktop and verify the selected vault.

To stop collection, choose **Disconnect**. The plugin clears its own cookie store only when the host supports that operation; otherwise it reports that the isolated login may persist. Disable the Obsidian plugin to close the local bridge, and remove the Desktop extension if you no longer want its tools available. Generated notes and caches are not automatically deleted. See [privacy](PRIVACY.md) before removing or sharing them.

## Archive-import fallback

If the experimental native connection is unavailable, you can use the independent archive converter with a downloaded export. See [the archive guide](EXPORT-GUIDE.md) and [format support](FORMAT-SUPPORT.md).

The optional [archive skill ZIP](https://github.com/emilfrolov/amberkeep/raw/refs/heads/main/downloads/v0.2.0/amberkeep-skill-v0.2.0.zip) installs as a custom skill in Claude. Its standalone terminal converter requires Python 3.10+ and no third-party packages. This file-based workflow does not install the native Obsidian plugin or reuse its connection.
