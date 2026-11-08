'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ClaudeClient, normalizeConversation } = require('../src/claude-client');

const NOW = '2026-11-08T12:00:00.000Z';
const OLD_TIME = '2026-01-01T00:00:00Z';
const NEW_TIME = '2026-02-01T00:00:00Z';

function httpError(status, message = `HTTP ${status}`, retryAfter) {
  const error = new Error(message);
  error.status = status;
  if (retryAfter !== undefined) error.retryAfter = retryAfter;
  return error;
}

function summary(id, updatedAt = NEW_TIME) {
  return { uuid: id, name: `Invented ${id}`, created_at: OLD_TIME, updated_at: updatedAt };
}

function conversation(id, text = 'Invented conversation', updatedAt = NEW_TIME) {
  return {
    ...summary(id, updatedAt),
    chat_messages: [{ uuid: `message-${id}`, sender: 'human', text, created_at: OLD_TIME }],
  };
}

function snapshot(conversations = []) {
  return {
    version: 1,
    fetchedAt: OLD_TIME,
    complete: true,
    warnings: [],
    organizations: [{ id: 'org-a', name: 'Invented organization' }],
    conversations,
    projects: [],
    memories: [],
  };
}

function mockFetch(overrides) {
  const calls = [];
  const fetchJson = async (path, options = {}) => {
    const url = new URL(path, 'https://claude.ai');
    assert.equal(url.origin, 'https://claude.ai');
    calls.push({ path, url, options });
    const overridden = overrides ? await overrides(url, calls.length, options) : undefined;
    if (overridden !== undefined) return overridden;
    if (url.pathname === '/api/organizations') return [{ uuid: 'org-a', name: 'Invented organization' }];
    if (/\/chat_conversations(?:_v2)?$/.test(url.pathname)) return { data: [], has_more: false };
    if (/\/projects$/.test(url.pathname)) return [];
    if (/\/projects\/[^/]+\/docs$/.test(url.pathname)) return [];
    if (/\/memory$/.test(url.pathname)) return { memory: 'Invented memory', updated_at: OLD_TIME };
    if (url.pathname === '/api/account_profile') return { conversation_preferences: 'Invented preference' };
    throw new Error(`Unexpected test request: ${path}`);
  };
  return { fetchJson, calls };
}

function client(fetchJson, options = {}) {
  return new ClaudeClient(fetchJson, {
    requestIntervalMs: 0,
    sleep: async () => {},
    now: () => new Date(NOW),
    ...options,
  });
}

function detailCalls(calls) {
  return calls.filter(({ url }) => /\/chat_conversations\/[^/]+$/.test(url.pathname));
}

test('sync follows pagination, retains every conversation, and requests full message trees', async () => {
  const progress = [];
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      return Number(url.searchParams.get('offset')) === 0
        ? { data: [summary('conversation-a'), summary('conversation-b')], has_more: true }
        : { data: [summary('conversation-c')], has_more: false };
    }
    const match = url.pathname.match(/\/chat_conversations\/([^/]+)$/);
    if (match) return conversation(match[1]);
  });
  const result = await client(fetchJson, { pageSize: 2 }).sync(null, { onProgress: (event) => progress.push(event) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.conversations.map((item) => item.id).sort(), ['conversation-a', 'conversation-b', 'conversation-c']);
  const pages = calls.filter(({ url }) => url.pathname.endsWith('/chat_conversations_v2'));
  assert.deepEqual(pages.map(({ url }) => url.searchParams.get('offset')), ['0', '2']);
  for (const { url } of detailCalls(calls)) {
    assert.equal(url.searchParams.get('tree').toLowerCase(), 'true');
    assert.equal(url.searchParams.get('rendering_mode'), 'messages');
    assert.equal(url.searchParams.get('render_all_tools'), 'true');
  }
  assert.ok(progress.length > 0);
  assert.ok(progress.every((item) => typeof item.phase === 'string'));
});

test('an unchanged source fingerprint skips its detail request', async () => {
  const cached = normalizeConversation(conversation('conversation-a', 'Cached text'), 'org-a');
  const previous = snapshot([cached]);
  const before = JSON.stringify(previous);
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) return { data: [summary('conversation-a')], has_more: false };
  });
  const result = await client(fetchJson).sync(previous);
  assert.equal(result.complete, true);
  assert.equal(detailCalls(calls).length, 0);
  assert.equal(result.conversations[0].messages[0].text, 'Cached text');
  assert.equal(JSON.stringify(previous), before, 'the input snapshot must not be mutated');
});

test('missing update timestamps always fetch detail instead of assuming unchanged data', async () => {
  const cached = normalizeConversation(conversation('conversation-a', 'Old text'), 'org-a');
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      const row = summary('conversation-a');
      delete row.updated_at;
      return { data: [row], has_more: false };
    }
    if (url.pathname.endsWith('/chat_conversations/conversation-a')) return conversation('conversation-a', 'New text');
  });
  const result = await client(fetchJson).sync(snapshot([cached]));
  assert.equal(detailCalls(calls).length, 1);
  assert.equal(result.conversations[0].messages[0].text, 'New text');
});

test('cache identity includes the organization when two organizations return the same source ID', async () => {
  const cached = normalizeConversation(conversation('conversation-shared', 'Cached in organization A'), 'org-a');
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname === '/api/organizations') return [{ uuid: 'org-a' }, { uuid: 'org-b' }];
    if (url.pathname.endsWith('/chat_conversations_v2')) return { data: [summary('conversation-shared')], has_more: false };
    if (url.pathname === '/api/organizations/org-b/chat_conversations/conversation-shared') return conversation('conversation-shared', 'Fetched in organization B');
  });
  const result = await client(fetchJson).sync(snapshot([cached]));
  assert.equal(result.complete, true);
  assert.equal(result.conversations.length, 2);
  assert.equal(detailCalls(calls).length, 1);
  assert.ok(result.conversations.some((item) => item.organizationId === 'org-a' && item.messages[0].text === 'Cached in organization A'));
  assert.ok(result.conversations.some((item) => item.organizationId === 'org-b' && item.messages[0].text === 'Fetched in organization B'));
});

test('a source missing from a later list is retained rather than deleted from the cache', async () => {
  const cached = normalizeConversation(conversation('conversation-retained', 'Keep this cached source'), 'org-a');
  const { fetchJson } = mockFetch();
  const result = await client(fetchJson).sync(snapshot([cached]));
  assert.equal(result.complete, true);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].id, 'conversation-retained');
});

test('an inaccessible organization is reported without discarding cached records or another organization', async () => {
  const cached = normalizeConversation(conversation('conversation-old', 'Retained text'), 'org-a');
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname === '/api/organizations') return { data: [{ uuid: 'org-a', name: 'Unavailable' }, { uuid: 'org-b', name: 'Available' }] };
    if (url.pathname === '/api/organizations/org-a/chat_conversations_v2') throw httpError(403);
    if (url.pathname === '/api/organizations/org-b/chat_conversations_v2') return { data: [summary('conversation-b')], has_more: false };
    if (url.pathname.endsWith('/chat_conversations/conversation-b')) return conversation('conversation-b', 'Available text');
  });
  const result = await client(fetchJson).sync(snapshot([cached]));
  assert.equal(result.complete, false);
  assert.equal(result.conversations.length, 2);
  assert.ok(result.conversations.some((item) => item.organizationId === 'org-a' && item.messages[0].text === 'Retained text'));
  assert.ok(result.conversations.some((item) => item.organizationId === 'org-b'));
  assert.ok(result.warnings.some((warning) => /403|forbidden|access/i.test(String(warning))));
});

test('detail failures keep the previous version and make the run partial', async () => {
  const cached = normalizeConversation(conversation('conversation-a', 'Retained old version', OLD_TIME), 'org-a');
  const previous = snapshot([cached]);
  const before = JSON.stringify(previous);
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) return { data: [summary('conversation-a')], has_more: false };
    if (url.pathname.endsWith('/chat_conversations/conversation-a')) throw httpError(503, 'Synthetic unavailable response');
  });
  const result = await client(fetchJson).sync(previous);
  assert.equal(result.complete, false);
  assert.equal(result.conversations[0].messages[0].text, 'Retained old version');
  assert.ok(result.warnings.length > 0);
  assert.equal(JSON.stringify(previous), before);
});

test('a later pagination failure still imports discovered sources and retains earlier cache records', async () => {
  const cached = normalizeConversation(conversation('conversation-old', 'Retained cache'), 'org-a');
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      if (Number(url.searchParams.get('offset')) === 0) {
        return { data: [summary('conversation-a'), summary('conversation-b')], has_more: true };
      }
      throw httpError(503, 'Synthetic second page failure');
    }
    const match = url.pathname.match(/\/chat_conversations\/([^/]+)$/);
    if (match) return conversation(match[1], `Discovered ${match[1]}`);
  });
  const result = await client(fetchJson, { pageSize: 2 }).sync(snapshot([cached]));
  assert.equal(result.complete, false);
  assert.deepEqual(result.conversations.map((item) => item.id).sort(), ['conversation-a', 'conversation-b', 'conversation-old']);
  assert.ok(result.warnings.length > 0);
});

test('HTTP 401 stops collection and is exposed as login-required failure', async () => {
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname === '/api/organizations') throw httpError(401);
  });
  await assert.rejects(client(fetchJson).sync(null), (error) => error.status === 401);
  assert.equal(calls.length, 1);
});

test('HTTP 401 during a detail fetch also stops instead of becoming a partial success', async () => {
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) return { data: [summary('conversation-a')], has_more: false };
    if (url.pathname.endsWith('/chat_conversations/conversation-a')) throw httpError(401);
  });
  await assert.rejects(client(fetchJson).sync(null), (error) => error.status === 401);
});

test('HTTP 429 with Retry-After has a bounded retry and can recover', async () => {
  let attempts = 0;
  const waits = [];
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      attempts += 1;
      if (attempts === 1) throw httpError(429, 'Synthetic rate limit', 1);
      return { data: [], has_more: false };
    }
  });
  const result = await client(fetchJson, { sleep: async (milliseconds) => waits.push(milliseconds) }).sync(null);
  assert.equal(result.complete, true);
  assert.equal(attempts, 2);
  assert.ok(waits.some((milliseconds) => milliseconds >= 1000));
});

test('rate limits without Retry-After are not hammered with automatic retries', async () => {
  let attempts = 0;
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      attempts += 1;
      throw httpError(429);
    }
  });
  const result = await client(fetchJson).sync(null);
  assert.equal(result.complete, false);
  assert.equal(attempts, 1);
  assert.ok(result.warnings.length > 0);
});

test('rate-limit retries stop after the configured bound', async () => {
  let attempts = 0;
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      attempts += 1;
      throw httpError(429, 'Synthetic persistent rate limit', 1);
    }
  });
  const result = await client(fetchJson, { maxRetries: 2 }).sync(null);
  assert.equal(result.complete, false);
  assert.equal(attempts, 3);
});

test('a Retry-After beyond the allowed wait is reported rather than retried prematurely', async () => {
  let attempts = 0;
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) {
      attempts += 1;
      throw httpError(429, 'Synthetic long rate limit', 120);
    }
  });
  const result = await client(fetchJson, { maxRetryDelayMs: 30000 }).sync(null);
  assert.equal(result.complete, false);
  assert.equal(attempts, 1);
});

test('a repeated full page is a protocol error rather than an infinite or apparently complete scan', async () => {
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) return { data: [summary('conversation-a'), summary('conversation-b')], has_more: true };
    const match = url.pathname.match(/\/chat_conversations\/([^/]+)$/);
    if (match) return conversation(match[1]);
  });
  const result = await client(fetchJson, { pageSize: 2, maxPages: 3 }).sync(null);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.some((warning) => /repeat|pagination|protocol|page/i.test(String(warning))));
  assert.ok(calls.filter(({ url }) => url.pathname.endsWith('/chat_conversations_v2')).length <= 3);
});

test('empty pages that claim more results and unknown page shapes cannot report success', async (t) => {
  for (const [name, body] of [['empty with more', { data: [], has_more: true }], ['unknown wrapper', { unexpected: [] }]]) {
    await t.test(name, async () => {
      const { fetchJson } = mockFetch((url) => url.pathname.endsWith('/chat_conversations_v2') ? body : undefined);
      const result = await client(fetchJson).sync(null);
      assert.equal(result.complete, false);
      assert.ok(result.warnings.length > 0);
    });
  }
});

test('v2 falls back to the legacy list only for an unsupported endpoint', async () => {
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname.endsWith('/chat_conversations_v2')) throw httpError(404);
    if (url.pathname.endsWith('/chat_conversations')) return [summary('conversation-a')];
    if (url.pathname.endsWith('/chat_conversations/conversation-a')) return conversation('conversation-a');
  });
  const result = await client(fetchJson).sync(null);
  assert.equal(result.complete, true);
  assert.equal(result.conversations.length, 1);
  assert.ok(calls.some(({ url }) => url.pathname.endsWith('/chat_conversations')));
});

test('project documents, instructions, and global and project memory are collected', async () => {
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/projects')) return { data: [{ uuid: 'project-a', name: 'Invented project' }], has_more: false };
    if (url.pathname.endsWith('/projects/project-a')) return { uuid: 'project-a', name: 'Invented project', description: 'Invented description', prompt_template: 'Invented instructions', updated_at: NEW_TIME };
    if (url.pathname.endsWith('/projects/project-a/docs')) return [{ uuid: 'document-a', file_name: 'Invented document.txt' }];
    if (url.pathname.endsWith('/projects/project-a/docs/document-a')) return { uuid: 'document-a', content: 'Invented document body' };
    if (url.pathname.endsWith('/memory')) return url.searchParams.get('project_uuid')
      ? { memory: 'Invented project memory', updated_at: NEW_TIME }
      : { memory: 'Invented global memory', updated_at: NEW_TIME };
  });
  const result = await client(fetchJson).sync(null);
  assert.equal(result.complete, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].instructions, 'Invented instructions');
  assert.equal(result.projects[0].documents.length, 1);
  assert.equal(result.projects[0].documents[0].text, 'Invented document body');
  assert.ok(result.memories.some((item) => item.text === 'Invented global memory'));
  assert.ok(result.memories.some((item) => item.projectId === 'project-a' && item.text === 'Invented project memory'));
});

test('partial document pagination imports discovered documents without dropping cached documents', async () => {
  const previous = snapshot();
  previous.projects = [{
    id: 'project-a', organizationId: 'org-a', title: 'Cached project', description: '', instructions: '', updatedAt: OLD_TIME,
    documents: [{ id: 'document-old', title: 'Cached document', text: 'Keep cached document', raw: {} }], raw: {},
  }];
  const { fetchJson } = mockFetch((url) => {
    if (url.pathname.endsWith('/projects')) return { data: [{ uuid: 'project-a', name: 'Invented project' }], has_more: false };
    if (url.pathname.endsWith('/projects/project-a')) return { uuid: 'project-a', name: 'Invented project', updated_at: NEW_TIME };
    if (url.pathname.endsWith('/projects/project-a/docs')) {
      if (Number(url.searchParams.get('offset')) === 0) {
        return { data: [{ uuid: 'document-a' }, { uuid: 'document-b' }], has_more: true };
      }
      throw httpError(503, 'Synthetic second document page failure');
    }
    const match = url.pathname.match(/\/docs\/([^/]+)$/);
    if (match) return { uuid: match[1], content: `Invented ${match[1]}` };
  });
  const result = await client(fetchJson, { projectPageSize: 2 }).sync(previous);
  assert.equal(result.complete, false);
  assert.deepEqual(result.projects[0].documents.map((item) => item.id).sort(), ['document-a', 'document-b', 'document-old']);
});

test('explicit organization IDs cannot be path segments or blank identifiers', async () => {
  for (const id of ['.', '..', '   ', ' org-a', 'org-a ']) {
    const { fetchJson, calls } = mockFetch();
    await assert.rejects(client(fetchJson).sync(null, { organizationIds: [id] }), TypeError);
    assert.equal(calls.length, 0);
  }
});

test('a malformed server organization ID cannot produce a path-normalizing API request', async () => {
  const { fetchJson, calls } = mockFetch((url) => url.pathname === '/api/organizations' ? [{ uuid: '..' }] : undefined);
  const result = await client(fetchJson).sync(null);
  assert.equal(result.complete, false);
  assert.ok(result.warnings.length > 0);
  assert.ok(calls.every(({ path }) => !/(?:^|\/)\.\.(?:\/|$)/.test(path)));
});

test('aborting during collection stops future requests', async () => {
  const controller = new AbortController();
  const { fetchJson, calls } = mockFetch((url) => {
    if (url.pathname === '/api/organizations') {
      controller.abort();
      return [{ uuid: 'org-a', name: 'Invented organization' }];
    }
  });
  await assert.rejects(client(fetchJson).sync(null, { signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(calls.length, 1);
});

test('normalization preserves all message branches, non-text blocks, and divergent supplied text', () => {
  const raw = {
    uuid: 'conversation-tree', name: 'Invented tree', current_leaf_message_uuid: 'branch-b',
    chat_messages: [
      { uuid: 'root', sender: 'human', text: 'Root question' },
      { uuid: 'branch-a', parent_message_uuid: 'root', sender: 'assistant', text: 'Direct text variant', content: [{ type: 'text', text: 'Content text variant' }, { type: 'tool_use', name: 'invented_tool', input: { value: 'Preserve this data' } }] },
      { uuid: 'branch-b', parent_message_uuid: 'root', sender: 'assistant', text: 'Alternate branch' },
    ],
  };
  const normalized = normalizeConversation(raw, 'org-a');
  assert.equal(normalized.messages.length, 3);
  assert.equal(normalized.messages[1].parentId, 'root');
  assert.equal(normalized.messages[2].parentId, 'root');
  assert.match(normalized.messages[1].text, /Direct text variant/);
  assert.match(normalized.messages[1].text, /Content text variant/);
  assert.deepEqual(normalized.raw, raw);
  assert.deepEqual(normalized.messages[1].raw, raw.chat_messages[1]);
});

test('tool results, supplied reasoning, artifacts, and extracted attachments remain readable data without execution', () => {
  const sourceCode = "globalThis.__amberkeep_untrusted_test = 'executed';";
  const raw = {
    uuid: 'conversation-material',
    name: 'Invented material',
    chat_messages: [{
      uuid: 'message-material', sender: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Supplied invented reasoning text.' },
        { type: 'tool_use', name: 'artifacts', input: { title: 'Example artifact', content: sourceCode, code: 'const inventedAnswer = 42;' } },
        { type: 'tool_result', content: [{ type: 'text', text: 'Supplied invented tool result.' }] },
        { type: 'artifact', content: 'Supplied invented artifact body.' },
      ],
      attachments: [{ file_name: 'invented.txt', extracted_content: 'Supplied invented attachment text.' }],
    }],
  };
  delete globalThis.__amberkeep_untrusted_test;
  const normalized = normalizeConversation(raw, 'org-a');
  const rendered = normalized.messages[0].text;
  for (const value of [
    'Supplied invented reasoning text.', sourceCode, 'const inventedAnswer = 42;',
    'Supplied invented tool result.', 'Supplied invented artifact body.', 'Supplied invented attachment text.',
  ]) assert.ok(rendered.includes(value), `Missing supplied material: ${value}`);
  assert.deepEqual(normalized.messages[0].raw, raw.chat_messages[0]);
  assert.equal(globalThis.__amberkeep_untrusted_test, undefined, 'source code is never executed');
});

test('fallback message identifiers are derived from content rather than their list position', () => {
  const target = { sender: 'human', text: 'Stable invented message', created_at: OLD_TIME };
  const first = normalizeConversation({ uuid: 'conversation-a', chat_messages: [target] }, 'org-a');
  const second = normalizeConversation({ uuid: 'conversation-a', chat_messages: [{ sender: 'human', text: 'Inserted before' }, target] }, 'org-a');
  assert.equal(first.messages[0].id, second.messages[1].id);
});
