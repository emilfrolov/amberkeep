# Amberkeep on desktop

Amberkeep's desktop integration connects your own Claude account to an open Obsidian vault. It synchronizes accessible conversations and supported project and memory material directly into that vault. A companion extension lets Claude Desktop turn synchronized sources into concepts, decisions, questions, and evidence links.

This guide describes the **experimental 0.2.0 desktop integration**. Authentication and source retrieval depend on Claude's unsupported web API and can change without notice. Native sign-in and the complete workflow have not yet been validated on a live macOS installation. Keep your existing source data and inspect the sync status before relying on the result as a complete archive.

## What you need

- macOS with Obsidian 1.7 or newer running, and the vault you want to use open.
- Permission to install a community plugin in that vault.
- Your own Claude account and access to Claude Desktop.
- The Amberkeep Obsidian plugin ZIP and Claude Desktop `.mcpb` extension from the [v0.2.0 desktop preview](https://github.com/emilfrolov/amberkeep/releases/tag/v0.2.0).

The desktop workflow does not need an Anthropic API key or a downloaded account-export ZIP. It uses a separate Claude sign-in for synchronization and your current Claude Desktop session for semantic analysis. Normal Claude account limits still apply.

## 1. Install the Obsidian plugin

1. Quit Obsidian or temporarily disable Amberkeep if you are updating it.
2. Unpack the Obsidian plugin ZIP. Put the plugin's `manifest.json`, `main.js`, and any bundled supporting files inside:

   ```text
   YOUR-VAULT/.obsidian/plugins/amberkeep/
   ```

   Preserve the package's supporting folders. `manifest.json` must be directly inside `amberkeep/`, without another nested plugin directory.
3. Open that vault in Obsidian. In **Settings → Community plugins**, allow community plugins if necessary and enable **Amberkeep**.
4. Open Amberkeep's settings. **Knowledge folder** selects the generated-note root; its default is `Amberkeep`. Keep this location separate from your existing personal notes.

This is a manual community-plugin installation. Installing the Claude skill alone does not install the Obsidian plugin.

## 2. Connect your Claude account

Use **Connect Claude** in Amberkeep's Obsidian settings or dashboard. Complete the normal sign-in in the panel it opens, then use **Check connection** if the panel does not close automatically. A confirmed connection starts the first history sync. The plugin uses an isolated persistent webview session; it does not import cookies from Claude Desktop, inspect another browser's profile, or read macOS Keychain credentials.

Standard email sign-in may require a normal one-time login code. That code is entered in Claude's sign-in window, not in a chat or GitHub issue. A Google or other identity-provider login can refuse to run in an embedded window. Amberkeep does not disguise its browser or promise a workaround. If your account's required sign-in method is unavailable, the native connection may not work yet.

Keep Obsidian open after signing in. The connection belongs to this local plugin session; being signed into the Claude Desktop app is a separate condition. Open Amberkeep from its ribbon icon or **Amberkeep: Open dashboard** to follow progress, use **Sync now**, or open the graph.

## 3. Install the Claude Desktop companion

1. Open the release's `.mcpb` file in Claude Desktop and complete the extension's installation dialog.
2. When asked for a vault directory, select the **same vault** that is open in Obsidian and has Amberkeep enabled. Select the vault directory, not its `.obsidian` directory.
3. Start a Claude Desktop chat with the Amberkeep extension enabled.

The companion talks only to Amberkeep's authenticated local bridge. It does not create a second vault or independently log in to Claude. Obsidian must be open for its tools to work.

## 4. Synchronize and build the graph

Ask Claude Desktop:

> Use Amberkeep to sync my accessible Claude history into the connected Obsidian vault. Check the status until synchronization finishes. Then analyse the pending sources in manageable batches: read every page of each source, identify useful concepts, decisions, and open questions, and save them with exact source quotations. Tell me what remains pending or failed and open the graph.

The first synchronization can take time. Source retrieval and semantic analysis are separate stages:

1. The Obsidian plugin retrieves available source material and writes linked source notes. Structural links and recurring-term suggestions can appear immediately.
2. Claude Desktop reads synchronized sources through Amberkeep's tools and saves evidence-backed semantic notes. This uses the model in the current chat; there is no separate background AI service.

A single chat may not finish a large history. Ask Claude to continue with pending sources later. Amberkeep tracks which source hashes have current semantic results, so analysis can resume without treating unfinished sources as complete.

For example:

> Check Amberkeep's status and continue analysing pending sources. Work on a small batch, read all pages, and report how many sources remain.

See [Understanding the knowledge graph](KNOWLEDGE-GRAPH.md) for the difference between source links, lexical suggestions, and model-generated connections.

## Optional: automatic semantic analysis with a local model

If you want semantic notes to update after synchronization without an active Claude Desktop chat, configure an installed local model through [Ollama](https://ollama.com/). This is optional; Amberkeep leaves the local-model setting empty by default and does not install or download a model for you.

1. Install and run Ollama yourself, and choose a local model appropriate for your computer. Ensure its context configuration can accommodate the source material you want to analyse.
2. In Amberkeep's Obsidian settings, enter the exact installed model name under **Local Ollama model (optional)** and check **Local Ollama address**. The default address is `http://127.0.0.1:11434`; **List models** helps identify installed local names.
3. Use **Sync now**, or **Analyse pending locally** if the sources are already synchronized. Amberkeep processes pending sources serially with the selected local model and validates the proposed knowledge before writing it.
4. If you also enable automatic polling, source changes and their local semantic analysis can run while Obsidian, Amberkeep, and Ollama remain open. The Claude Desktop companion is optional for this mode.

Amberkeep accepts only loopback Ollama addresses with an explicit port. It does not accept remote inference endpoints, credentials in the address, or known cloud-model names. The source is sent in full as data, with exact message IDs, and is never shortened to a prefix just to mark it complete.

Local analysis rejects a serialized source above 120,000 characters, limits a response to 2 MiB, and times out an individual request after 120 seconds. Failed, oversized, or invalid results leave that source pending; other sources can continue. A global model-availability problem can stop the batch. A large source can still be analysed through the companion's paged Claude Desktop workflow. A loopback connection does not establish how a separately configured inference service behaves; use an actual local model and review Ollama's own configuration.

The provider is tested against a local mock API, not a real installed model. Model quality, context limits, hardware capacity, and actual macOS behavior still need validation on your setup. No Anthropic API key or paid inference API is configured by this feature; running a local model uses your computer's resources.

## Keep it up to date

Run another sync when you want to retrieve changes. Amberkeep uses source identifiers and update information to avoid unnecessary detail downloads, then writes new or changed generated content into the same vault.

Connecting Claude enables automatic history sync, with a default interval of 15 minutes while Obsidian and the plugin are running. Before that explicit connection, automatic retrieval is disabled. **Automatic history sync** offers **Off**, **Every 5 minutes**, **Every 15 minutes**, and **Every hour**. On later launches, an enabled connection with cached sources can resume automatic synchronization.

With a configured local model, pending semantic analysis runs after synchronization. Without a local model, changed sources remain pending for a later Claude Desktop session. **Disconnect** disables automatic retrieval and stops current work; generated notes remain.

An interrupted or partial scan retains previously cached material and reports warnings. Amberkeep does not delete existing source notes merely because a later scan did not return them. That also means a local archive can retain material that is no longer available in the source account.

## Protect your own notes

Amberkeep owns only its identified generated blocks. You can add your own writing outside those blocks. When updating an owned note, it preserves text and frontmatter outside the managed section.

If a generated block has been edited, Amberkeep keeps that edit and writes a proposed replacement under `Amberkeep/Conflicts/` rather than silently replacing it. Review the conflict before deciding which version to keep. It does not automatically merge your edits or delete vault files.

## Data and privacy

- Synchronized source JSON and semantic results are cached inside the plugin's configuration directory in the selected vault. They may be included in your vault sync or backups, depending on your settings.
- Claude authentication cookies are kept in the plugin's isolated Electron session, outside the vault. They are not placed in synced plugin settings.
- The Desktop companion reads the local bridge connection information from `~/.amberkeep/connections/<vault-hash>.json`, outside the vault. The directory is private to the local user, the connection file uses mode `0600`, and the loopback bridge requires its random token. The same selected vault path identifies the connection across both applications.
- Asking Claude Desktop to analyse a source makes that source text available to the current model session. Your Claude account and organization rules govern that processing.
- Configuring local analysis sends synchronized source text to the loopback Ollama service you select. Amberkeep does not install the model or configure that service's retention or inference behavior.
- No real history, login code, session cookie, cache, or private graph content should be attached to a public issue.

Native snapshots preserve the JSON data returned to the client. They are not a byte-identical copy of every HTTP response, and they are not proof that Claude returned every conversation or original attachment.

Disconnecting clears the plugin's isolated browser store when the host exposes the needed session API. When it cannot clear that store, the interface says the session may still be signed in on reconnect. Automatic sync still stops. To ensure account sign-out in that case, sign out through Claude inside the plugin's own sign-in panel; Amberkeep does not clear another application's cookies.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Login is required | Use **Connect Claude** in Obsidian. A login in Claude Desktop does not authenticate the plugin's isolated session. |
| Sign-in provider refuses the window | Your provider may block embedded login. Do not copy cookies or credentials into the plugin; report the unsupported flow without private details. |
| Desktop tools cannot connect | Keep the correct vault open in Obsidian, enable Amberkeep, and check the companion's selected vault path. |
| Only part of the history appears | Read sync warnings and the available-organization status. Account permissions, API changes, or interrupted scans can limit retrieval. |
| Source notes exist but concepts are missing | Synchronization is complete for those sources, but semantic analysis still needs a Claude Desktop session. Check the pending count. |
| Some analysis needs to run again | Changed source content invalidates its previous semantic hash. Analyse the pending version instead of reusing stale evidence. |
| Local analysis fails or leaves pending sources | Check that Ollama is running, the exact local model is installed, its context fits the source, and its result passes evidence validation. Oversized sources require paged analysis in Claude Desktop. |
| Your edits caused a conflict | Inspect the proposed note under the generated root's `Conflicts/` folder; existing edited content is preserved. |

Use the [support guide](../SUPPORT.md) for a synthetic bug report. Include the plugin version, platform, current stage, and non-sensitive error message. Explicitly distinguish a native connection failure from an archive-import problem.
