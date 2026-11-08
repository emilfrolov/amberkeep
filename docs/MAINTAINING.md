# Maintaining Amberkeep

This guide describes the current small-project workflow. [emilfrolov](https://github.com/emilfrolov) maintains the repository, reviews contributions, and publishes releases. Contributors are welcome to propose changes; a pull request does not grant publishing or moderation permissions.

## Triage and review

Use the issue forms to distinguish installation questions, bugs, format gaps, and feature requests. Link duplicates and ask for the smallest synthetic reproduction that demonstrates the problem. Do not request real archives, browser cookies, credentials, or private transcripts.

When private material appears in an issue or pull request, remove or hide it where your permissions allow, ask the author to replace it with invented data, and avoid quoting it. An issue deletion is not proof that all copies are gone. Follow [the security policy](../SECURITY.md) for a vulnerability and [the code of conduct](../CODE_OF_CONDUCT.md) for moderation.

Before merging a contribution:

- Check that it solves the described user problem without broad unrelated changes.
- For converter changes, review byte preservation, output collisions, resource limits, and handling of unfamiliar fields. Confirm a meaningful synthetic regression test covers a behavior change.
- For documentation-only changes, check links and example commands; additional converter tests are usually unnecessary.
- Keep runtime Python code self-contained and dependency-free. The standalone skill cannot rely on repository-only modules.
- Ensure the README, skill guidance, format guide, and actual CLI agree. Make no claims of account-wide completeness or endorsement by Anthropic or Obsidian.
- Inspect CI results on the commit to be merged. Fork contributions do not need secrets; keep the workflow on ordinary `pull_request`, with read-only permissions.

Small documentation fixes can go directly to `main` when the maintainer has checked them. Review behavior changes through a pull request. Ask for clarification only when it affects the implementation or the intended scope.

## Verify a release candidate

From the repository root, run:

```bash
python3 -m unittest discover -s tests -v
python3 tools/build_release.py
```

The second command creates the skill, plugin, and synthetic-demo ZIPs plus `SHA256SUMS.txt` in `dist/`. It runs the demo conversion and checks ZIP integrity. Check that each package contains its referenced files and excludes caches, local exports, and credentials.

If Claude Code is installed, validate both manifests:

```bash
claude plugin validate .claude-plugin/plugin.json
claude plugin validate .claude-plugin/marketplace.json
```

The manifest validator checks structure; it does not prove successful conversion, official-directory acceptance, or compatibility on every Claude surface. For changes to installation or skill execution, test the actual downloadable skill and community plugin using invented data. State which surfaces were tested and which were not.

## Prepare versioned downloads

For a new release, update these version declarations together:

| File | Value |
| --- | --- |
| `.claude-plugin/plugin.json` | `version` |
| `.claude-plugin/marketplace.json` | `metadata.version` and the Amberkeep plugin entry's `version` |
| `skills/archive-to-obsidian/scripts/convert.py` | `VERSION` |

Update the changelog and any version-specific filenames in the README and installation guide. Generate packages only after the source and metadata agree.

The current download channel stores public installation packages in `downloads/v<version>/`. For a new version, create a new directory and copy the three ZIPs and checksum file from `dist/` without modification. The ZIP ignore rule is intentional: stage only the three generated package filenames explicitly with `git add -f`. Do not force-add a directory containing personal exports.

Keep packages for an existing version unchanged. A behavior fix requires a new version. Documentation changes on `main` can wait for the next packaged release; do not replace an existing release archive just to update a guide.

## Publish

1. Commit the reviewed source, metadata, changelog, and any versioned download files. Push and wait for CI on that exact commit.
2. Prepare release notes with the user-facing changes, install instructions, compatibility limits, and validation actually performed.
3. Create a GitHub release with a new `v<version>` tag targeting the reviewed commit. Do not move an already published tag.
4. Attach the installation ZIPs and checksums when release-asset uploads are available. If using versioned repository downloads, put explicit download links in the release notes. GitHub's automatic source-code ZIP is not the standalone skill upload.
5. Download the public skill ZIP through the link a user will click, compare it with the checksum, and inspect its single `archive-to-obsidian/` root. Confirm the plugin and demo links too.
6. Check README links, the `main`/`push` test badge, and the public release page. Publish factual release notes without claims about untested real accounts or platforms.

Repository contents access, release publishing, release-asset uploading, and administration can have different permissions. An available GitHub connection does not imply all of them are granted. Use the account's normal access controls; never place a credential in documentation or ask someone to paste one into a public issue.

## Preserve the product boundary

Amberkeep converts an explicitly provided export into a new folder. The current design preserves source bytes and uses no network calls, account scraping, credential access, automatic existing-vault edits, or execution of exported content. Discuss changes to those boundaries as a separate design proposal with clear data handling, rather than slipping them into a format fix.

Security fixes should target the latest release, receive regression coverage with synthetic data, and explain the affected boundary without publishing private material. There is no guaranteed response or release schedule.
