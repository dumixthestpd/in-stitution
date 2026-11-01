const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const packs = require('../extension/packs.js');
const archive = require('../extension/pack-archive.js');
const core = require('../extension/core.js');
const { create } = require('../extension/adapter-host.js');

function example() {
  const directory = path.join(__dirname, '../examples/custom-university');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  return { ...manifest, files: Object.fromEntries([...manifest.adapter.scripts, ...manifest.adapter.resources].map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')])) };
}
function harness() {
  const session = {};
  const scripts = new Map();
  const worlds = [];
  let enabled = true;
  const chrome = {
    storage: { session: { async get(key) { return { [key]: structuredClone(session[key]) }; }, async set(value) { Object.assign(session, structuredClone(value)); } } },
    permissions: { async contains() { return true; } },
    userScripts: {
      async getScripts(filter) { if (!enabled) throw new Error('Disabled'); return [...scripts.values()].filter(item => !filter || filter.ids.includes(item.id)); },
      async configureWorld(world) { worlds.push(world); },
      async register(items) { for (const item of items) scripts.set(item.id, item); },
      async update(items) { for (const item of items) scripts.set(item.id, item); },
      async unregister({ ids }) { ids.forEach(id => scripts.delete(id)); },
      async execute() { return []; }
    }
  };
  return { host: create({ chrome, core, packs }), session, scripts, worlds, disable() { enabled = false; } };
}

test('an executable pack carries arbitrary adapter JavaScript and resources independently of a bundled library', async () => {
  const raw = example();
  const pack = await packs.prepare(await archive.read(archive.write(raw)));
  assert.equal(pack.formatVersion, 2);
  assert.equal(pack.institution.library, 'executable-pack');
  assert.equal(core.libraries().some(item => item.id === pack.id), false);
  assert.match(pack.adapter.digest, /^[a-f0-9]{64}$/);
  assert.equal(pack.files['adapter.js'], raw.files['adapter.js']);
  assert.equal(pack.files['portal.json'], raw.files['portal.json']);
  assert.equal(core.isCredentialPage('https://login.example.edu/portal/start', pack.institution), false);
  const broker = await packs.prepare({ ...raw, institution: { ...raw.institution, identityOrigins: ['https://ds.carsi.edu.cn'] } });
  assert.deepEqual(core.optionalOrigins(broker.institution), ['https://ds.carsi.edu.cn/*', 'https://api.example.edu/*']);
});

test('changed adapter source invalidates fingerprints and authentication bindings', async () => {
  const original = await packs.prepare(example());
  const changed = { ...original, files: { ...original.files, 'adapter.js': original.files['adapter.js'] + '\n// Changed authentication flow' } };
  await assert.rejects(packs.prepare(changed), /fingerprint/);
  const updated = await packs.prepare({ ...changed, adapter: { ...changed.adapter, digest: undefined } });
  assert.notEqual(updated.adapter.digest, original.adapter.digest);
  assert.notEqual(core.credentialScope(updated.institution), core.credentialScope(original.institution));
  await assert.rejects(packs.prepare({ ...example(), files: { ...example().files, 'credentials.txt': 'fake-account-only' } }), /undeclared/);
});

test('ZIP paths, duplicate entries, corruption and oversized expansion are rejected', async () => {
  assert.throws(() => archive.write({ files: { '../adapter.js': 'code' } }), /Invalid/);
  assert.throws(() => archive.write({ files: { 'adapter.js': '', 'ADAPTER.js': '' } }), /Invalid/);
  const data = archive.write(example());
  const damaged = data.slice(); damaged[35] ^= 1;
  await assert.rejects(archive.read(damaged));
  const inflated = data.slice();
  const view = new DataView(inflated.buffer);
  const central = view.getUint32(inflated.length - 6, true);
  view.setUint32(central + 24, 0xffffffff, true);
  await assert.rejects(archive.read(inflated), /too large/);
  await assert.rejects(archive.read(new Uint8Array(2097153)), /smaller than/);
});

test('standard deflated ZIP content is supported with integrity checks', async () => {
  const stored = archive.write({ formatVersion: 2, files: {} });
  const view = new DataView(stored.buffer);
  const nameLength = view.getUint16(26, true);
  const bodyStart = 30 + nameLength;
  const bodyLength = view.getUint32(22, true);
  const compressed = deflateRawSync(stored.subarray(bodyStart, bodyStart + bodyLength));
  const header = stored.slice(0, bodyStart);
  new DataView(header.buffer).setUint16(8, 8, true);
  new DataView(header.buffer).setUint32(18, compressed.length, true);
  const centralOffset = view.getUint32(stored.length - 6, true);
  const central = stored.slice(centralOffset, stored.length - 22);
  new DataView(central.buffer).setUint16(10, 8, true);
  new DataView(central.buffer).setUint32(20, compressed.length, true);
  const end = stored.slice(-22);
  new DataView(end.buffer).setUint32(16, header.length + compressed.length, true);
  const result = await archive.read(Buffer.concat([header, compressed, central, end]));
  assert.equal(result.formatVersion, 2);
});

test('adapter registration uses separate worlds and host-limited networking without evaluating code in the host', async () => {
  const h = harness();
  const pack = await packs.prepare(example());
  pack.files['adapter.js'] += '\n';
  const prepared = await packs.prepare({ ...pack, adapter: { ...pack.adapter, digest: undefined } });
  assert.equal(await h.host.sync([prepared.institution], [prepared]), true);
  const script = [...h.scripts.values()][0];
  assert.equal(script.world, 'USER_SCRIPT');
  assert.deepEqual(script.matches, ['https://login.example.edu/*']);
  assert.deepEqual(script.excludeMatches, script.matches);
  assert.equal(script.allFrames, false);
  assert.ok(script.js.some(item => item.code === prepared.files['adapter.js']));
  assert.match(h.worlds[0].csp, /connect-src https:\/\/login.example.edu/);
  assert.equal(h.worlds[0].messaging, true);
});

test('capabilities bind imported messaging to its own active institution, approved origin and main document', async () => {
  const h = harness();
  const pack = await packs.prepare(example());
  await h.host.sync([pack.institution], [pack]);
  const capability = h.session.adapterCapabilities[0];
  const message = { packId: pack.id, token: capability.token };
  const sender = { url: 'https://login.example.edu/portal/start', frameId: 0, documentId: 'fixture-document', tab: { id: 1 } };
  const flow = core.createFlow('https://pubs.rsc.org/article/fixture', Date.now(), 'fixture', pack.institution);
  assert.equal((await h.host.authenticate(message, sender, [pack], flow)).id, pack.id);
  for (const changed of [{ token: 'forged' }, { packId: 'another-institution' }]) assert.equal(await h.host.authenticate({ ...message, ...changed }, sender, [pack], flow), null);
  for (const changed of [{ url: 'https://evil.example/' }, { frameId: 1 }, { documentId: undefined }]) assert.equal(await h.host.authenticate(message, { ...sender, ...changed }, [pack], flow), null);
  assert.equal(await h.host.authenticate(message, sender, [pack], { ...flow, active: false }), null);
  h.disable();
  assert.equal(await h.host.authenticate(message, sender, [pack], flow), null);
});

test('updates and removal revoke old adapter capabilities while preserving restart identity', async () => {
  const h = harness();
  const pack = await packs.prepare(example());
  await h.host.sync([pack.institution], [pack]);
  const token = h.session.adapterCapabilities[0].token;
  await h.host.sync([pack.institution], [pack]);
  assert.equal(h.session.adapterCapabilities[0].token, token);
  const next = await packs.prepare({ ...pack, adapter: { ...pack.adapter, digest: undefined }, files: { ...pack.files, 'adapter.js': pack.files['adapter.js'] + '\n// v2' } });
  await h.host.sync([next.institution], [next]);
  assert.notEqual(h.session.adapterCapabilities[0].token, token);
  await h.host.sync([], []);
  assert.equal(h.session.adapterCapabilities.length, 0);
  assert.equal(h.scripts.size, 0);
});

test('a document that ran one adapter cannot receive another adapter or version, including restored documents', async () => {
  const h = harness();
  const pack = await packs.prepare(example());
  await h.host.sync([pack.institution], [pack]);
  assert.equal(await h.host.wake(1, 'document-a', pack.institution, [pack]), true);
  const updated = await packs.prepare({ ...pack, adapter: { ...pack.adapter, digest: undefined }, files: { ...pack.files, 'adapter.js': pack.files['adapter.js'] + '\n// update' } });
  await h.host.sync([updated.institution], [updated]);
  assert.equal(await h.host.wake(1, 'document-a', updated.institution, [updated]), false);
  assert.equal(await h.host.wake(1, 'document-b', updated.institution, [updated]), true);
  assert.equal(await h.host.wake(1, 'document-a', updated.institution, [updated]), false);
});

test('setup code, frame scope and API grants are fingerprinted while API 1 stays compatible', async () => {
  const raw = example();
  const original = await packs.prepare(raw);
  for (const adapter of [
    { ...original.adapter, frames: 'all' },
    { ...original.adapter, returnOrigins: ['https://pubs.rsc.org'] },
    { ...original.adapter, networkOrigins: ['https://different.example.edu'] },
    { ...original.adapter, settings: { ...original.adapter.settings, styles: [] } }
  ]) await assert.rejects(packs.prepare({ ...original, adapter }), /fingerprint/);
  const changedUi = { ...original.files, 'settings.js': original.files['settings.js'] + '\n// Changed setup logic' };
  await assert.rejects(packs.prepare({ ...original, files: changedUi }), /fingerprint/);
  const legacy = await packs.prepare({ ...raw, adapter: { apiVersion: 1, scripts: raw.adapter.scripts, resources: raw.adapter.resources } });
  assert.equal(legacy.adapter.apiVersion, 1);
  assert.equal((await packs.prepare(legacy)).adapter.digest, legacy.adapter.digest);
  assert.equal(core.isActive({ ...core.createFlow('https://login.example.edu/', 1, 'legacy', legacy.institution), steps: 30 }, 2), false);
});

test('a pack may opt into its approved institution frames without authorizing other frame sites', async () => {
  const h = harness();
  const raw = example();
  const pack = await packs.prepare({ ...raw, adapter: { ...raw.adapter, frames: 'all', returnOrigins: ['https://return.example.edu'] } });
  await h.host.sync([pack.institution], [pack]);
  const message = { packId: pack.id, token: h.session.adapterCapabilities[0].token };
  const flow = core.createFlow('https://login.example.edu/', Date.now(), 'framed', pack.institution);
  const sender = { url: 'https://login.example.edu/iframe-login', frameId: 7, documentId: 'child-document', tab: { id: 1 } };
  assert.equal((await h.host.authenticate(message, sender, [pack], flow)).id, pack.id);
  assert.equal(await h.host.authenticate(message, { ...sender, url: 'https://evil.example/' }, [pack], flow), null);
  assert.equal(await h.host.authenticate(message, sender, [pack], { ...flow, active: false }), null);
  const returning = { ...sender, frameId: 0, url: 'https://return.example.edu/complete' };
  assert.equal(core.pageKind(returning.url, pack.institution), 'return');
  assert.equal(await h.host.authenticate(message, returning, [pack], flow), null);
  assert.equal((await h.host.authenticate(message, returning, [pack], { ...flow, owner: 'pack' })).id, pack.id);
});

test('worker requests stop at redirects, expose no redirect target, and disallow automatic following', async (t) => {
  const h = harness();
  let captured;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    captured = { url, options };
    return { type: 'opaqueredirect', ok: false, status: 0, headers: new Headers(), body: null };
  });
  const result = await h.host.request('https://login.example.edu/login', { method: 'POST', body: 'fake=account', redirect: 'manual' });
  assert.equal(captured.options.redirect, 'manual'); assert.equal(captured.options.credentials, 'include');
  assert.deepEqual(result, { ok: false, status: 0, opaqueRedirect: true, headers: {}, body: '' });
  await assert.rejects(h.host.request('https://login.example.edu/', { redirect: 'follow' }), /Redirects must stop/);
  await h.host.request('https://login.example.edu/', {}); assert.equal(captured.options.redirect, 'error');
});
