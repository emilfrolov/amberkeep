# Getting help

Start with the [desktop guide](docs/DESKTOP.md), [installation guide](docs/INSTALLATION.md), and [knowledge-graph guide](docs/KNOWLEDGE-GRAPH.md). For the offline fallback, use the [export guide](docs/EXPORT-GUIDE.md) and [archive troubleshooting](docs/TROUBLESHOOTING.md).

## Choose the right place

| You need to… | Use… |
| --- | --- |
| Ask how to install or use Amberkeep | [Setup or usage question](https://github.com/emilfrolov/amberkeep/issues/new?template=question.yml) |
| Report unexpected behavior or an error | [Bug report](https://github.com/emilfrolov/amberkeep/issues/new?template=bug_report.yml) |
| Describe an export shape that lacks a useful view | [Export format support](https://github.com/emilfrolov/amberkeep/issues/new?template=format_support.yml) |
| Suggest a new capability | [Feature request](https://github.com/emilfrolov/amberkeep/issues/new?template=feature_request.yml) |
| Report a security vulnerability | Follow [SECURITY.md](SECURITY.md) before posting details |
| Report harmful community behavior | Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

Search [existing issues](https://github.com/emilfrolov/amberkeep/issues) first. If one matches, add new evidence there rather than creating a duplicate. English makes reports easier to share; questions in other languages are welcome, and a short English summary helps when possible.

## Information that helps

For a technical problem, include the Amberkeep version, Obsidian and Claude Desktop versions when relevant, operating system, and whether you used direct sync, MCP, local inference, or the archive importer. Explain what you expected and what happened. Share the exact error after replacing private paths and identifiers with invented values.

For local conversion, these commands show the versions:

```bash
python3 --version
python3 skills/archive-to-obsidian/scripts/convert.py --version
```

A short synthetic JSON example is useful for parser problems. A screenshot of a setup problem can help if it contains no private information. You do not need to provide an export to ask an installation question.

## Keep your archive private

Never attach a real Claude export, generated vault, or conversation transcript to a public issue or pull request. Reports and manifests can reveal filenames, account identifiers, project names, and paths too. Recreate the smallest failing shape with invented text and identifiers instead of editing a full personal export.

If you accidentally share sensitive data, remove the attachment or comment if you can and notify the maintainer without repeating it. Removing a public post does not guarantee removal from copies or caches. Revoke any exposed credentials through the relevant service.

## What to expect

Amberkeep is maintained as a community project. There is no guaranteed response time or recovery service. Keep the original export and avoid repeatedly opening the same request. The maintainer may ask for a smaller reproduction, combine duplicate issues, or close requests outside the project's scope.

For ways to help beyond reporting an issue, see the [community guide](COMMUNITY.md).
