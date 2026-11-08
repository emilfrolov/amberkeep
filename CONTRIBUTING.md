# Contributing to Amberkeep

Contributions that improve source preservation, export compatibility, and readable Obsidian notes are welcome.

## Development

Use Python 3.10 or newer. The converter and tests use the standard library only.

```bash
python3 -m unittest discover -s tests -v
python3 tools/build_release.py
```

The primary implementation is `skills/archive-to-obsidian/scripts/convert.py`. Keep it self-contained so the skill ZIP works independently of a repository checkout. Changes must not add network calls, account scraping, credential access, automatic vault mutation, or execution of exported code.

## Report a format problem

Include the Amberkeep version, Python version, input type, error or report warning, and a minimal **invented or fully anonymized** JSON shape. Synthetic data is preferred. Do not share private exports or identify real conversations and projects.

## Pull requests

- Explain the observed input shape and how it differs from existing support.
- Add a meaningful regression fixture using synthetic data.
- Preserve unknown fields and original source bytes.
- Keep output filenames portable and refuse overwrites.
- Update the format guide and changelog when behavior changes.

Use English for code, documentation, and issue descriptions when practical. Source conversations and generated content may use any language.

By contributing, you agree to license your changes under the repository's MIT license.
