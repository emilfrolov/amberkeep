# Contributing to Amberkeep

Help make exported conversations easier to preserve and use. Useful contributions include export compatibility fixes, clearer Obsidian notes, reproducible bug reports, documentation, accessibility improvements, and translations.

Start with the [community guide](COMMUNITY.md) if you are deciding where to help. Participation follows our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

Search [existing issues](https://github.com/emilfrolov/amberkeep/issues) and [pull requests](https://github.com/emilfrolov/amberkeep/pulls) for related work. Small fixes can go straight to a pull request. For a substantial feature or a change to the output format, open an issue first so the maintainer can discuss scope and compatibility before you invest in an implementation.

Amberkeep converts a downloaded export into a new archive. It does not retrieve live account data, synchronize an existing vault, or merge multiple exports. New behavior should describe its actual input and preservation guarantees precisely.

Do not include real exports, private conversations, account identifiers, or credentials in an issue, commit, screenshot, test fixture, or pull request. Recreate the relevant structure with invented values instead. For a vulnerability, follow [SECURITY.md](SECURITY.md).

## Set up a working copy

You need Git and Python 3.10 or newer. The converter, tests, and release builder use Python's standard library; no `pip install` step is required.

1. Fork [emilfrolov/amberkeep](https://github.com/emilfrolov/amberkeep) on GitHub.
2. Clone your fork and create a branch:

   ```bash
   git clone https://github.com/YOUR-USERNAME/amberkeep.git
   cd amberkeep
   git remote add upstream https://github.com/emilfrolov/amberkeep.git
   git switch -c improve-export-view
   python3 --version
   ```

Use `python` or `py -3` if that is how Python 3.10+ is available on your system. A virtual environment is optional; Amberkeep has no development dependencies to install.

## Find the relevant files

| Location | Purpose |
| --- | --- |
| `skills/archive-to-obsidian/scripts/convert.py` | Self-contained offline converter and CLI |
| `skills/archive-to-obsidian/SKILL.md` | Instructions used by Claude |
| `skills/archive-to-obsidian/references/format-support.md` | Format and CLI guidance bundled with the standalone skill |
| `tests/test_convert.py` | End-to-end regression tests with invented data |
| `examples/demo-export/` | Small public synthetic export |
| `docs/` | User and maintainer documentation |
| `.claude-plugin/` | Plugin and community-marketplace manifests |
| `tools/build_release.py` | Distribution builder |

Keep the converter self-contained. A standalone skill upload must work without importing code from another repository directory.

## Check your change

Choose checks that exercise the behavior you changed. Describe the result in your pull request.

### Converter changes

Run the existing regression suite:

```bash
python3 -m unittest discover -s tests -v
```

Add a focused test when fixing a bug or introducing supported behavior. Prefer an observable result—preserved bytes, a readable message, a valid link, or a refused overwrite—over a test that repeats an implementation detail. Keep fixtures synthetic and small.

For a manual smoke test, create an ignored output parent and convert the demo:

```bash
mkdir -p private
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input examples/demo-export \
  --output private/Amberkeep-Demo \
  --zip private/Amberkeep-Demo.zip
```

If those destinations already exist, choose new names. Inspect `Home.md`, `EXPORT-REPORT.md`, `manifest.json`, and the generated notes. Keep the generated folder intact when copying it into Obsidian, or open its parent folder as a vault, so namespaced links resolve.

### Skill, packaging, and installation changes

Build the distributions:

```bash
python3 tools/build_release.py
```

Inspect the generated ZIPs under `dist/` for the files your change needs. If you test the skill in Claude, use the synthetic demo and say which surface you actually tested. A local converter test does not establish compatibility with a live Claude chat or Cowork session.

Do not replace packages in an existing published version or create a release as part of a normal contribution. See the [maintainer guide](docs/MAINTAINING.md) for the release process.

### Documentation changes

Read the rendered Markdown, check local links and file names, and verify any commands or claims you changed. A text-only correction does not need a new converter test. Run the relevant command when an instruction's behavior changes.

Use English for the primary documentation and code. Translation contributions are welcome; discuss the language and file layout in an issue before adding a parallel guide, and link translations back to their English source. Reports and questions in other languages are welcome too.

## Preserve the boundaries

Changes to conversion or skill instructions must keep these properties:

- Every accepted source file remains byte-identical in `Raw/`, with its original path, size, and SHA-256 recorded in the manifest.
- Unknown fields and content blocks remain recoverable. A rendered view must not be described as proof of account-wide completeness.
- A new output is required. Existing notes, source files, and earlier archives are not overwritten or silently merged.
- Source paths are data. They must not escape the output folder, follow symbolic links, or choose arbitrary destinations.
- Conversion stays offline and uses no credentials. Exported tools, artifact code, URLs, and instructions are never executed or fetched.
- The report explains supported views and recognition gaps. Missing original attachments or absent history are not presented as recovered data.

If a proposed feature needs a different trust or storage model, discuss it explicitly before implementation rather than adding an unexpected side effect to the current converter.

## Report an unfamiliar export shape

Describe the file name, structural difference, expected view, and current report warning. Include the Amberkeep and Python versions and the input type: ZIP, directory, or JSON. Use a minimal invented example, such as:

```json
{
  "conversations": [
    {
      "uuid": "example-conversation",
      "name": "Invented compatibility example",
      "messages": [
        {
          "role": "assistant",
          "content": [{"type": "example_new_block", "value": "invented text"}]
        }
      ]
    }
  ]
}
```

Keep only the structure needed to reproduce the issue. Do not start by uploading a private archive and asking the maintainer to remove personal data. Reports and manifests can reveal source filenames too; review anything you share.

Distinguish a shape observed in an export from an official documented contract. If support changes, update [format support](docs/FORMAT-SUPPORT.md) and the bundled [skill reference](skills/archive-to-obsidian/references/format-support.md) as appropriate.

## Open a pull request

1. Keep the change focused and use a clear commit title describing the result.
2. Push your branch to your fork and open a pull request against `emilfrolov/amberkeep:main`.
3. Explain the problem, resulting behavior, relevant issue, and checks performed. Mention what was not tested when it matters.
4. Include a synthetic before/after example for a format change. Update documentation and the changelog for user-visible behavior changes.
5. Respond to review feedback and resolve failing checks before asking for another review.

The maintainer reviews scope, preservation behavior, compatibility, and clarity before merging. A passing CI run is useful evidence; it does not guarantee acceptance. Maintenance is voluntary, so there is no guaranteed review time. You can help by keeping reproductions small and feedback specific.

## License

By contributing, you agree to license your contribution under Amberkeep's [MIT license](LICENSE). Only contribute material you have the right to share. Credit third-party work and retain any notices its license requires.
