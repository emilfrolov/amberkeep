'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBridge, connectionPath, readConnection } = require('../src/bridge');
const { callTool, createToolHandler, tools } = require('../src/tools');

const hash = 'a'.repeat(64);

test('default connection location is per-user and independent of app temporary directories', async (t) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'amberkeep-location-vault-'));
  t.after(() => fs.rm(vault, { recursive: true, force: true }));
  const canonical = await fs.realpath(vault);
  const expected = path.join(await fs.realpath(os.homedir()), '.amberkeep', 'connections', `${crypto.createHash('sha256').update(canonical).digest('hex')}.json`);
  t.mock.method(os, 'tmpdir', () => '/a-different-app-temporary-directory');
  assert.equal(await connectionPath(vault), expected);
});

async function fixture(t, responder, options = {}) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'amberkeep-mcp-vault-'));
  const connectionDirectory = path.join(vault, '.test-connections');
  await fs.mkdir(connectionDirectory, { mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.headers.origin, undefined);
    responder(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const filename = await connectionPath(vault, connectionDirectory);
  await fs.writeFile(filename, JSON.stringify({ port: server.address().port, token }), { mode: 0o600 });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(filename, { force: true });
    await fs.rm(vault, { recursive: true, force: true });
  });
  return { vault, filename, token, server, connectionDirectory, bridge: createBridge({ vaultPath: vault, connectionDirectory, ...options }) };
}

test('reads a newly rotated loopback connection for each request', async (t) => {
  const local = await fixture(t, (_request, response) => response.end(JSON.stringify({ connected: true })));
  assert.deepEqual(await local.bridge.request('GET', '/status'), { connected: true });
  const connection = await readConnection(local.vault, local.connectionDirectory);
  assert.equal(connection.token, local.token);
  await fs.writeFile(local.filename, JSON.stringify({ port: local.server.address().port, token: 'b'.repeat(64), host: 'evil.example' }), { mode: 0o600 });
  await assert.rejects(local.bridge.request('GET', '/status'), /127\.0\.0\.1/);
});

test('rejects unavailable, relative, insecure, and symlinked connection files', async (t) => {
  await assert.rejects(readConnection('relative/vault'), /absolute/);
  const local = await fixture(t, (_request, response) => response.end('{}'));
  await fs.chmod(local.filename, 0o644);
  if (process.platform !== 'win32') await assert.rejects(readConnection(local.vault, local.connectionDirectory), /unsafe permissions/);
  await fs.rm(local.filename);
  const other = path.join(local.vault, 'connection.json');
  await fs.writeFile(other, JSON.stringify({ port: local.server.address().port, token: local.token }), { mode: 0o600 });
  await fs.symlink(other, local.filename);
  await assert.rejects(readConnection(local.vault, local.connectionDirectory), /Open the selected vault/);
});

test('never accepts an arbitrary URL or follows a bridge redirect', async (t) => {
  const local = await fixture(t, (_request, response) => {
    response.writeHead(302, { Location: 'https://example.invalid/private' });
    response.end('{}');
  });
  await assert.rejects(local.bridge.request('GET', 'https://example.invalid/private'), /Unsupported/);
  await assert.rejects(local.bridge.request('GET', '/status'), /does not follow/);
});

test('limits response bytes and rejects an expired token without exposing it', async (t) => {
  let expired = false;
  const local = await fixture(t, (_request, response) => {
    if (expired) {
      response.writeHead(401);
      response.end(JSON.stringify({ error: local.token }));
    } else response.end(JSON.stringify({ tooLong: 'x'.repeat(1024) }));
  }, { maxResponseBytes: 100 });
  await assert.rejects(local.bridge.request('GET', '/status'), /too large|interrupted/);
  expired = true;
  const ordinary = createBridge({ vaultPath: local.vault, connectionDirectory: local.connectionDirectory });
  await assert.rejects(ordinary.request('GET', '/status'), (error) => error.status === 401 && !error.message.includes(local.token));
});

test('timeouts and cancellation stop a pending request', async (t) => {
  const local = await fixture(t, () => {}, { timeoutMs: 30 });
  await assert.rejects(local.bridge.request('GET', '/status'), /respond in time/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(local.bridge.request('GET', '/status', undefined, abort.signal), /cancelled/);
});

test('tool arguments are bounded and source IDs cannot choose an HTTP route', async () => {
  const calls = [];
  const bridge = { request: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } };
  await callTool(bridge, 'amberkeep_read_source', { sourceId: 'org:conversation/../../status?token=secret', offset: 4, limit: 1000 });
  assert.equal(calls[0][1], '/sources/org%3Aconversation%2F..%2F..%2Fstatus%3Ftoken%3Dsecret?offset=4&limit=1000');
  await assert.rejects(callTool(bridge, 'amberkeep_list_pending', { limit: 100 }), /Invalid tool input/);
  await assert.rejects(callTool(bridge, 'amberkeep_status', { filename: '/private' }), /Invalid tool input/);
  await assert.rejects(callTool(bridge, 'unknown', {}), /Unknown/);
  assert.equal(tools.length, 6);
  assert.equal(tools.find((tool) => tool.name === 'amberkeep_save_knowledge').annotations.destructiveHint, false);
});

test('knowledge saving requires all source pages, with no gaps and a matching hash', async () => {
  const calls = [];
  const bridge = {
    async request(method, route) {
      calls.push([method, route]);
      if (route.startsWith('/sources/')) {
        const offset = Number(new URL(`http://localhost${route}`).searchParams.get('offset'));
        return { sourceId: 'org:conv', sourceHash: hash, messages: [{ id: 'm1', role: 'human', text: 'abc' }], offset, nextOffset: offset < 6 ? offset + 3 : null, done: offset >= 6 };
      }
      return { saved: true };
    },
  };
  const handle = createToolHandler(bridge);
  const payload = { sourceId: 'org:conv', sourceHash: hash, concepts: [], relations: [] };
  await assert.rejects(handle('amberkeep_save_knowledge', payload), /Read every/);
  await handle('amberkeep_read_source', { sourceId: 'org:conv', offset: 0, limit: 1000 });
  await handle('amberkeep_read_source', { sourceId: 'org:conv', offset: 6, limit: 1000 });
  await assert.rejects(handle('amberkeep_save_knowledge', payload), /Read every/);
  await handle('amberkeep_read_source', { sourceId: 'org:conv', offset: 3, limit: 1000 });
  assert.deepEqual(await handle('amberkeep_save_knowledge', payload), { saved: true });
  await assert.rejects(handle('amberkeep_save_knowledge', { ...payload, sourceHash: 'b'.repeat(64) }), /Read every/);
  assert.equal(calls.filter(([method, route]) => method === 'POST' && route === '/knowledge').length, 1);
});

test('zero-text sources still require a completed read before empty analysis', async () => {
  const bridge = { async request(_method, route) {
    if (route.startsWith('/sources/')) return { sourceId: 'org:empty', sourceHash: hash, offset: 0, nextOffset: null, done: true, messages: [] };
    return { saved: true };
  } };
  const handle = createToolHandler(bridge);
  await handle('amberkeep_read_source', { sourceId: 'org:empty' });
  assert.deepEqual(await handle('amberkeep_save_knowledge', { sourceId: 'org:empty', sourceHash: hash, concepts: [], relations: [] }), { saved: true });
});
