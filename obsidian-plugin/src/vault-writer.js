'use strict';

const { createHash } = require('node:crypto');

const BEGIN_PREFIX = '<!-- amberkeep:begin sha256=';
const END_MARKER = '<!-- amberkeep:end -->';
const RESERVED_MARKER = /<!--\s*amberkeep:(?:begin|end)\b/;
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safePath(value, { markdown = false } = {}) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\') || value.length > 2048) {
    throw new Error('Amberkeep paths must be safe relative vault paths.');
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment.startsWith('.') || /[. ]$/.test(segment) ||
        /[<>:"|?*#^\[\]\x00-\x1f\x7f]/.test(segment) || DEVICE_NAME.test(segment) ||
        Buffer.byteLength(segment, 'utf8') > 200) {
      throw new Error('Amberkeep paths contain an unsafe or non-portable component.');
    }
  }
  if (markdown && !value.endsWith('.md')) {
    throw new Error('Amberkeep managed notes must use a .md extension.');
  }
  return value;
}

function validateNote(note, root) {
  if (!note || typeof note !== 'object' || Array.isArray(note)) {
    throw new Error('A managed note must be an object.');
  }
  if (typeof note.id !== 'string' || !note.id || note.id.trim() !== note.id ||
      note.id.length > 512 || /[\x00-\x1f\x7f]/.test(note.id)) {
    throw new Error('A managed note requires a valid stable string ID.');
  }
  safePath(note.path, { markdown: true });
  if (!note.path.startsWith(root + '/')) {
    throw new Error('A managed note path must remain inside the Amberkeep root.');
  }
  if (typeof note.kind !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(note.kind)) {
    throw new Error('A managed note requires a valid kind.');
  }
  if (typeof note.title !== 'string' || note.title.length > 4096 || typeof note.content !== 'string') {
    throw new Error('A managed note requires a string title and generated content.');
  }
  if (RESERVED_MARKER.test(note.content)) {
    throw new Error('Generated content must not contain reserved Amberkeep block markers.');
  }
  return note;
}

function generatedBlock(content) {
  return `${BEGIN_PREFIX}${digest(content)} -->\n${content}\n${END_MARKER}`;
}

function newDocument(note) {
  return [
    '---',
    `amberkeep_id: ${JSON.stringify(note.id)}`,
    `amberkeep_kind: ${JSON.stringify(note.kind)}`,
    'amberkeep_schema: 1',
    `title: ${JSON.stringify(note.title)}`,
    '---',
    '',
    generatedBlock(note.content),
    '',
  ].join('\n');
}

// Read just the ownership key; never deserialize and rewrite the user's YAML.
// Our own key is JSON quoted, but common YAML reformatting is accepted too.
function ownership(current) {
  const opening = /^---\r?\n/.exec(current);
  if (!opening) return null;
  const rest = current.slice(opening[0].length);
  const closing = /^---\r?$/m.exec(rest);
  if (!closing) return null;
  const frontmatter = rest.slice(0, closing.index);
  const values = [...frontmatter.matchAll(/^amberkeep_id:[ \t]*(.*)$/gm)];
  if (values.length !== 1) return null;
  const raw = values[0][1].replace(/\r$/, '').trim();
  if (raw.startsWith('"')) {
    try {
      const value = JSON.parse(raw);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  if (raw.startsWith("'")) {
    return /^'(?:[^']|'')*'$/.test(raw) ? raw.slice(1, -1).replace(/''/g, "'") : null;
  }
  const plain = raw.replace(/[ \t]+#.*$/, '').trim();
  if (!plain || /^[&*!>|[\]{}]/.test(plain) || /^(?:null|true|false|~)$/i.test(plain)) return null;
  return plain;
}

function inspectDocument(current, note) {
  if (ownership(current) !== note.id) {
    return { conflict: 'The existing note is not owned by this source ID.' };
  }
  const starts = [...current.matchAll(/<!--\s*amberkeep:begin\b/g)];
  const ends = [...current.matchAll(/<!--\s*amberkeep:end\b/g)];
  if (starts.length !== 1 || ends.length !== 1) {
    return { conflict: 'The generated block markers are missing or ambiguous.' };
  }
  const begin = /<!-- amberkeep:begin sha256=([a-f0-9]{64}) -->\n/.exec(current);
  if (!begin || (begin.index > 0 && current[begin.index - 1] !== '\n')) {
    return { conflict: 'The generated block header is not recognized.' };
  }
  const contentStart = begin.index + begin[0].length;
  const separator = '\n' + END_MARKER;
  const contentEnd = current.indexOf(separator, contentStart);
  if (contentEnd < contentStart) {
    return { conflict: 'The generated block is incomplete.' };
  }
  const end = contentEnd + separator.length;
  if (end < current.length && current[end] !== '\n' && current[end] !== '\r') {
    return { conflict: 'The generated block ending is not recognized.' };
  }
  const content = current.slice(contentStart, contentEnd);
  if (digest(content) !== begin[1]) {
    return { conflict: 'The generated block was edited; the proposed update was saved separately.' };
  }
  if (content === note.content) return { unchanged: true, document: current };
  return {
    document: current.slice(0, begin.index) + generatedBlock(note.content) + current.slice(end),
  };
}

function isFolder(entry) {
  return Boolean(entry && Array.isArray(entry.children));
}

class VaultWriter {
  constructor(vault, { root = 'Amberkeep' } = {}) {
    this.vault = vault;
    this.root = safePath(root);
    for (const name of ['getAbstractFileByPath', 'createFolder', 'create', 'process', 'read']) {
      if (!vault || typeof vault[name] !== 'function') {
        throw new Error(`VaultWriter requires vault.${name}().`);
      }
    }
  }

  async ensureParents(path) {
    const segments = path.split('/').slice(0, -1);
    let folderPath = '';
    for (const segment of segments) {
      folderPath = folderPath ? folderPath + '/' + segment : segment;
      let existing = this.vault.getAbstractFileByPath(folderPath);
      if (!existing) {
        try {
          await this.vault.createFolder(folderPath);
        } catch (error) {
          existing = this.vault.getAbstractFileByPath(folderPath);
          if (!isFolder(existing)) throw error;
        }
        existing = this.vault.getAbstractFileByPath(folderPath);
      }
      if (!isFolder(existing)) {
        throw new Error(`A file blocks the destination folder: ${folderPath}`);
      }
    }
  }

  async saveConflict(note, reason) {
    const content = [
      '# Proposed Amberkeep update',
      '',
      `Original target: \`${note.path}\``,
      '',
      reason,
      '',
      'The original note was not replaced. Review this proposed content manually.',
      '',
      '---',
      '',
      note.content,
    ].join('\n');
    const proposalHash = digest(content);
    const base = `${this.root}/Conflicts/${digest(note.id).slice(0, 20)}--${proposalHash.slice(0, 16)}`;
    const proposal = {
      id: `conflict:${digest(note.id)}:${proposalHash}`,
      kind: 'conflict',
      title: `Proposed update: ${note.title}`,
      content,
    };
    const document = newDocument(proposal);
    let path = base + '.md';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const existing = this.vault.getAbstractFileByPath(path);
      if (!existing) {
        await this.ensureParents(path);
        try {
          await this.vault.create(path, document);
          return path;
        } catch (error) {
          if (!this.vault.getAbstractFileByPath(path)) throw error;
          // A concurrent creator reserved this path. Inspect it on the next pass.
          continue;
        }
      }
      if (!isFolder(existing)) {
        const current = await this.vault.read(existing);
        if (current === document) return path;
        path = `${base}--${digest(path + '\0' + current).slice(0, 12)}.md`;
      } else {
        path = `${base}--${digest(path + '\0folder').slice(0, 12)}.md`;
      }
    }
    throw new Error('Could not reserve a conflict note without overwriting existing files.');
  }

  async writeOne(note) {
    let existing = this.vault.getAbstractFileByPath(note.path);
    if (!existing) {
      await this.ensureParents(note.path);
      try {
        await this.vault.create(note.path, newDocument(note));
        return { status: 'created' };
      } catch (error) {
        existing = this.vault.getAbstractFileByPath(note.path);
        if (!existing) throw error;
      }
    }
    if (isFolder(existing)) {
      return { status: 'conflicts', path: await this.saveConflict(note, 'A folder occupies the proposed note path.') };
    }
    const before = inspectDocument(await this.vault.read(existing), note);
    if (before.conflict) {
      return { status: 'conflicts', path: await this.saveConflict(note, before.conflict) };
    }
    if (before.unchanged) return { status: 'unchanged' };

    let result;
    const skipWrite = new Error('Amberkeep skipped an atomic write.');
    try {
      await this.vault.process(existing, (current) => {
        result = inspectDocument(current, note);
        // Vault.process may write even an identical return value. Throwing here
        // aborts that write when a concurrent edit made it unsafe or unnecessary.
        if (result.conflict || result.unchanged) throw skipWrite;
        return result.document;
      });
    } catch (error) {
      if (error !== skipWrite) throw error;
    }
    if (result.conflict) {
      return { status: 'conflicts', path: await this.saveConflict(note, result.conflict) };
    }
    return { status: result.unchanged ? 'unchanged' : 'updated' };
  }

  async writeNotes(notes) {
    if (!Array.isArray(notes)) throw new Error('Managed notes must be an array.');
    const paths = new Set();
    const ids = new Set();
    // Validate the complete batch before creating any destination.
    for (const note of notes) {
      validateNote(note, this.root);
      if (paths.has(note.path) || ids.has(note.id)) {
        throw new Error('A generated batch contains duplicate paths or IDs.');
      }
      paths.add(note.path);
      ids.add(note.id);
    }
    const summary = { created: 0, updated: 0, unchanged: 0, conflicts: 0, conflictPaths: [] };
    for (const note of notes) {
      const result = await this.writeOne(note);
      summary[result.status] += 1;
      if (result.path) summary.conflictPaths.push(result.path);
    }
    return summary;
  }
}

module.exports = { VaultWriter, generatedBlock, inspectDocument };
