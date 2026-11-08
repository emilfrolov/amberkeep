'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { VaultWriter } = require('../src/vault-writer');

class FakeVault {
  constructor() {
    this.entries = new Map();
    this.contents = new Map();
    this.created = [];
    this.processCalls = 0;
    this.processWrites = 0;
    this.modifications = 0;
    this.beforeProcess = null;
  }
  getAbstractFileByPath(path) { return this.entries.get(path) || null; }
  async createFolder(path) {
    if (this.entries.has(path)) throw new Error('Path exists');
    const entry = { path, children: [] };
    this.entries.set(path, entry);
    return entry;
  }
  async create(path, content) {
    if (this.entries.has(path)) throw new Error('Path exists');
    const entry = { path, extension: 'md' };
    this.entries.set(path, entry);
    this.contents.set(path, content);
    this.created.push(path);
    return entry;
  }
  async read(file) {
    assert(!Array.isArray(file.children));
    return this.contents.get(file.path);
  }
  async process(file, callback) {
    this.processCalls += 1;
    if (this.beforeProcess) {
      const hook = this.beforeProcess;
      this.beforeProcess = null;
      hook(file, this);
    }
    const before = this.contents.get(file.path);
    const after = callback(before);
    assert.equal(typeof after, 'string');
    this.processWrites += 1;
    if (after !== before) {
      this.contents.set(file.path, after);
      this.modifications += 1;
    }
    return after;
  }
}

function note(overrides = {}) {
  return { id: 'org-1:conversation-1', path: 'Amberkeep/Conversations/source-123.md',
    title: 'Invented conversation', kind: 'conversation', content: '# Source\n\nA useful fact.\n', ...overrides };
}

test('creates an owned note with byte-exact body and a matching generated hash', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  const source = note();
  assert.deepEqual(await writer.writeNotes([source]), {
    created: 1, updated: 0, unchanged: 0, conflicts: 0, conflictPaths: [],
  });
  const actual = vault.contents.get(source.path);
  assert.match(actual, /amberkeep_id: "org-1:conversation-1"/);
  const hash = createHash('sha256').update(source.content).digest('hex');
  assert(actual.includes(`<!-- amberkeep:begin sha256=${hash} -->\n${source.content}\n<!-- amberkeep:end -->`));
  assert(vault.entries.has('Amberkeep/Conversations'));
});

test('identical synchronization does not process or recreate notes', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const before = vault.contents.get(note().path);
  const count = vault.created.length;
  const result = await writer.writeNotes([note()]);
  assert.equal(result.unchanged, 1);
  assert.equal(vault.processCalls, 0);
  assert.equal(vault.created.length, count);
  assert.equal(vault.contents.get(note().path), before);
});

test('updates only the generated block, preserving custom frontmatter and user text', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const original = vault.contents.get(note().path);
  const modified = original.replace('amberkeep_schema: 1', 'amberkeep_schema: 1\ntags: [personal]\ncustom: "do not rewrite"')
    .replace('<!-- amberkeep:begin', 'My introduction.\n\n<!-- amberkeep:begin') + '\n## My observations\nKeep this intact.\n';
  vault.contents.set(note().path, modified);
  const result = await writer.writeNotes([note({ content: '# Source\n\nAn updated fact.' })]);
  const updated = vault.contents.get(note().path);
  assert.equal(result.updated, 1);
  assert.equal(vault.processCalls, 1);
  assert(updated.startsWith(modified.slice(0, modified.indexOf('<!-- amberkeep:begin'))));
  assert(updated.endsWith('\n## My observations\nKeep this intact.\n'));
  assert(updated.includes('An updated fact.'));
  assert(!updated.includes('A useful fact.'));
});

test('edited generated content creates a stable proposed version and leaves the original intact', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const edited = vault.contents.get(note().path).replace('A useful fact.', 'My manual edit.');
  vault.contents.set(note().path, edited);
  const update = note({ content: '# New source content' });
  const first = await writer.writeNotes([update]);
  const second = await writer.writeNotes([update]);
  assert.equal(first.conflicts, 1);
  assert.deepEqual(second.conflictPaths, first.conflictPaths);
  assert.equal(vault.contents.get(note().path), edited);
  assert.equal(vault.processCalls, 0);
  assert.equal(vault.created.filter(path => path.startsWith('Amberkeep/Conflicts/')).length, 1);
  assert(vault.contents.get(first.conflictPaths[0]).includes('# New source content'));
});

test('foreign files are never changed even if their title or path matches', async () => {
  const vault = new FakeVault();
  await vault.create(note().path, '---\nprivate: true\n---\nMy existing note.');
  const before = vault.contents.get(note().path);
  const result = await new VaultWriter(vault).writeNotes([note()]);
  assert.equal(result.conflicts, 1);
  assert.equal(vault.contents.get(note().path), before);
  assert.equal(vault.processCalls, 0);
});

test('a changed source ID cannot take ownership of an existing note', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const before = vault.contents.get(note().path);
  const result = await writer.writeNotes([note({ id: 'different-source' })]);
  assert.equal(result.conflicts, 1);
  assert.equal(vault.contents.get(note().path), before);
});

test('missing and duplicate generated markers are conflicts, not permission to overwrite', async () => {
  for (const edit of [
    text => text.replace('<!-- amberkeep:end -->', ''),
    text => text + '\n<!-- amberkeep:end -->\n',
    text => text.replace(/sha256=[a-f0-9]{64}/, 'sha256=invalid'),
  ]) {
    const vault = new FakeVault();
    const writer = new VaultWriter(vault);
    await writer.writeNotes([note()]);
    const before = edit(vault.contents.get(note().path));
    vault.contents.set(note().path, before);
    assert.equal((await writer.writeNotes([note({ content: 'Updated' })])).conflicts, 1);
    assert.equal(vault.contents.get(note().path), before);
  }
});

test('checks ownership and block integrity again inside the atomic Vault.process callback', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  let concurrentEdit;
  vault.beforeProcess = (file, store) => {
    concurrentEdit = store.contents.get(file.path).replace('A useful fact.', 'Edited during synchronization.');
    store.contents.set(file.path, concurrentEdit);
  };
  const result = await writer.writeNotes([note({ content: 'New generated data' })]);
  assert.equal(result.conflicts, 1);
  assert.equal(vault.contents.get(note().path), concurrentEdit);
  assert.equal(vault.modifications, 0);
  assert.equal(vault.processWrites, 0);
});

test('does not touch a note that another process has already updated to the desired content', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const update = note({ content: 'Already updated elsewhere.' });
  const other = new FakeVault();
  await new VaultWriter(other).writeNotes([update]);
  vault.beforeProcess = (file, store) => store.contents.set(file.path, other.contents.get(file.path));
  const result = await writer.writeNotes([update]);
  assert.equal(result.unchanged, 1);
  assert.equal(vault.processWrites, 0);
  assert.equal(vault.modifications, 0);
});

test('keeps concurrent user additions outside the generated block', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  vault.beforeProcess = (file, store) => store.contents.set(file.path, store.contents.get(file.path) + '\nA concurrent user addition.\n');
  const result = await writer.writeNotes([note({ content: 'New generated data' })]);
  assert.equal(result.updated, 1);
  assert(vault.contents.get(note().path).endsWith('\nA concurrent user addition.\n'));
});

test('edited conflict proposals are not overwritten or duplicated repeatedly', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await vault.create(note().path, 'Existing private note.');
  const first = await writer.writeNotes([note()]);
  const oldConflict = first.conflictPaths[0];
  const manual = vault.contents.get(oldConflict) + '\nReview notes added by me.\n';
  vault.contents.set(oldConflict, manual);
  const second = await writer.writeNotes([note()]);
  const third = await writer.writeNotes([note()]);
  assert.notEqual(second.conflictPaths[0], oldConflict);
  assert.deepEqual(second.conflictPaths, third.conflictPaths);
  assert.equal(vault.contents.get(oldConflict), manual);
  assert.equal(vault.created.filter(path => path.startsWith('Amberkeep/Conflicts/')).length, 2);
});

test('validates every note before any writes and rejects namespace escapes', async () => {
  const paths = ['../Other.md', '/Amberkeep/Note.md', 'Amberkeep/../Other.md', 'Amberkeep//Note.md',
    'Amberkeep\\Note.md', 'Other/Note.md', 'Amberkeep/.obsidian/Note.md', 'Amberkeep/CON.md',
    'Amberkeep/Note#.md', 'Amberkeep/Note.md ', 'Amberkeep/Note.canvas'];
  for (const path of paths) {
    const vault = new FakeVault();
    await assert.rejects(new VaultWriter(vault).writeNotes([note(), note({ id: 'second', path })]));
    assert.equal(vault.entries.size, 0, path);
  }
});

test('rejects duplicate paths, malformed IDs, unsafe roots, and source marker injection', async () => {
  assert.throws(() => new VaultWriter(new FakeVault(), { root: '.obsidian' }));
  assert.throws(() => new VaultWriter(new FakeVault(), { root: 'Amberkeep/..' }));
  for (const invalid of [note({ id: '' }), note({ id: 'id\nnew-key: true' }),
    note({ kind: 'not a kind' }), note({ content: '<!-- amberkeep:end -->' })]) {
    const vault = new FakeVault();
    await assert.rejects(new VaultWriter(vault).writeNotes([invalid]));
    assert.equal(vault.entries.size, 0);
  }
  const vault = new FakeVault();
  await assert.rejects(new VaultWriter(vault).writeNotes([note(), note({ id: 'other' })]));
  assert.equal(vault.entries.size, 0);
});

test('supports a nested configured namespace and ignores incidental source paths', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault, { root: 'Knowledge/Amberkeep' });
  const result = await writer.writeNotes([note({ path: 'Knowledge/Amberkeep/Sources/note.md', raw: { path: '../../private' } })]);
  assert.equal(result.created, 1);
  assert.equal(vault.created[0], 'Knowledge/Amberkeep/Sources/note.md');
  assert.equal([...vault.entries.keys()].some(path => path.includes('private')), false);
});

test('duplicate ownership keys cannot authorize overwriting a user file', async () => {
  const vault = new FakeVault();
  const writer = new VaultWriter(vault);
  await writer.writeNotes([note()]);
  const before = vault.contents.get(note().path).replace('amberkeep_schema: 1', 'amberkeep_schema: 1\namberkeep_id: "someone-else"');
  vault.contents.set(note().path, before);
  const result = await writer.writeNotes([note({ content: 'Changed' })]);
  assert.equal(result.conflicts, 1);
  assert.equal(vault.contents.get(note().path), before);
});

test('common YAML reformatting of the ownership value still preserves all frontmatter bytes', async () => {
  for (const value of ["'org-1:conversation-1'", 'org-1:conversation-1 # ownership']) {
    const vault = new FakeVault();
    const writer = new VaultWriter(vault);
    await writer.writeNotes([note()]);
    const before = vault.contents.get(note().path).replace('"org-1:conversation-1"', value);
    vault.contents.set(note().path, before);
    const result = await writer.writeNotes([note({ content: 'Updated' })]);
    assert.equal(result.updated, 1);
    assert(vault.contents.get(note().path).includes(`amberkeep_id: ${value}`));
  }
});

module.exports = { FakeVault };
