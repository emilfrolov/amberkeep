'use strict';

// Reads the selected user's existing claude.ai session through an injected,
// same-origin GET transport. These web endpoints are not a public API contract.
const { createHash } = require('node:crypto');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isObject(value)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function string(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function identity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !['.', '..'].includes(value) && !/[\\/\u0000-\u001f\u007f]/u.test(value) ? value : null;
}

function sourceId(record) {
  return isObject(record) ? identity(record.uuid) || identity(record.id) : null;
}

function abortError() {
  const error = new Error('Synchronization was cancelled.');
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal) {
  if (signal && signal.aborted) throw abortError();
}

function sleep(milliseconds, signal) {
  checkAbort(signal);
  if (!milliseconds) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (signal && signal.aborted) onAbort();
  });
}

function readableBlock(block) {
  if (typeof block === 'string') return block;
  if (!isObject(block)) return `[Supplied content]\n${JSON.stringify(block, null, 2)}`;
  if (block.type === 'text' && typeof block.text === 'string') return block.text;
  const label = string(block.type) || 'unknown';
  const parts = [`[Supplied ${label} block]`, JSON.stringify(block, null, 2)];
  // Preserve structured fields in JSON and expose long supplied strings verbatim
  // too: the semantic reader can cite real code/artifact/extracted-text excerpts
  // without interpreting a JSON escape sequence as source evidence.
  if (block.type === 'tool_use' && isObject(block.input)) {
    for (const key of ['content', 'code', 'file_text', 'text']) {
      if (typeof block.input[key] === 'string') parts.push(`[Tool input ${key}]\n${block.input[key]}`);
    }
  } else {
    for (const key of ['thinking', 'reasoning', 'text', 'content', 'code']) {
      if (typeof block[key] === 'string') parts.push(`[Block ${key}]\n${block[key]}`);
    }
    if (Array.isArray(block.content)) parts.push(contentText(block.content));
  }
  return parts.filter(Boolean).join('\n\n');
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(readableBlock).join('\n\n');
}

function normalizeMessage(raw) {
  const record = isObject(raw) ? raw : {};
  const direct = string(record.text);
  const structured = contentText(record.content);
  let text = direct && structured && direct !== structured
    ? `Text field:\n${direct}\n\nContent blocks:\n${structured}`
    : structured || direct || (typeof raw === 'string' ? raw : '');
  const attachmentText = [];
  for (const key of ['attachments', 'files', 'files_v2']) {
    if (!Array.isArray(record[key])) continue;
    for (const item of record[key]) {
      if (!isObject(item)) continue;
      const name = string(item.file_name) || string(item.filename) || sourceId(item) || 'unnamed';
      const extracted = string(item.extracted_content) || string(item.extracted_text) || string(item.text);
      // Do not put image/base64 binary payloads into semantic text. Those remain raw.
      const metadata = Object.fromEntries(Object.entries(item).filter(([field]) => !['embedded_image', 'data', 'base64', 'extracted_content', 'extracted_text', 'text'].includes(field)));
      attachmentText.push(`[Supplied ${key} metadata: ${name}]\n${JSON.stringify(metadata, null, 2)}`);
      if (extracted) attachmentText.push(`[Extracted attachment text: ${name}]\n${extracted}`);
    }
  }
  if (attachmentText.length) text = [text, ...attachmentText].filter(Boolean).join('\n\n');
  return {
    id: sourceId(record) || `message-${fingerprint(raw).slice(0, 24)}`,
    role: string(record.sender) || string(record.role) || 'unknown',
    text,
    createdAt: string(record.created_at) || string(record.timestamp),
    parentId: identity(record.parent_message_uuid) || identity(record.parent_id) || null,
    raw,
  };
}

function normalizeConversation(raw, organizationId, summary = {}) {
  if (!isObject(raw)) throw new Error('Conversation response is not an object.');
  const primary = Array.isArray(raw.chat_messages) ? raw.chat_messages : raw.messages;
  if (!Array.isArray(primary)) throw new Error('Conversation response has no message array.');
  const records = primary.slice();
  const other = primary === raw.chat_messages ? raw.messages : raw.chat_messages;
  // Keep distinct alternate records without doubling an identical legacy array.
  const known = new Set(records.map(fingerprint));
  if (Array.isArray(other)) {
    for (const message of other) {
      const hash = fingerprint(message);
      if (!known.has(hash)) {
        records.push(message);
        known.add(hash);
      }
    }
  }
  const occurrences = new Map();
  const messages = records.map(record => {
    const message = normalizeMessage(record);
    const count = (occurrences.get(message.id) || 0) + 1;
    occurrences.set(message.id, count);
    if (count > 1) message.id += `~${count}`;
    return message;
  });
  const id = sourceId(raw) || sourceId(summary) || `conversation-${fingerprint(raw).slice(0, 24)}`;
  return {
    id,
    organizationId,
    title: string(raw.name) || string(raw.title) || string(summary.name) || string(summary.title) || id,
    createdAt: string(raw.created_at) || string(summary.created_at),
    updatedAt: string(raw.updated_at) || string(summary.updated_at),
    projectId: identity(raw.project_uuid) || identity(raw.project_id) || identity(raw.project?.uuid) || identity(summary.project_uuid) || identity(summary.project_id) || identity(summary.project?.uuid) || null,
    messages,
    raw,
  };
}

function normalizeDocument(raw) {
  const record = isObject(raw) ? raw : {};
  const id = sourceId(record) || `document-${fingerprint(raw).slice(0, 24)}`;
  const text = typeof raw === 'string' ? raw : string(record.content) || string(record.text) || contentText(record.content) || (record.content !== undefined ? `[Supplied document data]\n${JSON.stringify(record.content, null, 2)}` : '');
  return { id, title: string(record.file_name) || string(record.filename) || string(record.title) || string(record.name) || id, text, raw };
}

function normalizeProject(raw, organizationId, documents) {
  if (!isObject(raw)) throw new Error('Project response is not an object.');
  const id = sourceId(raw) || `project-${fingerprint(raw).slice(0, 24)}`;
  const supplied = documents || (Array.isArray(raw.docs) ? raw.docs : Array.isArray(raw.documents) ? raw.documents : []);
  return {
    id,
    organizationId,
    title: string(raw.name) || string(raw.title) || id,
    description: string(raw.description),
    instructions: string(raw.prompt_template) || string(raw.instructions),
    updatedAt: string(raw.updated_at),
    documents: supplied.map(normalizeDocument),
    raw,
  };
}

function normalizeMemory(raw, organizationId, options = {}) {
  const record = isObject(raw) ? raw : {};
  let text = typeof raw === 'string' ? raw : string(record.memory) || string(record.conversations_memory) || string(record.conversation_memory) || string(record.content) || string(record.text);
  const supplied = record.memory ?? record.conversations_memory ?? record.conversation_memory ?? record.content ?? record.text;
  if (!text && supplied !== undefined && supplied !== null) text = `[Supplied memory data]\n${JSON.stringify(supplied, null, 2)}`;
  if (!text && raw !== null && !('memory' in record) && !('content' in record)) text = JSON.stringify(raw, null, 2);
  const projectId = identity(options.projectId) || identity(record.project_uuid) || null;
  return {
    id: identity(options.id) || (projectId ? `project:${projectId}` : 'global'),
    organizationId,
    title: options.title || (projectId ? `Project memory: ${projectId}` : 'Claude memory'),
    text,
    projectId,
    updatedAt: string(record.updated_at),
    raw,
  };
}

function rowsFrom(value, keys, description) {
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    for (const key of keys) if (Array.isArray(value[key])) return value[key];
  }
  throw new Error(`${description} response has no supported array; the web API may have changed.`);
}

function rowId(row, description) {
  const id = sourceId(row);
  if (!id) throw new Error(`${description} is missing a valid string UUID.`);
  return id;
}

function cacheKey(record) {
  return `${record.organizationId}\u0000${record.id}`;
}

function cacheMap(records) {
  return new Map((Array.isArray(records) ? records : []).filter(item => isObject(item) && identity(item.id) && identity(item.organizationId)).map(item => [cacheKey(item), item]));
}

function errorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : null;
}

class ClaudeClient {
  constructor(fetchJson, options = {}) {
    if (typeof fetchJson !== 'function') throw new TypeError('ClaudeClient needs a same-origin GET transport.');
    this.fetchJson = fetchJson;
    this.requestIntervalMs = options.requestIntervalMs ?? 200;
    this.pageSize = options.pageSize ?? 100;
    this.projectPageSize = options.projectPageSize ?? 200;
    this.maxPages = options.maxPages ?? 1000;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 30000;
    this.sleep = options.sleep || sleep;
    this.now = options.now || (() => new Date());
    for (const [key, value] of Object.entries({ requestIntervalMs: this.requestIntervalMs, maxRetries: this.maxRetries, maxRetryDelayMs: this.maxRetryDelayMs })) {
      if (!Number.isFinite(value) || value < 0) throw new TypeError(`Invalid ${key}.`);
    }
    for (const [key, value] of Object.entries({ pageSize: this.pageSize, projectPageSize: this.projectPageSize, maxPages: this.maxPages })) {
      if (!Number.isInteger(value) || value <= 0) throw new TypeError(`Invalid ${key}.`);
    }
    this.running = false;
    this.requestCount = 0;
  }

  async request(path, signal) {
    if (!path.startsWith('/api/') || path.startsWith('//') || /[\r\n]/u.test(path)) throw new Error('Only same-origin Claude API paths are allowed.');
    let retries = 0;
    for (;;) {
      checkAbort(signal);
      if (this.requestCount++) await this.sleep(this.requestIntervalMs, signal);
      checkAbort(signal);
      try {
        const value = await this.fetchJson(path, { signal });
        checkAbort(signal);
        return value;
      } catch (error) {
        checkAbort(signal);
        if (error?.name === 'AbortError') throw error;
        if (errorStatus(error) === 401) {
          const login = new Error('Claude login is required or the saved session expired. Open Connect Claude and sign in again.');
          login.status = 401;
          login.code = 'LOGIN_REQUIRED';
          throw login;
        }
        let retryMs = null;
        if (errorStatus(error) === 429 && error.retryAfter !== undefined && error.retryAfter !== null) {
          const seconds = Number(error.retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) retryMs = seconds * 1000;
          else {
            const deadline = Date.parse(String(error.retryAfter));
            if (Number.isFinite(deadline)) retryMs = Math.max(0, deadline - new Date(this.now()).getTime());
          }
        }
        if (retryMs === null || retries >= this.maxRetries || retryMs > this.maxRetryDelayMs) throw error;
        retries++;
        // Respect Retry-After. A longer server delay is not shortened into hammering.
        await this.sleep(Math.max(retryMs, this.requestIntervalMs), signal);
      }
    }
  }

  async paginated(base, keys, description, signal, pageSize) {
    const rows = [];
    const seenPages = new Set();
    let offset = 0;
    try {
    for (let page = 0; page < this.maxPages; page++) {
      const delimiter = base.includes('?') ? '&' : '?';
      const value = await this.request(`${base}${delimiter}limit=${pageSize}&offset=${offset}`, signal);
      const entries = rowsFrom(value, keys, description);
      const more = isObject(value) ? value.has_more ?? value.hasMore : undefined;
      if (more !== undefined && typeof more !== 'boolean') throw new Error(`${description} has a non-boolean has_more flag.`);
      if (entries.length === 0 && more === true) throw new Error(`${description} reported has_more with an empty page.`);
      const signature = fingerprint(entries);
      if (entries.length && seenPages.has(signature)) throw new Error(`${description} repeated a page instead of advancing pagination.`);
      seenPages.add(signature);
      for (const row of entries) rowId(row, description);
      rows.push(...entries);
      if (more === false || (more === undefined && entries.length < pageSize)) return rows;
      offset += entries.length;
    }
    throw new Error(`${description} exceeded the ${this.maxPages}-page safety limit; collection is incomplete.`);
    } catch (error) {
      if (error?.name !== 'AbortError' && errorStatus(error) !== 401) error.partialRows = rows;
      throw error;
    }
  }

  async sync(previousSnapshot, { signal, organizationIds, onProgress } = {}) {
    if (this.running) throw new Error('A Claude synchronization is already running.');
    if (organizationIds !== undefined && (!Array.isArray(organizationIds) || organizationIds.some(id => !identity(id)))) throw new TypeError('organizationIds must be an array of organization IDs.');
    checkAbort(signal);
    this.running = true;
    this.requestCount = 0;
    const previous = isObject(previousSnapshot) ? previousSnapshot : {};
    const conversations = cacheMap(previous.conversations);
    const projects = cacheMap(previous.projects);
    const memories = cacheMap(previous.memories);
    const organizations = new Map((Array.isArray(previous.organizations) ? previous.organizations : []).filter(org => identity(org?.id)).map(org => [org.id, org]));
    const snapshot = { version: 1, fetchedAt: new Date(this.now()).toISOString(), complete: true, warnings: [], organizations: [], conversations: [], projects: [], memories: [] };
    if (previous.accountProfile !== undefined) snapshot.accountProfile = previous.accountProfile;
    const progress = (phase, current, total, message) => {
      if (typeof onProgress === 'function') {
        try { onProgress({ phase, current, total, message }); } catch (_) { /* A UI callback must not discard collected data. */ }
      }
    };
    const fail = (context, error, optional = false) => {
      checkAbort(signal);
      if (error?.name === 'AbortError' || errorStatus(error) === 401) throw error;
      const status = errorStatus(error);
      if (!optional || ![403, 404].includes(status)) snapshot.complete = false;
      snapshot.warnings.push(`${context}: ${status ? `HTTP ${status}. ` : ''}${String(error?.message || 'Request failed.').slice(0, 240)}`);
    };
    try {
      progress('organizations', 0, 0, 'Finding accessible Claude organizations.');
      let selected = [];
      try {
        const found = rowsFrom(await this.request('/api/organizations', signal), ['data', 'organizations'], 'Organization list');
        for (const row of found) {
          const id = rowId(row, 'Organization');
          organizations.set(id, { id, name: string(row.name) || string(row.display_name) || id });
        }
        selected = organizationIds !== undefined ? [...new Set(organizationIds)] : [...new Set(found.map(row => rowId(row, 'Organization')))];
      } catch (error) {
        fail('Could not discover organizations; cached data was retained', error);
        // Explicitly selected organizations may still be readable when account-wide discovery is disabled.
        if (organizationIds !== undefined) selected = [...new Set(organizationIds)];
      }
      for (const id of selected) if (!organizations.has(id)) organizations.set(id, { id, name: id });
      if (!selected.length && !snapshot.warnings.length) snapshot.warnings.push('No chat organizations were returned by Claude. No previous records were deleted.');
      for (let orgIndex = 0; orgIndex < selected.length; orgIndex++) {
        checkAbort(signal);
        const orgId = selected[orgIndex];
        const base = `/api/organizations/${encodeURIComponent(orgId)}`;
        progress('conversations', orgIndex, selected.length, `Reading organization ${orgIndex + 1} of ${selected.length}.`);
        let summaries;
        try {
          try {
            summaries = await this.paginated(`${base}/chat_conversations_v2?consistency=strong`, ['data', 'conversations', 'items'], 'Conversation list', signal, this.pageSize);
          } catch (error) {
            if (![404, 405].includes(errorStatus(error)) || error.partialRows?.length) throw error;
            summaries = await this.paginated(`${base}/chat_conversations?consistency=strong`, ['data', 'conversations', 'items'], 'Legacy conversation list', signal, this.pageSize);
          }
        } catch (error) {
          fail(`Conversation access for organization ${orgId} is unavailable; cached records were retained`, error);
          if (error.partialRows?.length) summaries = error.partialRows;
          else continue;
        }
        const unique = new Map(summaries.map(row => [rowId(row, 'Conversation'), row]));
        let current = 0;
        for (const [id, summary] of unique) {
          checkAbort(signal);
          current++;
          progress('conversations', current, unique.size, `Reading conversation ${current} of ${unique.size}.`);
          const key = `${orgId}\u0000${id}`;
          const cached = conversations.get(key);
          const updatedAt = string(summary.updated_at);
          if (cached && Array.isArray(cached.messages) && updatedAt && cached.updatedAt === updatedAt) continue;
          try {
            const detail = await this.request(`${base}/chat_conversations/${encodeURIComponent(id)}?tree=True&rendering_mode=messages&render_all_tools=true`, signal);
            if (sourceId(detail) && sourceId(detail) !== id) throw new Error('Conversation detail UUID differs from the requested conversation.');
            const normalized = normalizeConversation(detail, orgId, summary);
            normalized.id = id;
            normalized.raw = { summary, detail };
            conversations.set(key, normalized);
          } catch (error) {
            fail(`Conversation ${id} was not refreshed; its cached copy was retained when available`, error);
          }
        }
        progress('projects', orgIndex, selected.length, 'Reading projects and project documents.');
        let projectRows = [];
        try {
          projectRows = await this.paginated(`${base}/projects?include_harmony_projects=true`, ['data', 'projects', 'items'], 'Project list', signal, this.projectPageSize);
        } catch (error) {
          fail(`Project list for organization ${orgId} is unavailable`, error, true);
          if (error.partialRows?.length) projectRows = error.partialRows;
        }
        const uniqueProjects = new Map(projectRows.map(row => [rowId(row, 'Project'), row]));
        for (const [id, summary] of uniqueProjects) {
          checkAbort(signal);
          const key = `${orgId}\u0000${id}`;
          try {
            const detail = await this.request(`${base}/projects/${encodeURIComponent(id)}`, signal);
            if (!isObject(detail)) throw new Error('Project detail is not an object.');
            if (sourceId(detail) && sourceId(detail) !== id) throw new Error('Project detail UUID differs from the requested project.');
            let documents = projects.get(key)?.documents || [];
            let documentRows = [];
            const mergedDocs = new Map(documents.map(doc => [doc.id, doc]));
            try {
              documentRows = await this.paginated(`${base}/projects/${encodeURIComponent(id)}/docs`, ['data', 'docs', 'documents', 'items'], 'Project document list', signal, this.projectPageSize);
            } catch (error) {
              fail(`Documents for project ${id} are unavailable; cached content was retained`, error);
              if (error.partialRows?.length) documentRows = error.partialRows;
            }
            for (const doc of documentRows) {
              const docId = rowId(doc, 'Project document');
              try {
                const supplied = typeof doc.content === 'string' || typeof doc.text === 'string' ? doc : await this.request(`${base}/projects/${encodeURIComponent(id)}/docs/${encodeURIComponent(docId)}`, signal);
                const normalized = normalizeDocument(isObject(supplied) ? { ...doc, ...supplied, uuid: docId } : { ...doc, uuid: docId, content: supplied });
                normalized.raw = { summary: doc, detail: supplied };
                mergedDocs.set(docId, normalized);
              } catch (error) {
                fail(`Project document ${docId} was not refreshed; cached content was retained when available`, error);
              }
            }
            documents = [...mergedDocs.values()];
            const normalized = normalizeProject({ ...summary, ...detail, uuid: id }, orgId, []);
            normalized.documents = documents;
            normalized.raw = { summary, detail, documents: documentRows };
            projects.set(key, normalized);
          } catch (error) {
            fail(`Project ${id} was not refreshed; its cached copy was retained when available`, error);
          }
          try {
            const memory = normalizeMemory(await this.request(`${base}/memory?project_uuid=${encodeURIComponent(id)}`, signal), orgId, { projectId: id });
            memories.set(cacheKey(memory), memory);
          } catch (error) {
            fail(`Memory for project ${id} is unavailable; any cached memory was retained`, error, true);
          }
        }
        progress('memory', orgIndex + 1, selected.length, 'Reading exported memory available to this account.');
        try {
          const memory = normalizeMemory(await this.request(`${base}/memory`, signal), orgId);
          memories.set(cacheKey(memory), memory);
        } catch (error) {
          fail(`Conversation memory for organization ${orgId} is unavailable; any cached memory was retained`, error, true);
        }
      }
      try {
        snapshot.accountProfile = await this.request('/api/account_profile', signal);
      } catch (error) {
        fail('Optional account profile is unavailable; any cached profile was retained', error, true);
      }
      checkAbort(signal);
      snapshot.organizations = [...organizations.values()];
      snapshot.conversations = [...conversations.values()];
      snapshot.projects = [...projects.values()];
      snapshot.memories = [...memories.values()];
      progress('done', snapshot.conversations.length, snapshot.conversations.length, snapshot.complete ? 'Synchronization finished. Review any optional coverage warnings.' : 'Synchronization is partial. Cached records were retained.');
      return snapshot;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { ClaudeClient, normalizeConversation, normalizeMessage, normalizeProject, normalizeMemory, normalizeDocument };
