'use strict';

const { createHash } = require('node:crypto');

const CONCEPT_KINDS = new Set(['concept', 'decision', 'question', 'person', 'tool']);
const RELATION_TYPES = new Set(['related_to', 'uses', 'depends_on', 'answers', 'supersedes']);
const STOP_WORDS = new Set((
  'a an and are as at be been being but by can could did do does doing done for from had has have having how i if in into is it its just let like may me more most my need no not of on one or our out please should so some than that the their them then there these they this those through to too two up us use used using very want was we were what when where which who why will with would you your yes thanks thank also about all any another answer ask based better chat conversation example help here make many new now only other question really see say something such sure think understand way well work write hello hey great okay ok good decided chose decision ' +
  'а без был была были было быть в вам вас весь во вот все всего всех вы где да даже для до его ее её если есть еще ещё же за зачем здесь и из или им их к как какая какие какой когда кто ли либо мне мной мною может можно мы на надо нам нас не него нее неё нет ни но ну о об один она они оно от очень по под пожалуйста пока после потому при про просто пусть раз с сам со спасибо так также такой там тебя тебе тем то того тоже только том ты у уже чем через что чтобы эта эти это этот я ваш ваша ваши наш наша наши нужно надо будет будут использовать используется давай давайте вопрос ответ пример привет хорошо отлично помоги помощь подскажи решили решено выбрали будем'
).split(/\s+/));

function digest(value, length = 20) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, length);
}

function text(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

function canonicalTitle(value) {
  return text(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

function displayTitle(value, fallback = 'Untitled') {
  return text(value).normalize('NFKC').replace(/\s+/gu, ' ').trim() || fallback;
}

function escaped(value) {
  return text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#!|~])/g, '\\$1');
}

function quoted(value) {
  return escaped(value).split(/\r?\n/).map(line => '> ' + line).join('\n') || '> (empty)';
}

function normalizedRoot(root) {
  if (typeof root !== 'string' || !root || root.length > 180 || root.startsWith('/') || root.includes('\\')) {
    throw new Error('Knowledge root must be a relative vault folder.');
  }
  const pieces = root.split('/');
  if (pieces.some(piece => !piece || piece.startsWith('.') || Buffer.byteLength(piece, 'utf8') > 180 || /[<>:"|?*#^\[\]\x00-\x1f]/u.test(piece) || /[ .]$/.test(piece) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(piece))) {
    throw new Error('Knowledge root contains an unsafe folder name.');
  }
  return pieces.join('/');
}

function scopedId(kind, organizationId, id) {
  return `${kind}:${encodeURIComponent(organizationId || 'unknown')}:${encodeURIComponent(id)}`;
}

function messageAnchor(messageId) {
  return 'm-' + digest(String(messageId), 16);
}

function sourceHash(source) {
  return digest({
    id: source.id, kind: source.kind, title: source.title,
    projectId: source.projectId || '',
    messages: source.messages.map(message => ({ id: message.id, role: message.role, text: message.text, parentId: message.parentId || '' })),
  }, 64);
}

function normalizeMessages(messages) {
  const seen = new Map();
  return (Array.isArray(messages) ? messages : []).map(message => {
    const item = message && typeof message === 'object' ? message : { text: message };
    const normalized = {
      id: text(item.id || item.uuid) || 'anonymous-' + digest({ role: item.role, text: item.text, parentId: item.parentId, createdAt: item.createdAt }),
      role: text(item.role || item.sender || 'unknown'),
      text: text(item.text),
      createdAt: text(item.createdAt || item.created_at),
      parentId: text(item.parentId || item.parent_message_uuid),
    };
    const identity = normalized.id;
    const count = seen.get(identity) || 0;
    seen.set(identity, count + 1);
    if (count) normalized.id += '-duplicate-' + digest({ text: normalized.text, role: normalized.role }, 12) + '-' + count;
    return normalized;
  });
}

function listSources(snapshot = {}) {
  snapshot = snapshot || {};
  const sources = new Map();
  function add(kind, record, messages, additional = {}) {
    const organizationId = text(record.organizationId) || 'unknown';
    const externalId = text(record.id) || 'anonymous-' + digest({ title: record.title, messages });
    const source = {
      id: scopedId(kind, organizationId, externalId), externalId, organizationId, kind,
      title: displayTitle(record.title, kind[0].toUpperCase() + kind.slice(1)),
      createdAt: text(record.createdAt), updatedAt: text(record.updatedAt),
      projectId: text(record.projectId), messages: normalizeMessages(messages), ...additional,
    };
    source.hash = sourceHash(source);
    const prior = sources.get(source.id);
    if (!prior || source.updatedAt > prior.updatedAt || (source.updatedAt === prior.updatedAt && source.hash > prior.hash)) sources.set(source.id, source);
    return source;
  }
  for (const conversation of snapshot.conversations || []) {
    add('conversation', conversation, conversation.messages);
  }
  for (const project of snapshot.projects || []) {
    const messages = [];
    if (project.description) messages.push({ id: 'description', role: 'project-description', text: text(project.description) });
    if (project.instructions) messages.push({ id: 'instructions', role: 'project-instructions', text: text(project.instructions) });
    add('project', project, messages);
    for (const document of project.documents || []) {
      const documentId = text(document.id) || 'anonymous-' + digest({ title: document.title, text: document.text });
      add('document', { ...document, id: text(project.id) + '/' + documentId, organizationId: project.organizationId, projectId: project.id }, [
        { id: documentId, role: 'project-document', text: text(document.text) },
      ]);
    }
  }
  for (const memory of snapshot.memories || []) {
    add('memory', memory, [{ id: text(memory.id) || 'memory', role: 'exported-memory', text: text(memory.text) }]);
  }
  return [...sources.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function object(value, label, allowedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowedKeys.includes(key))) throw new Error(`${label} contains an unsupported field.`);
}

function boundedString(value, label, maximum, nonempty = true) {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.trim())) throw new Error(`${label} must be ${nonempty ? 'nonempty ' : ''}text of at most ${maximum} characters.`);
  return value;
}

function validateKnowledge(payload, source) {
  if (!source || typeof source.id !== 'string' || typeof source.hash !== 'string') throw new Error('A current source is required.');
  object(payload, 'Knowledge payload', ['sourceId', 'sourceHash', 'concepts', 'relations']);
  if (payload.sourceId !== source.id) throw new Error('Knowledge sourceId does not match the current source.');
  if (payload.sourceHash !== source.hash) throw new Error('Knowledge sourceHash is stale; read the current source again.');
  if (!Array.isArray(payload.concepts) || payload.concepts.length > 30) throw new Error('Knowledge must contain at most 30 concepts.');
  if (!Array.isArray(payload.relations) || payload.relations.length > 60) throw new Error('Knowledge must contain at most 60 relations.');
  const messages = new Map(source.messages.map(message => [message.id, message.text]));
  const titles = new Map();
  const concepts = payload.concepts.map(concept => {
    object(concept, 'Concept', ['title', 'kind', 'summary', 'evidence']);
    const title = displayTitle(boundedString(concept.title, 'Concept title', 180));
    const canonical = canonicalTitle(title);
    if (titles.has(canonical)) throw new Error('Concept titles must be unique within a source.');
    titles.set(canonical, title);
    if (!CONCEPT_KINDS.has(concept.kind)) throw new Error('Unsupported concept kind.');
    const summary = boundedString(concept.summary, 'Concept summary', 4000);
    if (!Array.isArray(concept.evidence) || concept.evidence.length < 1 || concept.evidence.length > 12) throw new Error('Each concept requires 1 to 12 evidence quotations.');
    const evidence = concept.evidence.map(item => {
      object(item, 'Evidence', ['messageId', 'quote']);
      const messageId = boundedString(item.messageId, 'Evidence messageId', 500);
      const quote = boundedString(item.quote, 'Evidence quote', 8000);
      if (!messages.has(messageId)) throw new Error('Evidence refers to an unknown source message.');
      if (!messages.get(messageId).includes(quote)) throw new Error('Evidence quote is not verbatim text from its source message.');
      return { messageId, quote };
    });
    return { title, kind: concept.kind, summary, evidence };
  });
  const relations = payload.relations.map(relation => {
    object(relation, 'Relation', ['from', 'to', 'type']);
    const from = titles.get(canonicalTitle(boundedString(relation.from, 'Relation from', 180)));
    const to = titles.get(canonicalTitle(boundedString(relation.to, 'Relation to', 180)));
    if (!from || !to) throw new Error('Relations must refer to concept titles in this payload.');
    if (from === to) throw new Error('A relation cannot point to the same concept.');
    if (!RELATION_TYPES.has(relation.type)) throw new Error('Unsupported relation type.');
    return { from, to, type: relation.type };
  });
  return { sourceId: source.id, sourceHash: source.hash, concepts, relations };
}

function wiki(path, label, anchor = '') {
  const target = path.replace(/\.md$/u, '') + (anchor ? '#^' + anchor : '');
  const alias = displayTitle(label).replace(/[\[\]|<>]/g, ' ').replace(/&/g, '&amp;');
  return `[[${target}|${alias}]]`;
}

function filenameTitle(value) {
  let name = displayTitle(value).normalize('NFC')
    .replace(/[<>:"/\\|?*#^\[\]%\x00-\x1f\x7f]/gu, ' ')
    .replace(/\s+/gu, ' ').replace(/^[. ]+|[. ]+$/gu, '');
  if (!name) name = 'Untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = 'Note ' + name;
  while (Buffer.byteLength(name, 'utf8') > 160) name = [...name].slice(0, -1).join('');
  return name.replace(/[. ]+$/gu, '') || 'Untitled';
}

function validStoredPath(path, root) {
  if (typeof path !== 'string' || !path.startsWith(root + '/') || !path.endsWith('.md') || path.includes('\\') || path.length > 1000) return false;
  const segments = path.split('/');
  return segments.every(segment => segment && !segment.startsWith('.')
    && Buffer.byteLength(segment, 'utf8') <= 255
    && !/[<>:"|?*#^\[\]\x00-\x1f\x7f]/u.test(segment)
    && !/[ .]$/u.test(segment)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment));
}

function pathRegistry(root, pathMap, warnings) {
  const entries = pathMap instanceof Map ? [...pathMap.entries()] : (pathMap && typeof pathMap === 'object' && !Array.isArray(pathMap) ? Object.entries(pathMap) : []);
  const stored = new Map();
  const reserved = new Map();
  let ignored = 0;
  const keyFor = path => path.normalize('NFC').toLocaleLowerCase('en-US');
  for (const [id, path] of entries.sort(([a], [b]) => String(a).localeCompare(String(b)))) {
    if (typeof id !== 'string' || !id || !validStoredPath(path, root)) { ignored += 1; continue; }
    const key = keyFor(path);
    if (reserved.has(key) && reserved.get(key) !== id) { ignored += 1; continue; }
    stored.set(id, path);
    reserved.set(key, id);
  }
  if (ignored) warnings.push(`${ignored} unsafe, out-of-root, or conflicting stored note path(s) were ignored.`);
  return (id, folder, title) => {
    if (stored.has(id)) return stored.get(id);
    const readable = filenameTitle(title);
    for (const length of [12, 20, 64]) {
      const path = `${root}/${folder}/${readable}--${digest(id, length)}.md`;
      const key = keyFor(path);
      if (!reserved.has(key) || reserved.get(key) === id) {
        stored.set(id, path);
        reserved.set(key, id);
        return path;
      }
    }
    throw new Error('Could not allocate a unique knowledge note path.');
  };
}

function sourcePath(source, pathFor) {
  const folders = { conversation: 'Conversations', project: 'Projects', document: 'Documents', memory: 'Memory' };
  return pathFor(source.id, folders[source.kind], source.title);
}

function lexicalTerms(source) {
  const candidates = new Map();
  function add(value, weight, message, exactQuote) {
    const title = displayTitle(value);
    const canonical = canonicalTitle(title);
    const words = canonical.split(/\s+/u);
    if (title.length < 3 || title.length > 70 || words.length > 5 || words.every(word => STOP_WORDS.has(word)) || /^\d[\d._-]*$/u.test(canonical)) return;
    if (words.length === 1 && (STOP_WORDS.has(canonical) || canonical.length < 3)) return;
    let candidate = candidates.get(canonical);
    if (!candidate) {
      candidate = { title, canonical, weight: 0, evidence: [] };
      candidates.set(canonical, candidate);
    }
    candidate.weight += weight;
    if (message && candidate.evidence.length === 0) candidate.evidence.push({ messageId: message.id, quote: exactQuote || message.text.slice(0, 240) });
  }
  const tokenize = (value, weight, message) => {
    for (const match of value.matchAll(/[\p{L}][\p{L}\p{N}_.+#-]{1,47}/gu)) {
      const term = match[0].replace(/^[._-]+|[._-]+$/g, '');
      const contextStart = Math.max(0, match.index - 70);
      const quote = message ? value.slice(contextStart, Math.min(value.length, match.index + term.length + 100)) : '';
      add(term, weight * (/\p{Lu}.*\p{Lu}|[a-z][A-Z]|[+#]/u.test(term) ? 2 : 1), message, quote);
    }
  };
  tokenize(source.title, 4, null);
  for (const message of source.messages) {
    // A bounded lexical pass is a fallback index, not a claim of semantic analysis.
    const body = message.text.slice(0, 200000);
    tokenize(body, 1, message);
    for (const heading of body.matchAll(/^#{1,4}\s+([^\n]{3,100})/gm)) {
      add(heading[1], 4, message, heading[0]);
    }
    for (const inline of body.matchAll(/`([^`\n]{3,60})`/g)) add(inline[1], 3, message, inline[0]);
  }
  return [...candidates.values()].sort((a, b) => b.weight - a.weight || a.canonical.localeCompare(b.canonical)).slice(0, 160);
}

function candidateExcerpts(source) {
  const output = [];
  for (const message of source.messages) {
    for (const line of message.text.split(/\n|(?<=[.!?])\s+/u)) {
      const excerpt = line.trim();
      if (excerpt.length < 12 || excerpt.length > 500) continue;
      const decision = /(?:^|\s)(?:we decided|i decided|we chose|decision\s*:|we will use|решили|решено|выбрали|будем использовать)(?:\s|:|$)/iu.test(excerpt);
      const question = /\?$/.test(excerpt) && /^(human|user)$/i.test(message.role);
      const meaningfulTerms = [...excerpt.matchAll(/[\p{L}][\p{L}\p{N}_.+#-]{2,47}/gu)].filter(match => !STOP_WORDS.has(canonicalTitle(match[0])));
      if ((decision || question) && meaningfulTerms.length) output.push({ kind: decision ? 'decision' : 'question', title: excerpt.slice(0, 100), evidence: [{ messageId: message.id, quote: excerpt }] });
      if (output.length === 3) return output;
    }
  }
  return output;
}

function buildGraph(snapshot, enrichments = [], options = {}) {
  snapshot = snapshot || {};
  const root = normalizedRoot(options.root || 'Amberkeep');
  const sources = listSources(snapshot);
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const nodes = new Map();
  const edges = new Map();
  const warnings = [...(snapshot.warnings || []).map(text)];
  const pathFor = pathRegistry(root, options.pathMap || options.paths, warnings);
  const analyses = new Map();
  let rejectedEnrichments = 0;
  for (const payload of Array.isArray(enrichments) ? enrichments : []) {
    const source = sourceMap.get(payload && payload.sourceId);
    try {
      const valid = validateKnowledge(payload, source);
      analyses.set(source.id, valid);
    } catch (_) {
      rejectedEnrichments += 1;
    }
  }
  if (rejectedEnrichments) warnings.push(`${rejectedEnrichments} knowledge payload(s) were stale or invalid and were not used.`);

  function addNode(node) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
    return nodes.get(node.id);
  }
  function addEdge(from, to, type, method, sourceId) {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = `${from}\u0000${to}\u0000${type}`;
    if (!edges.has(key)) edges.set(key, { from, to, type, method, ...(sourceId ? { sourceId } : {}) });
  }
  for (const source of sources) addNode({
    id: source.id, title: source.title, kind: source.kind, method: 'source',
    path: sourcePath(source, pathFor), sourceIds: [source.id], source,
  });
  for (const source of sources) {
    if (!source.projectId || source.kind === 'project') continue;
    const projectId = scopedId('project', source.organizationId, source.projectId);
    if (!nodes.has(projectId)) addNode({
      id: projectId, title: `Project ${source.projectId}`, kind: 'project', method: 'source',
      path: pathFor(projectId, 'Projects', `Project ${source.projectId}`), sourceIds: [], unavailable: true,
    });
    addEdge(source.id, projectId, 'belongs_to', 'source');
  }

  const terms = new Map();
  for (const source of sources) {
    for (const candidate of lexicalTerms(source)) {
      const key = source.organizationId + '\u0000' + candidate.canonical;
      if (!terms.has(key)) terms.set(key, { ...candidate, organizationId: source.organizationId, sources: new Map(), weight: 0 });
      const term = terms.get(key);
      term.sources.set(source.id, candidate.evidence);
      term.weight += candidate.weight;
    }
  }
  const candidates = [...terms.values()].filter(term => term.sources.size >= 2)
    .sort((a, b) => (b.weight * b.sources.size) - (a.weight * a.sources.size) || a.canonical.localeCompare(b.canonical));
  const topicPerSource = new Map();
  for (const term of candidates) {
    const available = [...term.sources.keys()].filter(id => (topicPerSource.get(id) || 0) < 5);
    if (available.length < 2) continue;
    const id = scopedId('topic', term.organizationId, term.canonical);
    const node = addNode({ id, title: term.title, kind: 'topic', method: 'lexical', path: pathFor(id, 'Topics', term.title), sourceIds: available, citations: [] });
    for (const sourceId of available) {
      topicPerSource.set(sourceId, (topicPerSource.get(sourceId) || 0) + 1);
      node.citations.push({ sourceId, evidence: term.sources.get(sourceId) });
      addEdge(sourceId, id, 'mentions', 'lexical');
    }
  }

  for (const source of sources) {
    const analysis = analyses.get(source.id);
    if (analysis) {
      const conceptIds = new Map();
      for (const concept of analysis.concepts) {
        const id = scopedId('knowledge-' + concept.kind, source.organizationId, canonicalTitle(concept.title));
        conceptIds.set(canonicalTitle(concept.title), id);
        const node = addNode({
          id, title: concept.title, kind: concept.kind, method: 'model',
          path: pathFor(id, 'Knowledge', concept.title),
          sourceIds: [], claims: [],
        });
        node.sourceIds.push(source.id);
        node.claims.push({ sourceId: source.id, summary: concept.summary, evidence: concept.evidence });
        addEdge(source.id, id, 'supports', 'model', source.id);
      }
      for (const relation of analysis.relations) addEdge(conceptIds.get(canonicalTitle(relation.from)), conceptIds.get(canonicalTitle(relation.to)), relation.type, 'model', source.id);
    } else {
      for (const candidate of candidateExcerpts(source)) {
        const id = scopedId('candidate-' + candidate.kind, source.organizationId, source.id + ':' + digest(candidate.evidence));
        addNode({ id, title: candidate.title, kind: candidate.kind, method: 'lexical', path: pathFor(id, 'Candidates', candidate.title), sourceIds: [source.id], citations: [{ sourceId: source.id, evidence: candidate.evidence }] });
        addEdge(source.id, id, 'candidate_excerpt', 'lexical');
      }
    }
  }

  // A recurring term can point to an already extracted subject without
  // manufacturing a second, identically named node. Ambiguous semantic kinds
  // remain separate; lexical mentions are never promoted to model claims.
  for (const topic of [...nodes.values()].filter(node => node.kind === 'topic')) {
    const scope = topic.id.split(':')[1];
    const matches = [...nodes.values()].filter(node => node.method === 'model'
      && ['concept', 'tool', 'person'].includes(node.kind)
      && node.id.split(':')[1] === scope
      && canonicalTitle(node.title) === canonicalTitle(topic.title));
    if (matches.length !== 1) continue;
    const subject = matches[0];
    const claimSources = new Set(subject.claims.map(claim => claim.sourceId));
    subject.lexicalCitations = topic.citations.filter(item => !claimSources.has(item.sourceId));
    subject.lexicalSourceIds = subject.lexicalCitations.map(item => item.sourceId);
    for (const [key, edge] of [...edges.entries()]) {
      if (edge.to !== topic.id) continue;
      edges.delete(key);
      if (!claimSources.has(edge.from)) addEdge(edge.from, subject.id, 'mentions', 'lexical');
    }
    nodes.delete(topic.id);
  }

  function citation(sourceId, evidence) {
    const node = nodes.get(sourceId);
    if (!node) return '';
    if (!evidence || !evidence.length) return '- ' + wiki(node.path, node.title) + ' — title or project metadata.';
    return evidence.map(item => `- ${wiki(node.path, node.title, messageAnchor(item.messageId))}\n\n${quoted(item.quote)}`).join('\n\n');
  }
  function related(node) {
    const relatedEdges = [...edges.values()].filter(edge => edge.from === node.id && edge.type !== 'supports');
    if (!relatedEdges.length) return '';
    return '\n\n## Links\n\n' + relatedEdges.map(edge => '- ' + wiki(nodes.get(edge.to).path, nodes.get(edge.to).title) + ' — ' + escaped(edge.type.replace(/_/g, ' ')) + (edge.method === 'model' ? ' (AI-suggested)' : '')).join('\n');
  }
  function sourceBody(node) {
    const source = node.source;
    if (!source) return `# ${escaped(node.title)}\n\nSource-backed project reference. Its metadata was not available in the synchronized snapshot.\n`;
    const body = [`# ${escaped(source.title)}`, '', '**Source-backed material.** Kept in the order returned by Claude; parent IDs do not prove a single linear conversation.', '', `Source ID: ${escaped(source.id)}`];
    if (source.updatedAt) body.push('', 'Source updated: ' + escaped(source.updatedAt));
    body.push(related(node));
    const knowledge = [...edges.values()].filter(edge => edge.from === node.id && edge.type === 'supports');
    if (knowledge.length) body.push('', '## Extracted knowledge', '', ...knowledge.map(edge => '- ' + wiki(nodes.get(edge.to).path, nodes.get(edge.to).title)));
    body.push('', '## Source text', '');
    if (!source.messages.length) body.push('No message or document text was available in this source.');
    for (const message of source.messages) {
      body.push(`### ${escaped(message.role)}${message.createdAt ? ' — ' + escaped(message.createdAt) : ''}`, '', quoted(message.text), '', '^' + messageAnchor(message.id), '');
      if (message.parentId) body.push('Parent source message: ' + escaped(message.parentId), '');
    }
    return body.join('\n');
  }
  const notes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)).map(node => {
    let content;
    if (node.method === 'source') content = sourceBody(node);
    else if (node.method === 'model') {
      const parts = [`# ${escaped(node.title)}`, '', '**AI-enriched knowledge.** These source-specific summaries are model interpretations, not independently verified facts. Quotations below are checked against the source text.', ''];
      for (const claim of node.claims) parts.push('## From ' + escaped(sourceMap.get(claim.sourceId).title), '', escaped(claim.summary), '', citation(claim.sourceId, claim.evidence), '');
      if (node.lexicalCitations && node.lexicalCitations.length) parts.push('## Additional recurring-term mentions', '', 'These are lexical references, not additional AI-interpreted claims.', '', ...node.lexicalCitations.map(item => citation(item.sourceId, item.evidence)), '');
      content = parts.join('\n') + related(node);
    } else {
      content = `# ${escaped(node.title)}\n\n` + (node.kind === 'topic'
        ? '**Recurring term — lexical index.** Linked because this wording recurs across synchronized sources. This is not a semantic synthesis.\n\n'
        : '**Candidate excerpt — lexical suggestion.** This wording may indicate a decision or question. It has not been semantically analysed or adopted as a fact.\n\n') + node.citations.map(item => citation(item.sourceId, item.evidence)).join('\n\n') + related(node);
    }
    return { id: node.id, path: node.path, title: node.title, kind: node.kind, content: content.trim() + '\n' };
  });
  const edgeList = [...edges.values()].sort((a, b) => `${a.from}:${a.to}:${a.type}`.localeCompare(`${b.from}:${b.to}:${b.type}`));
  const uniquePairs = new Set(edgeList.map(edge => [edge.from, edge.to].sort().join('\u0000')));
  return {
    notes,
    nodes: [...nodes.values()].map(({ source, claims, citations, lexicalCitations, ...node }) => node),
    edges: edgeList,
    stats: {
      sourceCount: sources.length, analysedSources: analyses.size, pendingSources: sources.length - analyses.size,
      nodeCount: notes.length, edgeCount: uniquePairs.size, relationCount: edgeList.length,
      lexicalTopicCount: [...nodes.values()].filter(node => node.kind === 'topic').length,
      knowledgeNodeCount: [...nodes.values()].filter(node => node.method === 'model').length,
      rejectedEnrichments,
    },
    warnings,
  };
}

module.exports = { listSources, buildGraph, validateKnowledge, canonicalTitle, messageAnchor, sourceHash, scopedId };
