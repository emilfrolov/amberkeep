'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listSources, buildGraph, validateKnowledge, messageAnchor } = require('../src/graph');

function fixture() {
  return {
    version: 1, complete: true, warnings: [], organizations: [{ id: 'org-a', name: 'Personal' }],
    conversations: [
      { id: 'chat-1', organizationId: 'org-a', title: 'SQLite for the reading app', projectId: 'project-1', updatedAt: '2026-01-01T12:00:00Z', messages: [
        { id: 'message-1', role: 'human', text: 'Can SQLite store the reading list?' },
        { id: 'message-2', role: 'assistant', text: 'We decided to use SQLite for local storage.' },
      ] },
      { id: 'chat-2', organizationId: 'org-a', title: 'SQLite indexes', updatedAt: '2026-01-02T12:00:00Z', messages: [
        { id: 'message-3', role: 'human', text: 'How do indexes work in SQLite?' },
        { id: 'message-4', role: 'assistant', text: 'SQLite supports indexes for faster lookups. Thank you, please ask another question.' },
      ] },
    ],
    projects: [{ id: 'project-1', organizationId: 'org-a', title: 'Reading app', description: 'A local reading application.', instructions: 'Preserve source citations.', documents: [{ id: 'doc-1', title: 'Design', text: 'SQLite is the local store.' }] }],
    memories: [{ id: 'memory-1', organizationId: 'org-a', title: 'Preferences', text: 'Keep explanations concise.', projectId: 'project-1' }],
  };
}

function knowledge(source, overrides = {}) {
  return {
    sourceId: source.id, sourceHash: source.hash,
    concepts: [{ title: 'SQLite', kind: 'tool', summary: 'This source discusses SQLite for local storage.', evidence: [{ messageId: source.messages[0].id, quote: 'SQLite' }] }],
    relations: [], ...overrides,
  };
}

function checkLinks(graph) {
  const byPath = new Map(graph.notes.map(note => [note.path.replace(/\.md$/, ''), note]));
  for (const note of graph.notes) {
    for (const match of note.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
      const [path, anchor] = match[1].split('#^');
      assert.ok(byPath.has(path), `Broken note target from ${note.path}: ${path}`);
      if (anchor) assert.match(byPath.get(path).content, new RegExp('\\^' + anchor + '(?:\\n|$)'), `Missing source anchor ${anchor}`);
    }
  }
}

test('source IDs remain stable and a path registry preserves note paths on rename and reorder', () => {
  const original = fixture();
  const changed = fixture();
  changed.conversations.reverse();
  changed.projects.reverse();
  changed.conversations[0].title = 'A newly named discussion';
  const before = listSources(original);
  const after = listSources(changed);
  assert.deepEqual(before.map(source => source.id), after.map(source => source.id));
  const firstGraph = buildGraph(original, []);
  const registry = Object.fromEntries(firstGraph.notes.map(note => [note.id, note.path]));
  const nextGraph = buildGraph(changed, [], { pathMap: registry });
  for (const source of after) assert.equal(nextGraph.notes.find(note => note.id === source.id).path, registry[source.id]);
  checkLinks(nextGraph);
  assert.notEqual(before.find(source => source.externalId === 'chat-2').hash, after.find(source => source.externalId === 'chat-2').hash);
});

test('first-sync filenames expose readable knowledge and source labels in the native graph', () => {
  const snapshot = fixture();
  const source = listSources(snapshot).find(item => item.externalId === 'chat-1');
  const graph = buildGraph(snapshot, [knowledge(source)]);
  assert.match(graph.notes.find(note => note.id === source.id).path, /Conversations\/SQLite for the reading app--[a-f0-9]{12}\.md$/);
  assert.match(graph.notes.find(note => note.kind === 'tool').path, /Knowledge\/SQLite--[a-f0-9]{12}\.md$/);
  assert.match(graph.notes.find(note => note.kind === 'project').path, /Projects\/Reading app--[a-f0-9]{12}\.md$/);
  assert.ok(graph.notes.every(note => !/(?:Concept|Conversation|Topic|Memory|Tool|Document)--[a-f0-9]{12}\.md$/.test(note.path)));
  checkLinks(graph);
});

test('Unicode filenames are readable, bounded, and portable without losing organization isolation', () => {
  const snapshot = { conversations: ['a', 'b'].map(organizationId => ({ id: 'same', organizationId, title: 'Знания: SQLite / память? [граф] <заметки> ' + 'я'.repeat(200), messages: [{ id: 'm', role: 'human', text: 'Как сохранить знания в SQLite?' }] })) };
  const graph = buildGraph(snapshot, []);
  const conversationNotes = graph.notes.filter(note => note.kind === 'conversation');
  assert.equal(new Set(conversationNotes.map(note => note.path)).size, 2);
  for (const note of conversationNotes) {
    const filename = note.path.split('/').at(-1);
    assert.match(filename, /^Знания SQLite память граф заметки/);
    assert.ok(Buffer.byteLength(filename, 'utf8') <= 255);
    assert.ok(!/[<>:"\\|?*#^\[\]]/.test(filename));
  }
  checkLinks(graph);
});

test('unsafe, conflicting, and out-of-root stored paths cannot redirect knowledge writes', () => {
  const snapshot = fixture();
  const sources = listSources(snapshot);
  const pathMap = {
    [sources[0].id]: 'Amberkeep/../Outside.md',
    [sources[1].id]: 'OtherRoot/Secret.md',
    [sources[2].id]: 'Amberkeep/Knowledge/Preserved name.md',
    [sources[3].id]: 'Amberkeep/Knowledge/Preserved name.md',
    [sources[4].id]: 'Amberkeep/.obsidian/Settings.md',
  };
  const graph = buildGraph(snapshot, [], { pathMap });
  assert.ok(graph.notes.every(note => note.path.startsWith('Amberkeep/') && !note.path.includes('/../') && !note.path.includes('/.obsidian/')));
  assert.equal(new Set(graph.notes.map(note => note.path.toLowerCase())).size, graph.notes.length);
  assert.equal(graph.notes.find(note => note.id === sources[2].id).path, 'Amberkeep/Knowledge/Preserved name.md');
  assert.ok(graph.warnings.some(warning => /stored note path/.test(warning)));
  checkLinks(graph);
});

test('reordering unrelated sources does not invalidate their current knowledge hashes', () => {
  const snapshot = fixture();
  const before = listSources(snapshot);
  snapshot.conversations.reverse();
  assert.deepEqual(listSources(snapshot).map(source => [source.id, source.hash]), before.map(source => [source.id, source.hash]));
});

test('same UUIDs in different organizations do not collide', () => {
  const snapshot = fixture();
  snapshot.conversations.push({ ...snapshot.conversations[0], organizationId: 'org-b' });
  const duplicates = listSources(snapshot).filter(source => source.externalId === 'chat-1');
  assert.equal(duplicates.length, 2);
  assert.notEqual(duplicates[0].id, duplicates[1].id);
  const graph = buildGraph(snapshot, []);
  assert.notEqual(graph.notes.find(note => note.id === duplicates[0].id).path, graph.notes.find(note => note.id === duplicates[1].id).path);
});

test('all project documents and exported memory are analyzable sources', () => {
  const sources = listSources(fixture());
  assert.equal(sources.length, 5);
  assert.deepEqual(sources.filter(source => source.kind === 'project')[0].messages.map(message => message.role), ['project-description', 'project-instructions']);
  assert.equal(sources.find(source => source.kind === 'document').messages[0].text, 'SQLite is the local store.');
  assert.equal(sources.find(source => source.kind === 'memory').messages[0].text, 'Keep explanations concise.');
});

test('recurring SQLite becomes a shared lexical topic and generic phrases do not', () => {
  const snapshot = fixture();
  for (const conversation of snapshot.conversations) conversation.messages.push({ id: 'generic-' + conversation.id, role: 'assistant', text: 'Thank you, please ask another question.' });
  const graph = buildGraph(snapshot, []);
  const sqlite = graph.nodes.filter(node => node.kind === 'topic' && node.title.toLowerCase() === 'sqlite');
  assert.equal(sqlite.length, 1);
  assert.equal(sqlite[0].method, 'lexical');
  assert.ok(sqlite[0].sourceIds.length >= 2);
  assert.ok(!graph.nodes.some(node => node.kind === 'topic' && /^(please|thanks|thank|you|question|another)$/i.test(node.title)));
  assert.match(graph.notes.find(note => note.id === sqlite[0].id).content, /not a semantic synthesis/);
  assert.equal(graph.stats.analysedSources, 0);
  assert.equal(graph.stats.pendingSources, graph.stats.sourceCount);
  checkLinks(graph);
});

test('greetings and requests for generic help do not pretend to be knowledge', () => {
  const snapshot = { conversations: ['a', 'b'].map(id => ({ id, organizationId: 'org', title: 'Hello', messages: [{ id: 'm-' + id, role: 'human', text: 'Hello, please help me. Thank you! Can you help me?' }] })) };
  const graph = buildGraph(snapshot, []);
  assert.equal(graph.stats.lexicalTopicCount, 0);
  assert.ok(graph.notes.every(note => note.kind === 'conversation'));
});

test('an empty snapshot produces an empty graph without inflated nodes', () => {
  const graph = buildGraph(null, []);
  assert.deepEqual(listSources(null), []);
  assert.equal(graph.stats.sourceCount, 0);
  assert.equal(graph.stats.nodeCount, 0);
  assert.equal(graph.stats.edgeCount, 0);
});

test('source-backed project links are present without a universal hub', () => {
  const graph = buildGraph(fixture(), []);
  const source = listSources(fixture()).find(item => item.externalId === 'chat-1');
  assert.ok(graph.edges.some(edge => edge.from === source.id && edge.type === 'belongs_to'));
  assert.ok(!graph.notes.some(note => /(?:Home|Dashboard)\.md$/.test(note.path)));
  assert.ok(graph.notes.every(note => !note.content.includes('[[Amberkeep/Home')));
  checkLinks(graph);
});

test('missing project metadata gets an explicitly unavailable source reference', () => {
  const snapshot = fixture();
  snapshot.projects = [];
  const graph = buildGraph(snapshot, []);
  const project = graph.nodes.find(node => node.kind === 'project');
  assert.equal(project.unavailable, true);
  assert.match(graph.notes.find(note => note.id === project.id).content, /metadata was not available/);
  checkLinks(graph);
});

test('candidate decisions and questions retain exact message provenance', () => {
  const graph = buildGraph(fixture(), []);
  const decision = graph.notes.find(note => note.kind === 'decision');
  assert.ok(decision);
  assert.match(decision.content, /Candidate excerpt/);
  assert.match(decision.content, /We decided to use SQLite for local storage/);
  assert.match(decision.content, new RegExp('#\\^' + messageAnchor('message-2')));
  assert.ok(graph.notes.some(note => note.kind === 'question'));
  checkLinks(graph);
});

test('valid semantic extraction is normalized and only its source is marked analyzed', () => {
  const snapshot = fixture();
  const source = listSources(snapshot).find(item => item.externalId === 'chat-1');
  const payload = validateKnowledge(knowledge(source), source);
  const graph = buildGraph(snapshot, [payload]);
  assert.equal(graph.stats.analysedSources, 1);
  assert.equal(graph.stats.pendingSources, 4);
  assert.equal(graph.stats.knowledgeNodeCount, 1);
  const note = graph.notes.find(item => item.kind === 'tool');
  assert.match(note.content, /AI-enriched knowledge/);
  assert.match(note.content, /not independently verified facts/);
  assert.match(note.content, /SQLite/);
  checkLinks(graph);
});

test('same canonical concept merges across sources while keeping claims separately attributed', () => {
  const snapshot = fixture();
  const sources = listSources(snapshot).filter(item => item.kind === 'conversation');
  const first = knowledge(sources[0]);
  const second = knowledge(sources[1]);
  second.concepts[0].title = ' sqlite ';
  second.concepts[0].summary = 'A different source discusses lookup performance.';
  const graph = buildGraph(snapshot, [first, second]);
  const tools = graph.notes.filter(note => note.kind === 'tool');
  assert.equal(tools.length, 1);
  assert.match(tools[0].content, /local storage/);
  assert.match(tools[0].content, /lookup performance/);
  assert.equal(graph.nodes.find(node => node.id === tools[0].id).sourceIds.length, 2);
  assert.equal(graph.nodes.filter(node => node.title.trim().toLowerCase() === 'sqlite').length, 1);
  assert.match(tools[0].content, /Additional recurring-term mentions/);
  assert.match(tools[0].content, /not additional AI-interpreted claims/);
  assert.equal(graph.stats.analysedSources, 2);
  checkLinks(graph);
});

test('stale hash, fabricated quotes, and unrelated message references are rejected', () => {
  const source = listSources(fixture()).find(item => item.externalId === 'chat-1');
  const stale = knowledge(source, { sourceHash: 'old' });
  assert.throws(() => validateKnowledge(stale, source), /stale/);
  const fabricated = knowledge(source);
  fabricated.concepts[0].evidence[0].quote = 'This quote was invented.';
  assert.throws(() => validateKnowledge(fabricated, source), /not verbatim/);
  const unrelated = knowledge(source);
  unrelated.concepts[0].evidence[0].messageId = 'message-4';
  assert.throws(() => validateKnowledge(unrelated, source), /unknown source message/);
  const graph = buildGraph(fixture(), [stale, fabricated, unrelated]);
  assert.equal(graph.stats.analysedSources, 0);
  assert.equal(graph.stats.rejectedEnrichments, 3);
});

test('relations reference concepts in the same extraction and do not accept arbitrary paths', () => {
  const source = listSources(fixture()).find(item => item.externalId === 'chat-1');
  const payload = knowledge(source);
  payload.concepts.push({ title: 'Local storage', kind: 'concept', summary: 'The source discusses local storage.', evidence: [{ messageId: 'message-2', quote: 'local storage' }] });
  payload.relations.push({ from: 'SQLite', to: 'Local storage', type: 'uses' });
  const graph = buildGraph(fixture(), [validateKnowledge(payload, source)]);
  assert.ok(graph.edges.some(edge => edge.type === 'uses' && edge.method === 'model'));
  checkLinks(graph);
  payload.relations[0].to = '../../private';
  assert.throws(() => validateKnowledge(payload, source), /concept titles/);
  const extra = knowledge(source);
  extra.path = '../unsafe.md';
  assert.throws(() => validateKnowledge(extra, source), /unsupported field/);
});

test('semantic size limits and evidence requirements are enforced', () => {
  const source = listSources(fixture()).find(item => item.externalId === 'chat-1');
  const empty = knowledge(source);
  empty.concepts[0].evidence = [];
  assert.throws(() => validateKnowledge(empty, source), /requires 1 to 12/);
  const excessive = knowledge(source);
  excessive.concepts = Array.from({ length: 31 }, (_, i) => ({ ...excessive.concepts[0], title: 'Item ' + i }));
  assert.throws(() => validateKnowledge(excessive, source), /at most 30/);
  const tooManyRelations = knowledge(source, { relations: Array.from({ length: 61 }, () => ({})) });
  assert.throws(() => validateKnowledge(tooManyRelations, source), /at most 60/);
  const noConcepts = knowledge(source, { concepts: [], relations: [] });
  assert.deepEqual(validateKnowledge(noConcepts, source).concepts, []);
});

test('source HTML, embeds, links and marker-like strings remain literal text', () => {
  const snapshot = fixture();
  const sourceText = '<script>fetch("https://example.invalid")</script> ![remote](https://example.invalid/img.png) ![[Hidden]] [[Injected]] <!-- amberkeep:end -->';
  snapshot.conversations[0].messages[0].text = sourceText;
  const graph = buildGraph(snapshot, []);
  const source = listSources(snapshot).find(item => item.externalId === 'chat-1');
  const content = graph.notes.find(note => note.id === source.id).content;
  assert.ok(!content.includes('<script>'));
  assert.ok(!content.includes('!['));
  assert.ok(!content.includes('[[Injected]]'));
  assert.ok(!content.includes('<!-- amberkeep:end -->'));
  assert.match(content, /&lt;script&gt;/);
  checkLinks(graph);
});

test('root path handling rejects configuration and traversal destinations', () => {
  for (const root of ['../outside', '.obsidian', '/absolute', 'A/../B', 'A\\B', 'A/[B]', 'A/CON']) {
    assert.throws(() => buildGraph(fixture(), [], { root }), /root|unsafe|relative/);
  }
  const graph = buildGraph(fixture(), [], { root: 'Knowledge/Amberkeep' });
  assert.ok(graph.notes.every(note => note.path.startsWith('Knowledge/Amberkeep/')));
  checkLinks(graph);
});
