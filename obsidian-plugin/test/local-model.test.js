'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {once} = require('node:events');
const {extractKnowledge, listModels, normalizeBaseUrl, requestJson, MAX_RESPONSE_BYTES, MAX_SOURCE_CHARS} = require('../src/local-model');

const source = {id: 'org:conversation:one', hash: 'current-source-hash', title: 'Invented project', kind: 'conversation',
  messages: [{id: 'm1', role: 'human', text: 'Use plain Markdown for the project.'}]};
const knowledge = {concepts: [{title: 'Plain Markdown', kind: 'decision', summary: 'The project uses Markdown.',
  evidence: [{messageId: 'm1', quote: 'Use plain Markdown'}]}], relations: []};

async function serverFor(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {server.closeAllConnections(); server.close();});
  return `http://127.0.0.1:${server.address().port}`;
}

test('local API receives complete data, JSON mode and no tools; result binds actual source', async t => {
  const baseUrl = await serverFor(t, (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/chat');
    assert.equal(req.headers.authorization, undefined);
    let body = '';
    req.on('data', chunk => {body += chunk;});
    req.on('end', () => {
      const value = JSON.parse(body);
      assert.equal(value.model, 'fixture:local');
      assert.equal(value.stream, false);
      assert.equal(value.format, 'json');
      assert.equal(value.tools, undefined);
      assert.match(value.messages[0].content, /untrusted source data/);
      assert.match(value.messages[1].content, /Use plain Markdown for the project/);
      res.end(JSON.stringify({done: true, message: {content: JSON.stringify(knowledge)}}));
    });
  });
  const result = await extractKnowledge(source, {model: 'fixture:local', baseUrl});
  assert.deepEqual(result, {sourceId: source.id, sourceHash: source.hash, ...knowledge});
});

test('only explicit loopback bases are accepted before injected transport runs', async () => {
  for (const baseUrl of ['https://example.com:11434', 'http://127.0.0.2:11434', 'http://localhost:11434/api',
    'http://localhost:11434?token=secret', 'http://user:pass@127.0.0.1:11434', 'ftp://localhost:11434', 'http://localhost']) {
    let called = false;
    await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl, requestJson: async () => {called = true;}}));
    assert.equal(called, false, baseUrl);
  }
  assert.equal(normalizeBaseUrl('http://[::1]:11434/'), 'http://[::1]:11434');
});

test('oversized source is rejected whole instead of truncating and marking it analysed', async () => {
  let called = false;
  const large = {...source, messages: [{id: 'm1', text: 'x'.repeat(MAX_SOURCE_CHARS)}]};
  await assert.rejects(extractKnowledge(large, {model: 'fixture', requestJson: async () => {called = true;}}), /120,000/);
  assert.equal(called, false);
});

test('optional JSON fences are accepted and model cannot substitute another source identity', async () => {
  const response = content => async () => ({message: {content}});
  assert.deepEqual(await extractKnowledge(source, {model: 'fixture', requestJson: response('```json\n' + JSON.stringify(knowledge) + '\n```')}),
    {sourceId: source.id, sourceHash: source.hash, ...knowledge});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', requestJson: response(JSON.stringify({...knowledge, sourceId: 'wrong'}))}), /different source identity/);
  await assert.rejects(extractKnowledge(source, {model: 'fixture', requestJson: response(JSON.stringify({...knowledge, sourceHash: 'stale'}))}), /different source identity/);
});

test('malformed, incomplete and wrongly shaped responses keep a source pending', async () => {
  for (const response of [{message: {content: 'not JSON'}}, {message: {content: '[]'}}, {message: {content: '{}'}},
    {message: {content: JSON.stringify(knowledge)}, done: false}, {message: {content: JSON.stringify(knowledge)}, done_reason: 'length'},
    {message: {content: JSON.stringify({...knowledge, concepts: Array(31).fill(knowledge.concepts[0])})}},
    {message: {content: JSON.stringify({...knowledge, relations: Array(61).fill({})})}}, {message: {}}, {error: 'model unavailable'}]) {
    await assert.rejects(extractKnowledge(source, {model: 'fixture', requestJson: async () => response}));
  }
});

test('model must be explicitly chosen; known cloud model names are refused', async () => {
  for (const model of ['', undefined, 'gpt-oss:120b-cloud', 'cloud/remote', ' gpt-oss:120b-cloud ']) {
    await assert.rejects(extractKnowledge(source, {model, requestJson: async () => {throw new Error('should not call');}}), /installed local/);
  }
});

test('model listing uses local tags API and excludes declared remote models', async t => {
  const baseUrl = await serverFor(t, (req, res) => {
    assert.equal(req.url, '/api/tags');
    res.end(JSON.stringify({models: [{name: 'fixture:local'}, {name: 'fixture:local'}, {name: 'large:cloud'},
      {name: 'remote-alias', remote_host: 'https://example.invalid'}, {name: 'other-alias', remote_model: 'upstream'}]}));
  });
  assert.deepEqual(await listModels({baseUrl}), ['fixture:local']);
});

test('HTTP model errors and invalid API JSON produce useful failures', async t => {
  const baseUrl = await serverFor(t, (_req, res) => {res.writeHead(404); res.end(JSON.stringify({error: 'model fixture not found'}));});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl}), /model fixture not found/);
  const malformed = await serverFor(t, (_req, res) => {res.end('invalid API JSON');});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl: malformed}), /invalid JSON/);
  await assert.rejects(listModels({requestJson: async () => ({models: null})}), /model list/);
});

test('sources without evidence text have an empty result without an inference request', async () => {
  const result = await extractKnowledge({...source, messages: []}, {model: 'fixture', requestJson: async () => {throw new Error('should not call');}});
  assert.deepEqual(result, {sourceId: source.id, sourceHash: source.hash, concepts: [], relations: []});
});

test('default transport rejects oversized responses and redirects', async t => {
  const oversized = await serverFor(t, (_req, res) => {res.end('x'.repeat(MAX_RESPONSE_BYTES + 1));});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl: oversized}), /2 MiB/);
  const redirect = await serverFor(t, (_req, res) => {res.writeHead(302, {Location: 'https://example.invalid'}); res.end('{}');});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl: redirect}), /redirects/);
});

test('aborted calls do not return knowledge, including in-flight requests', async t => {
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(extractKnowledge(source, {model: 'fixture', signal: cancelled.signal}), {name: 'AbortError'});
  const controller = new AbortController();
  const baseUrl = await serverFor(t, () => {controller.abort();});
  await assert.rejects(extractKnowledge(source, {model: 'fixture', baseUrl, signal: controller.signal}), {name: 'AbortError'});
});

test('transport has a bounded deadline and does not follow arbitrary endpoint paths', async t => {
  const baseUrl = await serverFor(t, () => {});
  await assert.rejects(requestJson(baseUrl + '/api/chat', {method: 'POST', body: {}, timeoutMs: 20}), /timed out/);
  await assert.rejects(requestJson(baseUrl + '/arbitrary'), /Unsupported local/);
});
