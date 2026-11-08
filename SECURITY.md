# Security policy

## Supported version

Security fixes target the latest release. Amberkeep is an early community project; there is no guaranteed response time.

## Reporting a vulnerability

Do not publish private exports, credentials, exploit payloads containing real data, or conversation contents in an issue.

For a non-sensitive problem, open a [GitHub issue](https://github.com/emilfrolov/amberkeep/issues) with a minimal synthetic reproduction. For a sensitive finding, contact the maintainer through an available private channel on [their GitHub profile](https://github.com/emilfrolov) before disclosing details. If no private channel is available, open an issue asking for a secure contact without describing the vulnerability.

Useful reports describe the affected version, expected boundary, synthetic input, and observed result. Relevant boundaries include ZIP path handling, symbolic links, overwrite prevention, resource limits, and unintended execution or external requests.

## Data boundaries

Exports are untrusted input. The converter is intended to preserve bytes and render readable views without executing source code, calling exported tools, or fetching URLs. Review generated Markdown before enabling community plugins that interpret its contents. See [privacy](docs/PRIVACY.md) for storage and AI-session boundaries.
