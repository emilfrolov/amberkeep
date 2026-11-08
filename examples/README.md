# Synthetic demo export

Every person, account identifier, conversation, project, and memory in `demo-export/` is invented. These files exercise observed export shapes; they are not an official Anthropic schema or a copy of a real account export.

The example includes two conversations, five messages, one project with a document, conversation and project memory, a memory file, account data, an unfamiliar content block, and a sample text attachment. Claude's official export normally excludes original uploaded files; the sample attachment demonstrates preservation of bytes that are explicitly included in the supplied directory.

Run from the repository root:

```bash
python3 skills/archive-to-obsidian/scripts/convert.py \
  --input examples/demo-export \
  --output /tmp/Amberkeep-Demo \
  --zip /tmp/Amberkeep-Demo.zip
```

Choose new destination names if you have already run the example. Keep the generated folder intact and open its parent as an Obsidian vault, or copy the whole folder into your existing vault.
