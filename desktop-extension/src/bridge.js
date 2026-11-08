'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const MAX_CONFIG_BYTES = 4096;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class BridgeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
  }
}

async function connectionPath(vaultPath, connectionDirectory) {
  if (typeof vaultPath !== 'string' || !path.isAbsolute(vaultPath)) {
    throw new BridgeError('Choose an absolute Obsidian vault directory in the Amberkeep extension settings.');
  }
  let canonical;
  try {
    canonical = await fs.realpath(vaultPath);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('Not a directory');
  } catch {
    throw new BridgeError('The selected Obsidian vault directory is unavailable. Check the extension settings.');
  }
  const digest = crypto.createHash('sha256').update(canonical).digest('hex');
  const directory = connectionDirectory || path.join(await fs.realpath(os.homedir()), '.amberkeep', 'connections');
  return path.join(directory, `${digest}.json`);
}

function validateConnection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/i.test(value.token)) {
    throw new BridgeError('The Amberkeep connection file is invalid. Reload the Obsidian plugin.');
  }
  // The connection file cannot redirect this process to an external server.
  if ((value.host !== undefined && value.host !== '127.0.0.1')
      || value.url !== undefined || value.hostname !== undefined) {
    throw new BridgeError('Amberkeep only accepts a local 127.0.0.1 bridge. Reload the Obsidian plugin.');
  }
  return { port: value.port, token: value.token };
}

async function readConnection(vaultPath, connectionDirectory) {
  const filename = await connectionPath(vaultPath, connectionDirectory);
  let handle;
  try {
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > MAX_CONFIG_BYTES
        || (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
        || (typeof process.getuid === 'function' && metadata.uid !== process.getuid())) {
      throw new BridgeError('The Amberkeep connection file has unsafe permissions. Reload the Obsidian plugin.');
    }
    const bytes = await handle.readFile();
    if (bytes.length > MAX_CONFIG_BYTES) throw new BridgeError('The Amberkeep connection file is invalid.');
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new BridgeError('The Amberkeep connection file is invalid.'); }
    return validateConnection(value);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('Open the selected vault in Obsidian and enable the Amberkeep plugin, then try again.');
  } finally {
    if (handle) await handle.close();
  }
}

function validateRoute(method, route) {
  const get = method === 'GET' && (
    route === '/status'
    || /^\/pending\?limit=\d+$/.test(route)
    || /^\/sources\/[^/?#]+\?offset=\d+&limit=\d+$/.test(route)
  );
  const post = method === 'POST' && ['/sync', '/knowledge', '/open-graph'].includes(route);
  if (!get && !post) throw new BridgeError('Unsupported Amberkeep bridge operation.');
}

function createBridge({ vaultPath, timeoutMs = 15000, maxResponseBytes = MAX_RESPONSE_BYTES, connectionDirectory } = {}) {
  return {
    async request(method, route, payload, signal) {
      validateRoute(method, route);
      if (signal?.aborted) throw new BridgeError('The Amberkeep request was cancelled.');
      const connection = await readConnection(vaultPath, connectionDirectory);
      const body = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
      if (body && body.length > MAX_REQUEST_BYTES) throw new BridgeError('The knowledge payload is too large. Save a smaller source analysis.');
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', cancel);
          error ? reject(error) : resolve(value);
        };
        const request = http.request({
          hostname: '127.0.0.1', port: connection.port, method, path: route,
          headers: {
            Authorization: `Bearer ${connection.token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {}),
          },
        });
        const cancel = () => request.destroy(new BridgeError('The Amberkeep request was cancelled.'));
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        request.setTimeout(timeoutMs, () => request.destroy(new BridgeError('Obsidian did not respond in time. Check that the selected vault is open.')));
        request.on('error', (error) => finish(error instanceof BridgeError ? error : new BridgeError('Cannot reach Amberkeep in Obsidian. Open the selected vault and enable the plugin.')));
        request.on('response', (response) => {
          const chunks = [];
          let size = 0;
          response.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxResponseBytes) {
              finish(new BridgeError('The source response is too large. Request a smaller page.'));
              response.destroy();
              request.destroy();
            } else chunks.push(chunk);
          });
          response.on('error', () => finish(new BridgeError('The Obsidian response was interrupted. Try again.')));
          response.on('end', () => {
            const status = response.statusCode || 0;
            if (status >= 300 && status < 400) return finish(new BridgeError('The local bridge returned a redirect, which Amberkeep does not follow.'));
            let result;
            try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(new BridgeError('Obsidian returned an invalid Amberkeep response. Reload the plugin.')); }
            if (status < 200 || status >= 300) {
              const message = status === 401
                ? 'The Amberkeep connection expired. Reload the Obsidian plugin and retry.'
                : status === 409
                  ? 'The source changed or its analysis is stale. Read its current pages and analyse it again.'
                  : typeof result?.error === 'string'
                    ? result.error.slice(0, 500)
                    : `The Obsidian bridge rejected this operation (HTTP ${status}).`;
              return finish(new BridgeError(message, status));
            }
            finish(null, result);
          });
        });
        if (body) request.write(body);
        request.end();
      });
    },
  };
}

module.exports = { BridgeError, connectionPath, readConnection, validateConnection, createBridge };
