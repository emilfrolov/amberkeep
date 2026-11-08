#!/usr/bin/env node
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { createBridge } = require('./bridge');
const { tools, instructions, createToolHandler } = require('./tools');

function createServer(bridge = createBridge({ vaultPath: process.env.AMBERKEEP_VAULT })) {
  const callTool = createToolHandler(bridge);
  const server = new Server({ name: 'amberkeep-desktop', version: '0.2.0' }, {
    capabilities: { tools: {} }, instructions,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
    try {
      const result = await callTool(request.params.name, request.params.arguments || {}, context.signal);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result && typeof result === 'object' && !Array.isArray(result) ? result : { result },
      };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message || 'Amberkeep could not complete this operation.' }] };
    }
  });
  return server;
}

async function main() {
  await createServer().connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch(() => {
    // Never log request payloads, vault paths, tokens, or protocol data.
    process.stderr.write('Amberkeep MCP server could not start. Check the extension settings.\n');
    process.exitCode = 1;
  });
}

module.exports = { createServer, main };
