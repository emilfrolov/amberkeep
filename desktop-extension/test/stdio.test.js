'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { connectionPath } = require('../src/bridge');

test('real stdio SDK initialize, list, local tool call, and actionable disconnected errors', { timeout: 15000 }, async (t) => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'amberkeep-stdio-vault-'));
  const connectionDirectory = path.join(vault, '.test-connections');
  await fs.mkdir(connectionDirectory, { mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  let count = 0;
  const httpServer = http.createServer((request, response) => {
    count += 1;
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    assert.equal(request.url, '/status');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ connected: true, pendingSources: 2 }));
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const filename = await connectionPath(vault, connectionDirectory);
  await fs.writeFile(filename, JSON.stringify({ port: httpServer.address().port, token }), { mode: 0o600 });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, 'stdio-harness.js')],
    env: { ...process.env, AMBERKEEP_VAULT: vault, AMBERKEEP_TEST_CONNECTION_DIRECTORY: connectionDirectory },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'amberkeep-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await fs.rm(filename, { force: true });
    await fs.rm(vault, { recursive: true, force: true });
  });
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 6);
  const result = await client.callTool({ name: 'amberkeep_status', arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).pendingSources, 2);
  assert.equal(count, 1);
  await fs.rm(filename);
  const disconnected = await client.callTool({ name: 'amberkeep_status', arguments: {} });
  assert.equal(disconnected.isError, true);
  assert.match(disconnected.content[0].text, /Open the selected vault/);
  assert.equal(count, 1);
});
