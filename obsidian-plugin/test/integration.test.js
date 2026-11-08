'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { buildGraph } = require('../src/graph');

const MANIFEST = { id: 'amberkeep', dir: '.obsidian/plugins/amberkeep', version: '0.2.0' };
const clone = value => JSON.parse(JSON.stringify(value));

class TestVault {
  constructor(base) {
    this.base = base;
    this.noteWrites = [];
    this.adapterWrites = [];
    this.beforeAdapterWrite = null;
    this.adapter = {
      getBasePath: () => base,
      exists: async relative => fs.existsSync(this.absolute(relative)),
      read: relative => fsp.readFile(this.absolute(relative), 'utf8'),
      write: async (relative, content) => {
        if (this.beforeAdapterWrite) await this.beforeAdapterWrite(relative, content);
        this.adapterWrites.push(relative);
        await fsp.mkdir(path.dirname(this.absolute(relative)), { recursive: true });
        await fsp.writeFile(this.absolute(relative), content, 'utf8');
      },
      rename: (from, to) => fsp.rename(this.absolute(from), this.absolute(to)),
      remove: relative => fsp.rm(this.absolute(relative), { force: true }),
      mkdir: relative => fsp.mkdir(this.absolute(relative), { recursive: true }),
    };
  }
  absolute(relative) {
    const destination = path.resolve(this.base, relative);
    if (destination !== this.base && !destination.startsWith(this.base + path.sep)) throw new Error('Test vault path escape');
    return destination;
  }
  getAbstractFileByPath(relative) {
    const absolute = this.absolute(relative);
    if (!fs.existsSync(absolute)) return null;
    return fs.statSync(absolute).isDirectory()
      ? { path: relative, children: [] }
      : { path: relative, extension: path.extname(relative).slice(1) };
  }
  async createFolder(relative) {
    await fsp.mkdir(this.absolute(relative));
    return this.getAbstractFileByPath(relative);
  }
  async create(relative, content) {
    await fsp.writeFile(this.absolute(relative), content, { encoding: 'utf8', flag: 'wx' });
    this.noteWrites.push({ path: relative, operation: 'create' });
    return this.getAbstractFileByPath(relative);
  }
  read(file) { return fsp.readFile(this.absolute(file.path), 'utf8'); }
  cachedRead(file) { return this.read(file); }
  async process(file, callback) {
    const before = await this.read(file);
    const after = callback(before);
    assert.equal(typeof after, 'string');
    if (after !== before) {
      await fsp.writeFile(this.absolute(file.path), after, 'utf8');
      this.noteWrites.push({ path: file.path, operation: 'process' });
    }
    return after;
  }
}

function fixture() {
  const stamp = '2026-02-01T10:00:00Z';
  const data = {
    requests: [], bridge: null, sessions: [], notices: [],
    conversations: [
      { uuid: 'chat-a', name: 'Local archive design', project_uuid: 'project-a', updated_at: stamp,
        chat_messages: [
          { uuid: 'message-a1', sender: 'human', text: 'SQLite keeps the archive local. We chose SQLite for the local archive.', created_at: stamp },
          { uuid: 'message-a2', sender: 'assistant', text: 'Preserve each source quotation and its message identifier.', parent_message_uuid: 'message-a1', created_at: stamp },
        ] },
      { uuid: 'chat-b', name: 'SQLite migration plan', project_uuid: 'project-a', updated_at: stamp,
        chat_messages: [
          { uuid: 'message-b1', sender: 'human', text: 'SQLite migrations must preserve source evidence.', created_at: stamp },
        ] },
    ],
  };
  data.request = async (apiPath, { signal } = {}) => {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    data.requests.push(apiPath);
    const url = new URL(apiPath, 'https://claude.ai');
    if (url.pathname === '/api/organizations') return [{ uuid: 'org-a', name: 'Invented personal workspace' }];
    if (url.pathname === '/api/account_profile') return { name: 'Synthetic reader' };
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      return { data: data.conversations.map(({ uuid, name, project_uuid, updated_at }) => ({ uuid, name, project_uuid, updated_at })), has_more: false };
    }
    const conversation = /\/chat_conversations\/([^/]+)$/.exec(url.pathname);
    if (conversation) {
      assert.equal(url.searchParams.get('tree'), 'True');
      return clone(data.conversations.find(item => item.uuid === conversation[1]));
    }
    if (url.pathname === '/api/organizations/org-a/projects') return { data: [{ uuid: 'project-a', name: 'Amberkeep research' }], has_more: false };
    if (url.pathname.endsWith('/projects/project-a')) return { uuid: 'project-a', name: 'Amberkeep research', description: 'A synthetic archive project.', prompt_template: 'Keep evidence with each claim.' };
    if (url.pathname.endsWith('/projects/project-a/docs')) return { data: [{ uuid: 'document-a', filename: 'Principles', content: 'Every claim needs source evidence.' }], has_more: false };
    if (url.pathname.endsWith('/memory')) return { memory: url.searchParams.has('project_uuid') ? 'Keep project evidence.' : 'Prefer local archives.', updated_at: stamp };
    throw new Error('Unexpected fixture route: ' + apiPath);
  };
  return data;
}

function loadPlugin(data) {
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
      this.savedData = { autoSyncMinutes: 0, localModel: '', enabled: false };
      this.commands = [];
    }
    async loadData() { return clone(this.savedData); }
    async saveData(value) { this.savedData = clone(value); }
    registerView() {}
    addRibbonIcon() {}
    addCommand(command) { this.commands.push(command); }
    addSettingTab() {}
    addStatusBarItem() { return { textContent: '', addEventListener() {} }; }
  }
  class Modal {
    constructor(app) { this.app = app; this.contentEl = { empty() {} }; }
    open() { this.opened = true; }
    close() { this.opened = false; }
  }
  class ClaudeSession {
    constructor(vaultPath) { this.vaultPath = vaultPath; this.destroyed = false; data.sessions.push(this); }
    getJSON(apiPath, options) { return data.request(apiPath, options); }
    hide() {}
    async disconnect() { this.destroy(); return true; }
    destroy() { this.destroyed = true; }
  }
  const original = Module._load;
  const filename = require.resolve('../src/main');
  delete require.cache[filename];
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === filename) {
      if (request === 'obsidian') return { Plugin, PluginSettingTab: class {}, Setting: class {}, ItemView: class {}, Modal,
        Notice: class { constructor(message) { data.notices.push(message); } } };
      if (request === './session') return { ClaudeSession };
      if (request === './bridge') return { startBridge: async ({ vaultPath, handlers }) => {
        data.bridge = { vaultPath, handlers, closed: false, close: async () => { data.bridge.closed = true; } };
        return data.bridge;
      } };
    }
    return original.call(this, request, parent, isMain);
  };
  try { return require(filename); } finally { Module._load = original; }
}

async function setup(t) {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'amberkeep-integration-'));
  const data = fixture();
  const vault = new TestVault(base);
  await fsp.mkdir(path.join(base, MANIFEST.dir), { recursive: true });
  const commands = [];
  const app = { vault, workspace: { getLeavesOfType: () => [], getLeaf: () => ({ setViewState: async () => {} }), revealLeaf() {}, onLayoutReady() {} },
    commands: { executeCommandById: id => { commands.push(id); return true; } } };
  const Plugin = loadPlugin(data);
  const plugin = new Plugin(app, MANIFEST);
  await plugin.onload();
  plugin.client.requestIntervalMs = 0;
  plugin.client.now = () => Date.parse('2026-02-02T10:00:00Z');
  t.after(async () => { plugin.onunload(); await Promise.resolve(); await fsp.rm(base, { recursive: true, force: true }); });
  function enable() { plugin.settings.enabled = true; plugin.connected = true; }
  async function sync() {
    const result = data.bridge.handlers.sync();
    assert.equal(result.started, true);
    const task = plugin.syncTask;
    await task;
    assert.equal(plugin.error, '', plugin.error);
    return plugin.status();
  }
  return { plugin, vault, data, base, commands, enable, sync };
}

function payload(source, title = 'SQLite', quote) {
  const message = source.messages.find(item => item.text.includes(quote || 'SQLite'));
  return { sourceId: source.id, sourceHash: source.hash, concepts: [{ title, kind: 'tool',
    summary: 'This source describes SQLite as part of its archive design.',
    evidence: [{ messageId: message.id, quote: quote || 'SQLite' }] }], relations: [] };
}

test('an unconnected vault does not read Claude automatically or from the MCP sync route', async t => {
  const env = await setup(t);
  assert.equal(env.plugin.startSync(true).started, false);
  assert.equal(env.data.bridge.handlers.sync().started, false);
  assert.equal(env.plugin.status().needsConnection, true);
  assert.equal(env.data.requests.length, 0);
  assert.equal(env.plugin.connectModal.opened, true);
});

test('sync, graph writing, paged source reading, and semantic save connect through the plugin bridge', async t => {
  const env = await setup(t);
  assert.equal(env.data.bridge.vaultPath, fs.realpathSync(env.base));
  assert.equal(env.plugin.status().sourceCount, 0);
  env.enable();
  const status = await env.sync();
  assert.equal(status.conversationCount, 2);
  assert.equal(status.projectCount, 1);
  assert(status.sourceCount >= 4);
  assert.equal(status.analysedSources, 0);
  assert.equal(status.pendingSources, status.sourceCount);
  assert.equal(status.partial, false);
  assert.equal(env.plugin.status().busy, false);

  const graph = buildGraph(env.plugin.snapshot, []);
  const targets = new Set(graph.notes.map(note => note.path.replace(/\.md$/, '')));
  const anchors = new Map();
  for (const note of graph.notes) {
    const document = await fsp.readFile(env.vault.absolute(note.path), 'utf8');
    assert(document.includes('amberkeep_id:'));
    anchors.set(note.path.replace(/\.md$/, ''), new Set([...document.matchAll(/^\^([^\s]+)$/gm)].map(match => match[1])));
  }
  for (const note of graph.notes) for (const match of note.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const [target, anchor] = match[1].split('#^');
    assert(targets.has(target), 'Unresolved graph target: ' + target);
    if (anchor) assert(anchors.get(target).has(anchor), 'Unresolved evidence anchor: ' + anchor);
  }

  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  let offset = 0;
  const restored = new Map();
  do {
    const page = env.data.bridge.handlers.source(source.id, new URLSearchParams({ offset: String(offset), limit: '11' }));
    assert.equal(page.sourceHash, source.hash);
    assert.equal(page.offset, offset);
    for (const message of page.messages) restored.set(message.id, (restored.get(message.id) || '') + message.text);
    if (page.done) { assert.equal(page.nextOffset, null); break; }
    assert(page.nextOffset > offset);
    offset = page.nextOffset;
  } while (offset < 10000);
  for (const message of source.messages) assert.equal(restored.get(message.id), message.text);

  const before = env.plugin.status().pendingSources;
  const result = await env.data.bridge.handlers.knowledge(payload(source));
  assert.equal(result.saved, true);
  assert.equal(result.pendingSources, before - 1);
  assert.equal(result.analysedSources, 1);
  const stored = JSON.parse(await env.vault.adapter.read(env.plugin.knowledgePath));
  assert.equal(stored[0].sourceId, source.id);
  const knowledge = buildGraph(env.plugin.snapshot, env.plugin.enrichments).notes.find(item => item.kind === 'tool');
  const document = await fsp.readFile(env.vault.absolute(knowledge.path), 'utf8');
  assert(document.includes('AI-enriched knowledge'));
  assert(document.includes('#^m-'));
});

test('stale hashes and fabricated quotations cannot complete a pending source', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  const count = env.plugin.status().pendingSources;
  const stale = payload(source);
  stale.sourceHash = '0'.repeat(64);
  await assert.rejects(env.data.bridge.handlers.knowledge(stale), /stale/i);
  const fabricated = payload(source);
  fabricated.concepts[0].evidence[0].quote = 'This sentence never appeared in the source.';
  await assert.rejects(env.data.bridge.handlers.knowledge(fabricated), /verbatim/i);
  assert.equal(env.plugin.status().pendingSources, count);
  assert.equal(env.plugin.enrichments.length, 0);
});

test('parallel semantic submissions retain both sources in memory and on disk', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const sources = env.plugin.sources().filter(item => item.kind === 'conversation');
  let delayed = false;
  env.vault.beforeAdapterWrite = async (relative, content) => {
    if (relative.includes('knowledge') && !delayed && JSON.parse(content).length === 1) {
      delayed = true;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  await Promise.all(sources.map(source => env.data.bridge.handlers.knowledge(payload(source))));
  const persisted = JSON.parse(await env.vault.adapter.read(env.plugin.knowledgePath));
  assert.deepEqual(new Set(persisted.map(item => item.sourceId)), new Set(sources.map(item => item.id)));
  assert.equal(env.plugin.enrichments.length, 2);
  assert.equal(env.plugin.status().analysedSources, 2);
});

test('a failed knowledge cache write does not mark analysis complete', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  const before = env.plugin.status().pendingSources;
  env.vault.beforeAdapterWrite = async relative => { if (relative.includes('knowledge')) throw new Error('Simulated full disk'); };
  await assert.rejects(env.data.bridge.handlers.knowledge(payload(source)), /full disk/);
  assert.equal(env.plugin.status().pendingSources, before);
  assert.equal(env.plugin.enrichments.length, 0);
});

test('a failed snapshot write keeps the last source cache and graph intact', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const oldSnapshot = clone(env.plugin.snapshot);
  const oldDisk = await env.vault.adapter.read(env.plugin.cachePath);
  const writes = env.vault.noteWrites.length;
  env.data.conversations[0].updated_at = '2026-02-03T10:00:00Z';
  env.data.conversations[0].chat_messages[0].text = 'Changed remote content that could not be saved.';
  env.vault.beforeAdapterWrite = async relative => { if (relative.includes('snapshot')) throw new Error('Simulated cache failure'); };
  env.plugin.startSync();
  await env.plugin.syncTask;
  assert.match(env.plugin.error, /cache failure/);
  assert.deepEqual(env.plugin.snapshot, oldSnapshot);
  assert.equal(await env.vault.adapter.read(env.plugin.cachePath), oldDisk);
  assert.equal(env.vault.noteWrites.length, writes);
});

test('unchanged sync avoids note writes, and later source updates preserve user additions', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const initialWrites = env.vault.noteWrites.length;
  await env.sync();
  assert.equal(env.vault.noteWrites.length, initialWrites);
  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  const sourceNote = buildGraph(env.plugin.snapshot, []).notes.find(item => item.id === source.id);
  await fsp.appendFile(env.vault.absolute(sourceNote.path), '\n## My notes\nKeep my annotation.\n');
  env.data.conversations[0].updated_at = '2026-02-04T10:00:00Z';
  env.data.conversations[0].chat_messages[0].text += ' New source detail.';
  await env.sync();
  const updated = await fsp.readFile(env.vault.absolute(sourceNote.path), 'utf8');
  assert(updated.includes('New source detail.'));
  assert(updated.endsWith('\n## My notes\nKeep my annotation.\n'));
});

test('manual edits inside a generated source are preserved and receive a conflict proposal', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  const sourceNote = buildGraph(env.plugin.snapshot, []).notes.find(item => item.id === source.id);
  const edited = (await fsp.readFile(env.vault.absolute(sourceNote.path), 'utf8')).replace('SQLite keeps the archive local.', 'My manual correction.');
  await fsp.writeFile(env.vault.absolute(sourceNote.path), edited);
  env.data.conversations[0].updated_at = '2026-02-05T10:00:00Z';
  env.data.conversations[0].chat_messages[0].text += ' Proposed new detail.';
  await env.sync();
  assert.equal(await fsp.readFile(env.vault.absolute(sourceNote.path), 'utf8'), edited);
  assert(env.plugin.writeResult.conflicts >= 1);
  const proposals = await Promise.all(env.plugin.writeResult.conflictPaths.map(relative => fsp.readFile(env.vault.absolute(relative), 'utf8')));
  assert(proposals.some(content => content.includes('Proposed new detail.')));
});

test('changed source hashes retire old synthesis without deleting its evidence or rewriting it repeatedly', async t => {
  const env = await setup(t);
  env.enable();
  await env.sync();
  const source = env.plugin.sources().find(item => item.externalId === 'chat-a');
  await env.data.bridge.handlers.knowledge(payload(source));
  const knowledgeNote = buildGraph(env.plugin.snapshot, env.plugin.enrichments).notes.find(item => item.kind === 'tool');
  assert(knowledgeNote);
  env.data.conversations[0].updated_at = '2026-02-06T10:00:00Z';
  env.data.conversations[0].chat_messages[0].text = 'PostgreSQL replaces our earlier archive database choice.';
  await env.sync();
  assert(env.plugin.pendingSources().some(item => item.externalId === 'chat-a'));
  const retired = await fsp.readFile(env.vault.absolute(knowledgeNote.path), 'utf8');
  assert(retired.includes('#amberkeep/stale'));
  assert(retired.includes('SQLite'));
  assert(retired.includes('source-specific summaries'));
  assert(retired.includes('markdown\n'));
  const writes = env.vault.noteWrites.length;
  await env.plugin.renderGraph();
  await env.plugin.renderGraph();
  assert.equal(await fsp.readFile(env.vault.absolute(knowledgeNote.path), 'utf8'), retired);
  assert.equal(env.vault.noteWrites.length, writes);
});

test('unloading closes the isolated session, local bridge, and scheduled activity', async t => {
  const env = await setup(t);
  env.enable();
  env.plugin.settings.autoSyncMinutes = 15;
  env.plugin.schedule();
  const timer = env.plugin.timer;
  env.plugin.onunload();
  await Promise.resolve();
  assert.equal(env.data.sessions[0].destroyed, true);
  assert.equal(env.data.bridge.closed, true);
  if (timer && typeof timer.hasRef === 'function') assert.equal(timer._destroyed, true);
});
