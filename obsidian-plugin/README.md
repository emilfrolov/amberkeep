# Amberkeep for Obsidian

The desktop plugin connects an isolated Claude session, synchronizes accessible history, and writes an evidence-linked knowledge graph into the current vault. It is an experimental macOS preview, not an official Anthropic connector.

Download the installable plugin from [v0.2.0](https://github.com/emilfrolov/amberkeep/releases/tag/v0.2.0). Put `manifest.json`, `main.js`, and `styles.css` inside `YOUR-VAULT/.obsidian/plugins/amberkeep/`, enable the plugin, and use **Connect Claude**. See the [desktop guide](../docs/DESKTOP.md) and [privacy details](../docs/PRIVACY.md).

Semantic analysis uses the [Claude Desktop MCP companion](../desktop-extension/README.md) on request, or an explicitly selected local Ollama model after synchronization. Source-backed and recurring-term notes are distinct from model synthesis.

## Development

Use Node.js 22 and the committed lockfile:

```bash
npm ci --ignore-scripts
npm test
npm run build
```

`main.js` is a readable standalone bundle; Obsidian and Node built-ins remain host imports. Tests use synthetic data. The integration tests exercise the real client, graph engine, writer, and disk cache behind a mocked Obsidian/session host. Native sign-in is a separate compatibility check; a Linux Electron fixture does not establish a successful macOS account login.

The module boundaries are documented in [CONTRACT.md](CONTRACT.md). Do not commit local caches, credentials, exports, `node_modules/`, or a generated bundle. Release packaging reads the built bundle after checks pass.
