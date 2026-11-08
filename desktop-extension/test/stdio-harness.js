'use strict';

// Test injection stays outside the production entry point and MCPB bundle.
const { createServer } = require('../src/server');
const { createBridge } = require('../src/bridge');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

createServer(createBridge({
  vaultPath: process.env.AMBERKEEP_VAULT,
  connectionDirectory: process.env.AMBERKEEP_TEST_CONNECTION_DIRECTORY,
})).connect(new StdioServerTransport()).catch(() => { process.exitCode = 1; });
