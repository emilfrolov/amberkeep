'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ClaudeSession } = require('../src/session');

// A deliberately small DOM fixture. It does not stand in for a live Electron
// or Claude login test; it verifies the generated guest configuration and code.
class Element extends EventTarget {
  constructor(tag) {
    super(); this.tagName = tag; this.attributes = new Map(); this.children = [];
    this.parent = null; this.className = ''; this.writes = [];
  }
  setAttribute(name, value) { this.attributes.set(name, value); this.writes.push(name); }
  getAttribute(name) { return this.attributes.get(name); }
  set src(value) { this._src = value; this.writes.push('src'); }
  get src() { return this._src; }
  get isConnected() { return this.tagName === 'body' || Boolean(this.parent?.isConnected); }
  appendChild(element) {
    element.remove(); this.children.push(element); element.parent = this; return element;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

function fixture(t, { origin = 'https://claude.ai', fetchImpl } = {}) {
  const original = global.document;
  const body = new Element('body');
  const calls = [];
  const scripts = [];
  global.document = {
    body,
    createElement(tag) {
      const element = new Element(tag);
      if (tag === 'webview') element.executeJavaScript = async script => {
        scripts.push(script);
        return vm.runInNewContext(script, {
          location: { origin },
          AbortController, setTimeout, clearTimeout, JSON,
          fetch: async (url, options) => {
            calls.push({ url, options });
            return fetchImpl ? fetchImpl(url, options) : response({ ok: true });
          },
        });
      };
      return element;
    },
  };
  t.after(() => { global.document = original; });
  return { body, calls, scripts };
}

function response(data, { status = 200, body, retryAfter = null } = {}) {
  return { status, ok: status >= 200 && status < 300, text: async () => body ?? JSON.stringify(data), headers: { get: key => key === 'retry-after' ? retryAfter : null } };
}

async function ready(session, t) {
  const guest = session.ensure();
  guest.dispatchEvent(new Event('dom-ready'));
  await session.ready;
  t.after(() => session.destroy());
  return guest;
}

test('the guest has a vault-specific persistent partition with remote Node access disabled', async t => {
  fixture(t);
  const session = new ClaudeSession('/synthetic/private-vault');
  const guest = await ready(session, t);
  assert.match(session.partition, /^persist:amberkeep-[a-f0-9]{24}$/);
  assert.equal(new ClaudeSession('/synthetic/private-vault').partition, session.partition);
  assert.notEqual(new ClaudeSession('/synthetic/other').partition, session.partition);
  assert.equal(guest.src, 'https://claude.ai/');
  const preferences = guest.getAttribute('webpreferences');
  for (const setting of ['contextIsolation=yes', 'nodeIntegration=no', 'nodeIntegrationInSubFrames=no', 'sandbox=yes', 'webSecurity=yes', 'allowRunningInsecureContent=no']) assert.ok(preferences.includes(setting), setting);
  for (const attribute of ['nodeintegration', 'preload', 'allowpopups', 'disablewebsecurity']) assert.equal(guest.getAttribute(attribute), undefined);
  assert.ok(guest.writes.indexOf('partition') < guest.writes.indexOf('src'));
  assert.ok(guest.writes.indexOf('webpreferences') < guest.writes.indexOf('src'));
});

test('mount uses a separate visible guest in the same partition without moving the request guest', async t => {
  const { body } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  const guest = await ready(session, t);
  const container = new Element('section'); body.appendChild(container);
  const visible = session.mount(container);
  assert.notEqual(visible, guest);
  assert.equal(visible.getAttribute('partition'), guest.getAttribute('partition'));
  assert.equal(session.loginHost.parent, container);
  assert.equal(session.host.parent, body);
  assert.equal(guest.isConnected, true);
  session.hide();
  assert.equal(visible.isConnected, false);
  assert.equal(session.loginHost, null);
  assert.equal(session.host.parent, body);
  assert.equal(session.ensure(), guest);
  session.destroy();
  assert.equal(guest.isConnected, false);
  assert.equal(session.guest, null);
});

test('GET transport uses same-origin browser credentials and only returns parsed data', async t => {
  const { calls } = fixture(t, { fetchImpl: async () => response({ conversations: [] }) });
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  const result = await session.getJSON('/api/organizations');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { conversations: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/organizations');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.headers.Accept, 'application/json');
});

test('request paths are JSON literals rather than executable source', async t => {
  const { calls, scripts } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  const path = '/api/example?name="});globalThis.attackExecuted=true;//';
  await session.getJSON(path);
  assert.equal(calls[0].url, path);
  assert.ok(scripts[0].includes(JSON.stringify(path)));
  assert.equal(global.attackExecuted, undefined);
});

test('unsupported hosts, fragments, and backslash paths are rejected before creating a guest', async t => {
  const { body, calls } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  for (const path of ['https://evil.invalid/api/x', '//evil.invalid/api/x', '/outside-api', '/api/x#fragment', '/api/\\evil']) {
    await assert.rejects(session.getJSON(path), /Only Claude API read paths/);
  }
  assert.equal(body.children.length, 0);
  assert.equal(calls.length, 0);
});

test('a guest navigated away from Claude cannot send an authenticated API request', async t => {
  const { calls } = fixture(t, { origin: 'https://example.invalid' });
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  await assert.rejects(session.getJSON('/api/organizations'), error => error.status === 401);
  assert.equal(calls.length, 0);
});

test('HTML login or challenge responses become an actionable authentication failure', async t => {
  fixture(t, { fetchImpl: async () => response(null, { body: '<html>Private session challenge</html>' }) });
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  await assert.rejects(session.getJSON('/api/organizations'), error => error.status === 401 && /challenge page/.test(error.message) && !error.message.includes('Private session'));
});

test('HTTP errors retain status and Retry-After without exposing response bodies', async t => {
  fixture(t, { fetchImpl: async () => response({ privateDetail: 'not returned in the error' }, { status: 429, retryAfter: '2' }) });
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  await assert.rejects(session.getJSON('/api/organizations'), error => error.status === 429 && error.retryAfter === '2' && !error.message.includes('privateDetail'));
});

test('pre-cancelled requests do not initialize or query the browser', async t => {
  const { body, calls } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  const control = new AbortController(); control.abort();
  await assert.rejects(session.getJSON('/api/organizations', { signal: control.signal }), { name: 'AbortError' });
  assert.equal(body.children.length, 0); assert.equal(calls.length, 0);
});

test('cancelling while the guest waits for dom-ready rejects without waiting for its timeout', async t => {
  const { calls } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  t.after(() => session.destroy());
  const control = new AbortController();
  const pending = session.getJSON('/api/organizations', { signal: control.signal });
  control.abort();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Abort did not settle promptly.')), 1000); });
  t.after(() => clearTimeout(timer));
  await assert.rejects(Promise.race([pending, deadline]), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('destroy clears the readiness timer and rejects pending initialization', async t => {
  const { body } = fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  session.ensure();
  const pending = session.ready;
  assert.notEqual(session.readinessTimer, null);
  session.destroy();
  await assert.rejects(pending, /session closed/);
  assert.equal(session.readinessTimer, null);
  assert.equal(session.ready, null);
  assert.equal(body.children.length, 0);
});

test('cancelling a pending guest request returns before the page-side fetch settles', async t => {
  fixture(t);
  const session = new ClaudeSession('/synthetic/vault');
  const guest = await ready(session, t);
  guest.executeJavaScript = async () => new Promise(() => {});
  const control = new AbortController();
  const pending = session.getJSON('/api/organizations', { signal: control.signal });
  await Promise.resolve();
  control.abort();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Abort did not settle promptly.')), 1000); });
  t.after(() => clearTimeout(timer));
  await assert.rejects(Promise.race([pending, deadline]), { name: 'AbortError' });
});

test('network failures are actionable without echoing request internals', async t => {
  fixture(t, { fetchImpl: async () => { throw new Error('sensitive upstream failure'); } });
  const session = new ClaudeSession('/synthetic/vault'); await ready(session, t);
  await assert.rejects(session.getJSON('/api/organizations'), error => error.status === 0 && /failed or timed out/.test(error.message) && !error.message.includes('sensitive'));
});
