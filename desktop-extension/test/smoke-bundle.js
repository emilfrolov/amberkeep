'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
  const client = new Client({ name: 'amberkeep-bundle-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.resolve(__dirname, '../dist/server.js')], stderr: 'pipe',
    env: { ...process.env, AMBERKEEP_VAULT: '' },
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.equal(result.tools.length, 6);
    const status = await client.callTool({ name: 'amberkeep_status', arguments: {} });
    assert.equal(status.isError, true);
    assert.match(status.content[0].text, /vault directory/);
    console.log('Standalone bundled MCP server: initialize, six tools, actionable configuration error passed');
  } finally {
    await client.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
