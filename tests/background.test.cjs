const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../extension/core.js');
const institution = require('./fixtures/institution.cjs');
const routes = require('../extension/routes.js');
const managers = require('../extension/integrations/reference-managers.js');
const packs = require('../extension/packs.js');
const adapterHost = require('../extension/adapter-host.js');

function harness(initial = {}) {
  const data = { local: { institutions: { selectedId: institution.id, profiles: [institution] }, ...initial }, session: {} };
  const access = {};
  const events = {};
  const area = (name) => ({
    async get(key) { return key ? { [key]: structuredClone(data[name][key]) } : structuredClone(data[name]); },
    async set(value) { Object.assign(data[name], structuredClone(value)); },
    async remove(key) { delete data[name][key]; },
    async setAccessLevel(value) { access[name] = value.accessLevel; }
  });
  const tabs = new Map([[1, { id: 1, url: 'https://pubs.rsc.org/' }], [2, { id: 2, url: 'https://pubs.acs.org/' }]]);
  const granted = { value: true };
  const registrations = new Map();
  const navigations = [];
  const routing = { current: true, fail: false };
  const chrome = {
    storage: { local: area('local'), session: area('session') },
    runtime: { getURL: (file) => `chrome-extension://test/${file}`, onMessage: { addListener(fn) { events.message = fn; } }, onUserScriptMessage: { addListener(fn) { events.userMessage = fn; } } },
    tabs: { async get(id) { return { ...tabs.get(id) }; },
      async update(id, change) { if (routing.fail) throw new Error('Fixture navigation failure'); navigations.push({ id, ...change }); },
      async sendMessage(id, message) { if (message?.type === 'page:describe') return { url: 'https://pubs.rsc.org/' }; if (message?.type === 'page:route-check') return { active: routing.current, url: tabs.get(id)?.url }; },
      onRemoved: { addListener(fn) { events.removed = fn; } }, onCreated: { addListener(fn) { events.created = fn; } }, onUpdated: { addListener(fn) { events.updated = fn; } } },
    permissions: { async contains(){return granted.value}, onRemoved:{addListener(){}}, onAdded:{addListener(){}} },
    scripting: { async executeScript() {}, async getRegisteredContentScripts(){return [...registrations.values()]}, async registerContentScripts(items){items.forEach(item=>registrations.set(item.id,item))}, async updateContentScripts(items){items.forEach(item=>registrations.set(item.id,item))}, async unregisterContentScripts({ids}){ids.forEach(id=>registrations.delete(id))} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), {
    Institution: core, InstitutionRoutes: routes, ReferenceManagers: managers, InstitutionPacks: packs, InstitutionAdapterHost: adapterHost, InstitutionLibraries: globalThis.InstitutionLibraries, InstitutionBundle: globalThis.InstitutionBundle, chrome, importScripts() {}, crypto: { randomUUID: () => 'flow-test' }, Date, Map, Promise, TextEncoder
  });
  const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const page = (url, id = 1, frameId = 0) => ({ id: 'test', tab: { id }, frameId, url, documentId: 'document-1' });
  const send = (message, sender = popup) => new Promise((resolve) => events.message(message, sender, resolve));
  const sendUser = (message, sender) => new Promise(resolve => events.userMessage(message, sender, resolve));
  return { send, sendUser, chrome, data, access, events, tabs, page, popup, granted, registrations, navigations, routing };
}

const casUrl = 'https://cas.fixture.edu/cas/login?service=' + encodeURIComponent('https://idp.fixture.edu/idp/Authn/External');

test('restricts storage and never exposes saved credentials through state or to publishers', async () => {
  const h = harness();
  await h.send({ type: 'credentials:save', username: 'fixture-user', password: 'fixture-password' });
  await h.send({ type: 'flow:start', tabId: 1 });
  assert.equal(h.access.local, 'TRUSTED_CONTEXTS');
  assert.equal(h.access.session, 'TRUSTED_CONTEXTS');
  const state = await h.send({ type: 'popup:state', tabId: 1 });
  assert.equal(state.hasCredentials, true);
  assert.equal(JSON.stringify(state).includes('fixture-password'), false);
  const bad = await h.send({ type: 'cas:credentials' }, h.page('https://pubs.rsc.org/'));
  assert.equal(bad.credentials, undefined);
  const good = await h.send({ type: 'cas:credentials' }, h.page(casUrl));
  assert.equal(good.credentials.password, 'fixture-password');
  assert.equal((await h.send({ type: 'cas:credentials' }, h.page(casUrl, 2))).credentials, undefined);
  assert.equal((await h.send({ type: 'cas:credentials' }, h.page(casUrl, 1, 1))).ok, false);
});

test('denies unrelated CAS services, spoofed settings changes, and credential writes from pages', async () => {
  const h = harness();
  await h.send({ type: 'credentials:save', username: 'fixture-user', password: 'fixture-password' });
  await h.send({ type: 'flow:start', tabId: 1 });
  assert.equal((await h.send({ type: 'cas:credentials' }, h.page('https://cas.fixture.edu/cas/login?service=https://tis.fixture.edu/cas'))).credentials, undefined);
  assert.equal((await h.send({ type: 'settings:save', settings: { autoSubmit: true } }, h.page('https://pubs.rsc.org/'))).ok, false);
  assert.equal((await h.send({ type: 'credentials:save', username: 'changed', password: 'changed' }, h.page(casUrl))).ok, false);
  assert.equal(h.data.local["credentials:fixture-u"].username, 'fixture-user');
});

test('permits at most one CAS submission per journey, including simultaneous requests', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  assert.equal((await h.send({ type: 'cas:submit' }, h.page(casUrl))).allowed, false);
  await h.send({ type: 'settings:save', settings: { autoSubmit: true } });
  const results = await Promise.all([h.send({ type: 'cas:submit' }, h.page(casUrl)), h.send({ type: 'cas:submit' }, h.page(casUrl))]);
  assert.equal(results.filter((result) => result.allowed).length, 1);
  assert.equal((await h.send({ type: 'cas:credentials' }, h.page(casUrl))).credentials, undefined);
});

test('stop wins over queued progress and blocks subsequent credential release', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  await Promise.all([
    h.send({ type: 'page:progress', phase: 'institution', action: true }, h.page('https://pubs.rsc.org/')),
    h.send({ type: 'flow:stop', tabId: 1 }),
    h.send({ type: 'page:progress', phase: 'institution', action: true }, h.page('https://pubs.rsc.org/'))
  ]);
  assert.equal(h.data.session['flow:1'].active, false);
  assert.equal((await h.send({ type: 'cas:credentials' }, h.page(casUrl))).credentials, undefined);
});

test('follows identity redirects but stops after returning without claiming authentication', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.acs.org/'))).active, false);
  await h.send({ type: 'flow:start', tabId: 1 });
  assert.equal((await h.send({ type: 'page:state' }, h.page(casUrl))).active, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://idp.fixture.edu/idp/profile/SAML2/POST/SSO'))).active, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/'))).active, false);
  assert.equal(h.data.session['flow:1'].phase, 'returned');
  assert.match(h.data.session['flow:1'].message, /Check the page/);
});

test('clears saved credentials and removes per-tab journey state', async () => {
  const h = harness();
  await h.send({ type: 'credentials:save', username: 'fixture-user', password: 'fixture-password' });
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'credentials:clear' });
  assert.equal(h.data.local["credentials:fixture-u"], undefined);
  h.data.session['adapterDocument:fixture-document'] = { tabId: 1, id: 'fixture-only' };
  await h.events.removed(1);
  assert.equal(h.data.session['flow:1'], undefined);
  assert.equal(h.data.session['adapterDocument:fixture-document'], undefined);
});

test('stops on returning from discovery even if existing SSO skips university documents', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'page:state' }, h.page('https://ds.carsi.edu.cn/login/index.html'));
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/'))).active, false);
});

test('provider continuation documents stay active until the identity or discovery round trip', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  const sender = h.page('https://pubs.rsc.org/');
  await h.send({ type: 'page:progress', phase: 'institution', action: true, handoff: true }, sender);
  assert.equal((await h.send({ type: 'page:state' }, sender)).active, true);
  assert.equal((await h.send({ type: 'page:state' }, { ...sender, documentId: 'provider-continuation' })).active, true);
  await h.send({ type: 'page:state' }, h.page(casUrl));
  assert.equal((await h.send({ type: 'page:state' }, { ...sender, documentId: 'document-after-sso' })).active, false);
});

const otherProfile = () => core.normalizeProfile({ id: 'other', library: 'standard-cas', name: 'Other University', identityOrigins: ['https://idp.other.edu'],
  cas: { loginUrl: 'https://login.other.edu/auth/login', servicePrefixes: ['https://idp.other.edu/saml/'] } });

test('new institution hosts require a grant and get their own registered scripts', async () => {
  const h = harness();
  h.granted.value = false;
  assert.equal((await h.send({ type: 'profile:save', profile: otherProfile() })).ok, false);
  h.granted.value = true;
  assert.equal((await h.send({ type: 'profile:save', profile: otherProfile() })).ok, true);
  assert.ok(h.registrations.get('institution-profile-other').js.includes('institutions/standard-cas.js'));
  assert.equal(h.registrations.get('institution-profile-other').matches.includes('https://*/*'), false);
});

test('institution switches preserve in-flight profiles and never mix credentials', async () => {
  const h = harness();
  await h.send({ type: 'credentials:save', username: 'first-fixture', password: 'first-fixture' });
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'profile:save', profile: otherProfile() });
  await h.send({ type: 'credentials:save', username: 'other-fixture', password: 'other-fixture' });
  await h.send({ type: 'flow:start', tabId: 2 });
  const otherUrl = 'https://login.other.edu/auth/login?service=https://idp.other.edu/saml/return';
  assert.equal((await h.send({ type: 'auth:credentials' }, h.page(casUrl, 1))).credentials.username, 'first-fixture');
  assert.equal((await h.send({ type: 'auth:credentials' }, h.page(otherUrl, 2))).credentials.username, 'other-fixture');
  assert.equal((await h.send({ type: 'auth:credentials' }, h.page(casUrl, 2))).credentials, undefined);
  const changed = { ...otherProfile(), cas: { loginUrl: 'https://login.other.edu/new/login', servicePrefixes: ['https://idp.other.edu/saml/'] } };
  await h.send({ type: 'profile:save', profile: changed });
  assert.equal((await h.send({ type: 'auth:credentials' }, h.page(otherUrl, 2))).credentials, null);
});


test('popup and start recover page context when the tab URL is withheld', async () => {
  const h = harness();
  h.tabs.set(1, { id: 1 });
  const state = await h.send({ type: 'popup:state', tabId: 1 });
  assert.equal(state.supported, true);
  assert.equal(state.provider.id, 'rsc');
  assert.equal((await h.send({ type: 'flow:start', tabId: 1 })).ok, true);
});

test('an existing institution banner stops assistance without declaring a new login', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'page:access-present' }, h.page('https://pubs.rsc.org/'));
  assert.equal(h.data.session['flow:1'].active, false);
  assert.equal(h.data.session['flow:1'].phase, 'access-present');
});

test('an unrelated provider does not remain locked by an inherited journey', async () => {
  const h = harness();
  await h.send({ type: 'flow:start', tabId: 1 });
  h.tabs.set(1, { id: 1, url: 'https://link.springer.com/' });
  assert.equal((await h.send({ type: 'popup:state', tabId: 1 })).flow.active, false);
  await h.send({ type: 'page:state' }, h.page('https://link.springer.com/'));
  assert.equal(h.data.session['flow:1'].active, false);
  assert.equal((await h.send({ type: 'flow:start', tabId: 1 })).ok, true);
  assert.equal(h.data.session['flow:1'].providerId, 'springer');
});

test('automatic start is opt-in, skips unrelated CAS pages, and respects Stop on the current tab', async () => {
  const h = harness();
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/'))).active, false);
  await h.send({ type: 'settings:save', settings: { autoStart: true } });
  assert.equal((await h.send({ type: 'page:state' }, h.page(casUrl))).active, false);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/'))).active, true);
  await h.send({ type: 'page:stop' }, h.page('https://pubs.rsc.org/'));
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/'))).active, false);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.acs.org/'))).active, false);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.acs.org/', 2))).active, true);
});

test('worker navigates a current document once without returning the transaction URL', async () => {
  const h = harness();
  const url = 'https://fsso.cnki.net/';
  h.tabs.set(1, { id: 1, url });
  await h.send({ type: 'flow:start', tabId: 1 });
  const results = await Promise.all([h.send({ type: 'page:route' }, h.page(url)), h.send({ type: 'page:route' }, h.page(url))]);
  assert.equal(results.filter(result => result.navigating).length, 1);
  assert.equal(results.some(result => Object.hasOwn(result, 'url')), false);
  assert.equal(h.navigations.length, 1);
  assert.equal(h.data.session['flow:1'].steps, 1);
  assert.equal(h.data.session['flow:1'].casAttempted, false);
  assert.equal(JSON.stringify(h.data.session).includes('secure/default.aspx'), false);
});

test('compatibility mode, stale documents, Stop, expiry and step limits prevent direct navigation', async () => {
  for (const boundary of ['compatibility', 'stale-document', 'changed-url', 'stop', 'expiry', 'limit', 'missing-document']) {
    const h = harness();
    const url = 'https://fsso.cnki.net/';
    h.tabs.set(1, { id: 1, url });
    await h.send({ type: 'flow:start', tabId: 1 });
    if (boundary === 'compatibility') await h.send({ type: 'settings:save', settings: { browserOnly: true } });
    if (boundary === 'stale-document') h.routing.current = false;
    if (boundary === 'changed-url') h.tabs.set(1, { id: 1, url: 'https://www.cnki.net/' });
    if (boundary === 'stop') await h.send({ type: 'flow:stop', tabId: 1 });
    if (boundary === 'expiry') h.data.session['flow:1'].expiresAt = 0;
    if (boundary === 'limit') h.data.session['flow:1'].steps = core.LIMITS.maxSteps - 1;
    await h.send({ type: 'page:route' }, { ...h.page(url), ...(boundary === 'missing-document' ? { documentId: undefined } : {}) });
    assert.equal(h.navigations.length, 0, boundary);
  }
});

test('navigation failure consumes a direct attempt and permits the DOM fallback', async () => {
  const h = harness();
  const url = 'https://fsso.cnki.net/';
  h.tabs.set(1, { id: 1, url });
  await h.send({ type: 'flow:start', tabId: 1 });
  h.routing.fail = true;
  assert.equal((await h.send({ type: 'page:route' }, h.page(url))).navigating, undefined);
  h.routing.fail = false;
  await h.send({ type: 'page:route' }, h.page(url));
  assert.equal(h.navigations.length, 0);
  assert.equal((await h.send({ type: 'page:state' }, h.page(url))).active, true);
});

test('Elsevier post-SSO personalization stays active until Scopus content returns', async () => {
  const h = harness();
  h.tabs.set(1, { id: 1, url: 'https://www.scopus.com/' });
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'page:state' }, h.page(casUrl));
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://id.elsevier.com/as/resume'))).active, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://www.scopus.com/pages/home'))).active, false);
});

test('institutional entry banners do not end a requested login before the university visit', async () => {
  const h = harness();
  h.tabs.set(1, { id: 1, url: 'https://pubs.rsc.org/institutional-login' });
  await h.send({ type: 'flow:start', tabId: 1 });
  const entry = h.page('https://pubs.rsc.org/institutional-login');
  assert.equal((await h.send({ type: 'page:access-present' }, entry)).ok, false);
  assert.equal(h.data.session['flow:1'].active, true);
  await h.send({ type: 'page:state' }, h.page(casUrl));
  assert.equal((await h.send({ type: 'page:state' }, entry)).active, true);
  assert.equal((await h.send({ type: 'page:access-present' }, entry)).active, false);
});

test('an unavailable institutional remote-login method ends assistance without retrying', async () => {
  const h = harness();
  h.tabs.set(1, { id: 1, url: 'https://www.jstor.org/institutionSearch' });
  await h.send({ type: 'flow:start', tabId: 1 });
  const sender = h.page('https://www.jstor.org/institutionSearch');
  assert.equal((await h.send({ type: 'page:remote-unavailable' }, sender)).active, false);
  assert.equal(h.data.session['flow:1'].phase, 'remote-unavailable');
  assert.equal(h.data.session['flow:1'].casAttempted, false);
  assert.equal((await h.send({ type: 'page:state' }, sender)).active, false);
});

test('WOS discovery continues through the legacy auto-POST gateway before the IdP', async () => {
  const h = harness();
  h.tabs.set(1, { id: 1, url: 'https://www.webofscience.com/' });
  await h.send({ type: 'flow:start', tabId: 1 });
  await h.send({ type: 'page:state' }, h.page('https://ds.carsi.edu.cn/login/index.html'));
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://www.webofknowledge.com/'))).active, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://idp.fixture.edu/idp/profile/SAML2/POST/SSO'))).active, true);
  assert.equal(h.data.session['flow:1'].visitedIdentity, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://www.webofscience.com/wos/woscc/smart-search'))).active, false);
});



test('SPA routing binds the current URL to its original origin and still-current document', async () => {
  const h = harness();
  const initial = 'https://ds.carsi.edu.cn/login/index.html';
  const complete = initial + '?' + new URLSearchParams({entityID:'https://pubs.rsc.org/shibboleth',return:'https://pubs.rsc.org/Shibboleth.sso/Login'});
  h.tabs.set(1, { id: 1, url: 'https://pubs.rsc.org/' });
  await h.send({ type: 'flow:start', tabId: 1 });
  h.tabs.set(1, { id: 1, url: initial });
  assert.equal((await h.send({ type: 'page:route', url: 'https://pubs.acs.org/' }, h.page(initial))).navigating, undefined);
  assert.equal((await h.send({ type: 'page:route', url: complete }, h.page(initial))).navigating, undefined);
  assert.equal(h.navigations.length, 0);
  h.tabs.set(1, { id: 1, url: complete });
  assert.equal((await h.send({ type: 'page:route', url: complete }, h.page(initial))).navigating, true);
  assert.equal(h.navigations.length, 1);
});

test('reference-manager choice is global, validated and restricted to the popup', async () => {
  const h = harness();
  assert.equal((await h.send({ type: 'popup:state', tabId: 1 })).referenceManager.id, 'zotero');
  assert.equal((await h.send({ type: 'reference-manager:select', managerId: 'endnote' })).ok, true);
  await h.send({ type: 'profile:save', profile: otherProfile() });
  assert.equal((await h.send({ type: 'popup:state', tabId: 1 })).referenceManager.id, 'endnote');
  assert.equal((await h.send({ type: 'reference-manager:select', managerId: 'unreviewed' })).ok, false);
  await h.send({ type: 'reference-manager:select', managerId: 'zotero' }, h.page('https://pubs.rsc.org/'));
  assert.equal(h.data.local.referenceManager, 'endnote');
});

test('retired PDF commands cannot initiate capture or reserve download state', async () => {
  const h = harness();
  const result = await h.send({ type: 'article:download', url: 'https://www.nature.com/articles/fixture.pdf' }, h.page('https://www.nature.com/articles/fixture'));
  assert.equal(result.ok, false);
  assert.match(result.error, /reference manager/);
  assert.equal(h.data.local.articleDownloadAt, undefined);
  assert.equal(h.navigations.length, 0);
});

const packPage = { url: 'chrome-extension://test/packs.html', tab: { id: 99 }, frameId: 0 };
const packFor = (profile = core.normalizeProfile({ id: 'pack-u', name: 'Pack University', library: 'manual', identityOrigins: ['https://login.pack.example'] }), version = '1.0.0') => packs.fromProfile(profile, { version, maintainer: 'Fixture maintainer' });
const previewPack = (h, pack) => h.send({ type: 'pack:preview', text: JSON.stringify(pack) }, packPage);

test('pack installation requires review and exact host permission, then persists without enabling automation', async () => {
  const h = harness();
  const pack = packFor();
  const preview = await previewPack(h, pack);
  assert.equal(preview.ok, true);
  assert.equal(h.data.local.institutionPacks, undefined);
  assert.deepEqual(preview.origins, ['https://login.pack.example/*']);
  assert.equal((await h.send({ type: 'pack:install', pack }, packPage)).ok, false);
  h.granted.value = false;
  assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, false);
  assert.equal(h.data.local.institutionPacks, undefined);
  h.granted.value = true;
  assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, true);
  assert.equal(h.data.local.institutions.selectedId, 'pack-u');
  assert.equal(h.data.local.institutionPacks[0].id, 'pack-u');
  assert.equal(h.data.local['settings:pack-u'], undefined);
  assert.equal(h.data.local['credentials:pack-u'], undefined);
  assert.deepEqual(h.registrations.get('institution-profile-pack-u').matches, ['https://login.pack.example/*']);
  const restarted = harness(structuredClone(h.data.local));
  const state = await restarted.send({ type: 'packs:state' }, packPage);
  assert.equal(state.packs[0].version, '1.0.0');
  assert.equal(state.selectedId, 'pack-u');
  assert.equal((await restarted.send({ type: 'pack:select', profileId: institution.id }, packPage)).ok, true);
  assert.equal((await restarted.send({ type: 'packs:state' }, packPage)).selectedId, institution.id);
});

test('pack updates preserve unchanged login bindings and clear secrets and preferences when auth scope changes', async () => {
  const h = harness();
  await h.send({ type: 'credentials:save', username: 'fixture-user', password: 'fixture-password' });
  await h.send({ type: 'settings:save', settings: { autoStart: true, autoSubmit: true } });
  const pack = packFor(institution);
  const preview = await previewPack(h, pack);
  assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, true);
  assert.equal(h.data.local[`credentials:${institution.id}`].password, 'fixture-password');
  assert.equal(h.data.local[`settings:${institution.id}`].autoStart, true);
  const exported = await h.send({ type: 'pack:export', profileId: institution.id }, packPage);
  assert.equal(JSON.stringify(exported).includes('fixture-password'), false);
  assert.equal(JSON.stringify(exported).includes('autoStart'), false);
  const changed = packFor(core.normalizeProfile({ ...institution, identityOrigins: [...institution.identityOrigins, 'https://second.fixture.edu'] }), '2.0.0');
  const update = await previewPack(h, changed);
  assert.equal((await h.send({ type: 'pack:install', pack: changed, snapshot: update.snapshot }, packPage)).ok, true);
  assert.equal(h.data.local[`credentials:${institution.id}`], undefined);
  assert.equal(h.data.local[`settings:${institution.id}`], undefined);
});

test('stale pack reviews cannot overwrite a subsequently edited institution', async () => {
  const h = harness();
  const pack = packFor();
  const preview = await previewPack(h, pack);
  await h.send({ type: 'profile:save', profile: { ...pack.institution, name: 'Local edit' } });
  const result = await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage);
  assert.match(result.error, /changed after review/);
  assert.equal(h.data.local.institutions.profiles.find(item => item.id === pack.id).name, 'Local edit');
  assert.equal(h.data.local.institutionPacks, undefined);
});

test('pack manager cannot read credentials or change automation and publisher pages cannot manage packs', async () => {
  const h = harness();
  const pack = packFor();
  await h.send({ type: 'credentials:save', username: 'fixture-user', password: 'fixture-password' });
  for (const message of [{ type: 'credentials:save', username: 'changed', password: 'changed' }, { type: 'credentials:clear' }, { type: 'settings:save', settings: { autoSubmit: true } }, { type: 'auth:credentials' }]) {
    assert.equal((await h.send(message, packPage)).ok, false);
  }
  for (const type of ['packs:state', 'pack:preview', 'pack:install', 'pack:export', 'pack:remove', 'pack:select']) {
    assert.equal((await h.send({ type, pack, text: JSON.stringify(pack), profileId: institution.id }, h.page('https://pubs.rsc.org/'))).ok, false);
  }
  assert.equal((await h.send({ type: 'packs:state' }, { ...packPage, frameId: 1 })).ok, false);
  assert.equal(JSON.stringify(await h.send({ type: 'packs:state' }, packPage)).includes('fixture-password'), false);
  assert.equal(h.data.local[`credentials:${institution.id}`].password, 'fixture-password');
});

test('removing a pack removes its scoped data and registrations while preserving other institutions', async () => {
  const h = harness();
  const pack = packFor();
  const preview = await previewPack(h, pack);
  await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage);
  h.data.local['settings:pack-u'] = { autoStart: true };
  h.data.local['credentials:pack-u'] = { username: 'fixture-only', password: 'fixture-only' };
  assert.equal((await h.send({ type: 'pack:remove', profileId: 'pack-u' }, packPage)).ok, true);
  assert.equal(h.data.local.institutionPacks.length, 0);
  assert.equal(h.data.local['credentials:pack-u'], undefined);
  assert.equal(h.data.local['settings:pack-u'], undefined);
  assert.equal(h.registrations.has('institution-profile-pack-u'), false);
  assert.equal(h.data.local.institutions.selectedId, institution.id);
  assert.equal((await h.send({ type: 'pack:remove', profileId: institution.id }, packPage)).ok, true);
  assert.equal(h.data.local.institutions.selectedId, 'unconfigured');
});

test('concurrent pack windows and popup edits cannot lose institution configurations', async () => {
  const h = harness();
  const first = packFor();
  const second = packFor(core.normalizeProfile({ ...first.institution, id: 'pack-v', name: 'Another Pack University' }));
  const [a, b] = await Promise.all([previewPack(h, first), previewPack(h, second)]);
  const results = await Promise.all([
    h.send({ type: 'pack:install', pack: first, snapshot: a.snapshot }, packPage),
    h.send({ type: 'pack:install', pack: second, snapshot: b.snapshot }, { ...packPage, tab: { id: 100 } }),
    h.send({ type: 'profile:save', profile: core.normalizeProfile({ id: 'local-u', name: 'Local University' }) })
  ]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(h.data.local.institutions.profiles.length, 4);
  assert.equal(h.data.local.institutionPacks.length, 2);
});

async function executableFixture() {
  const directory = path.join(__dirname, '../examples/custom-university');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  return packs.prepare({ ...manifest, files: Object.fromEntries([...manifest.adapter.scripts, ...manifest.adapter.resources].map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')])) });
}
function enableMockCodeRuntime(h) {
  const registered = new Map();
  const validate = items => { for (const item of items) for (const source of item.js) if (source.code) new vm.Script(source.code); };
  h.chrome.userScripts = {
    async getScripts(filter) { return [...registered.values()].filter(item => !filter || filter.ids.includes(item.id)); },
    async configureWorld() {},
    async register(items) { validate(items); items.forEach(item => registered.set(item.id, item)); },
    async update(items) { validate(items); items.forEach(item => registered.set(item.id, item)); },
    async unregister({ ids }) { ids.forEach(id => registered.delete(id)); },
    async execute() { return []; }
  };
}

test('executable installation fails before configuration changes when the browser runtime is disabled', async () => {
  const h = harness();
  const pack = await executableFixture();
  const preview = await h.send({ type: 'pack:preview', pack }, packPage);
  assert.equal(preview.executable, true);
  assert.equal(preview.runtimeAvailable, false);
  const response = await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage);
  assert.match(response.error, /Allow User Scripts/);
  assert.equal(h.data.local.institutions.profiles.length, 1);
  assert.equal(h.data.local.institutionPacks, undefined);
});

test('imported messages cannot read the vault, navigate outside scope or act after Stop; invalid updates roll back', async () => {
  const h = harness();
  enableMockCodeRuntime(h);
  await h.send({ type: 'credentials:save', username: 'fixture-only', password: 'private-fixture-only' });
  const pack = await executableFixture();
  const preview = await h.send({ type: 'pack:preview', pack }, packPage);
  assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, true);
  h.tabs.set(1, { id: 1, url: 'https://login.example.edu/portal/start' });
  await h.send({ type: 'flow:start', tabId: 1 });
  const capability = h.data.session.adapterCapabilities[0];
  const source = h.page('https://login.example.edu/portal/start');
  const message = { packId: pack.id, token: capability.token, operation: 'state' };
  const state = await h.sendUser(message, source);
  assert.equal(state.active, true);
  assert.equal(JSON.stringify(state).includes('private-fixture-only'), false);
  const exported = await h.send({ type: 'pack:export', profileId: pack.id }, packPage);
  assert.equal((await packs.prepare(exported.pack)).adapter.digest, pack.adapter.digest);
  for (const operation of ['auth:credentials', 'credentials', 'storage', 'settings:save', 'download']) assert.equal((await h.sendUser({ ...message, operation }, source)).ok, false);
  assert.equal((await h.sendUser({ ...message, operation: 'navigate', url: 'https://evil.example/' }, source)).ok, false);
  assert.equal(h.navigations.length, 0);
  assert.equal((await h.sendUser({ ...message, operation: 'step' }, source)).active, true);
  await h.send({ type: 'flow:stop', tabId: 1 });
  assert.equal((await h.sendUser({ ...message, operation: 'step' }, source)).active, false);
  const broken = await packs.prepare({ ...pack, adapter: { ...pack.adapter, digest: undefined }, files: { ...pack.files, 'adapter.js': 'invalid syntax }' } });
  const update = await h.send({ type: 'pack:preview', pack: broken }, packPage);
  assert.equal((await h.send({ type: 'pack:install', pack: broken, snapshot: update.snapshot }, packPage)).ok, false);
  assert.equal(h.data.local.institutionPacks[0].adapter.digest, pack.adapter.digest);
  assert.equal(h.data.local[`credentials:${institution.id}`].password, 'private-fixture-only');
});

test('API 2 packs own configuration, persistent state and completion beyond the discovery budget', async () => {
  const h = harness();
  enableMockCodeRuntime(h);
  const pack = await executableFixture();
  const preview = await h.send({ type: 'pack:preview', pack }, packPage);
  assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, true);
  const view = await h.send({ type: 'pack:configure', profileId: pack.id }, { ...packPage, url: packPage.url + '#' + pack.id });
  const config = { unusual: { tenant: ['hospital', 7] }, secret: 'fictional-private-config' };
  const save = { type: 'pack:configure-save', profileId: pack.id, digest: pack.adapter.digest, revision: view.revision, config };
  const oversized = await h.send({ ...save, config: '界'.repeat(30000) }, packPage);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.includes('界'), false);
  assert.equal((await h.send(save, packPage)).ok, true);
  assert.equal((await h.send(save, packPage)).ok, false, 'stale setup windows cannot overwrite newer configuration');
  assert.equal((await h.send({ type: 'pack:configure', profileId: pack.id }, h.page('https://login.example.edu/'))).ok, false);
  assert.equal(JSON.stringify(await h.send({ type: 'packs:state' }, packPage)).includes(config.secret), false);
  assert.equal(JSON.stringify(await h.send({ type: 'pack:export', profileId: pack.id }, packPage)).includes(config.secret), false);
  h.tabs.set(1, { id: 1, url: 'https://login.example.edu/portal/start' });
  await h.send({ type: 'flow:start', tabId: 1 });
  const sender = h.page(h.tabs.get(1).url);
  const message = { packId: pack.id, token: h.data.session.adapterCapabilities[0].token, operation: 'state' };
  assert.deepEqual((await h.sendUser(message, sender)).config, config);
  h.data.session['flow:1'].expiresAt = 1;
  h.data.session['flow:1'].steps = 100;
  for (let i = 0; i < 35; i++) assert.equal((await h.sendUser({ ...message, operation: 'step' }, sender)).active, true);
  assert.equal((await h.send({ type: 'page:state' }, h.page('https://pubs.rsc.org/article/return'))).active, true);
  assert.equal((await h.send({ type: 'page:access-present' }, h.page('https://pubs.rsc.org/article/return'))).active, true);
  assert.equal((await h.sendUser({ ...message, operation: 'storage', action: 'set', value: { ticket: 'fixture-ticket' } }, sender)).ok, true);
  assert.deepEqual((await h.sendUser({ ...message, operation: 'storage', action: 'get' }, sender)).value, { ticket: 'fixture-ticket' });
  assert.equal(h.data.local[`packData:${pack.id}`].config.secret, config.secret);
  assert.equal((await h.sendUser({ ...message, operation: 'request', url: 'https://evil.example/', options: {} }, sender)).ok, false);
  h.granted.value = false;
  assert.equal((await h.sendUser(message, sender)).active, false);
  h.granted.value = true;
  assert.equal((await h.sendUser({ ...message, operation: 'complete', returnUrl: 'https://pubs.rsc.org/article/return' }, sender)).active, false);
  assert.equal(h.data.session['flow:1'].phase, 'returned');
  assert.equal(h.navigations.at(-1).url, 'https://pubs.rsc.org/article/return');
  assert.equal((await h.sendUser(message, sender)).config, undefined);
  assert.equal((await h.send({ type: 'pack:remove', profileId: pack.id }, packPage)).ok, true);
  assert.equal(h.data.local[`packData:${pack.id}`], undefined);
});

test('another pack cannot read private configuration and a waiting page script cannot block Stop', async () => {
  const h = harness();
  enableMockCodeRuntime(h);
  const first = await executableFixture();
  const second = await packs.prepare({ ...first, id: 'another-u', institution: { ...first.institution, id: 'another-u' }, adapter: { ...first.adapter, digest: undefined } });
  for (const pack of [first, second]) {
    const preview = await h.send({ type: 'pack:preview', pack }, packPage);
    assert.equal((await h.send({ type: 'pack:install', pack, snapshot: preview.snapshot }, packPage)).ok, true);
  }
  h.data.local[`packData:${first.id}`] = { config: { secret: 'first-private-fixture' }, state: { secret: 'first-private-state' } };
  h.tabs.set(1, { id: 1, url: 'https://login.example.edu/portal/start' });
  await h.send({ type: 'flow:start', tabId: 1 });
  const sender = h.page(h.tabs.get(1).url);
  const token = h.data.session.adapterCapabilities.find(item => item.id === second.id).token;
  const message = { packId: second.id, token, operation: 'state' };
  assert.equal(JSON.stringify(await h.sendUser(message, sender)).includes('first-private'), false);
  assert.equal((await h.sendUser({ ...message, packId: first.id }, sender)).active, false);
  assert.equal(JSON.stringify(await h.sendUser({ ...message, operation: 'storage', action: 'get', profileId: first.id }, sender)).includes('first-private'), false);
  let finish;
  h.chrome.userScripts.execute = async () => new Promise(resolve => { finish = resolve; });
  const waiting = h.sendUser({ ...message, operation: 'page-run', source: '() => new Promise(() => {})', args: [] }, sender);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.send({ type: 'flow:stop', tabId: 1 })).ok, true);
  finish([{ result: 'stale-page-result' }]);
  const reply = await waiting;
  assert.equal(reply.active, false);
  assert.equal(reply.value, undefined);
});

test('a clean core has no university default and unavailable libraries cannot receive legacy credentials', async () => {
  const h = harness({ institutions: undefined });
  const initial = await h.send({ type: 'popup:state', tabId: 1 });
  assert.equal(initial.profile.id, 'unconfigured');
  assert.equal((await h.send({ type: 'flow:start', tabId: 1 })).ok, false);
  const profile = { ...institution, library: 'not-installed' };
  const old = { username: 'fixture-old', password: 'fixture-old-private', scope: core.credentialScope(profile) };
  const upgraded = harness({ institutions: { selectedId: profile.id, profiles: [profile] }, [`credentials:${profile.id}`]: old });
  upgraded.data.session['flow:1'] = { ...core.createFlow('https://pubs.rsc.org/', Date.now(), 'legacy-fixture', institution), profile };
  const state = await upgraded.send({ type: 'popup:state', tabId: 1 });
  assert.equal(state.profile.library, 'manual');
  assert.equal(state.hasCredentials, false);
  assert.equal(state.flow.active, false);
  assert.equal((await upgraded.send({ type: 'page:state' }, upgraded.page('https://idp.fixture.edu/'))).active, false);
  assert.equal(JSON.stringify(state).includes(old.password), false);
  assert.equal(upgraded.data.local.institutions.profiles[0].library, 'not-installed');
  assert.deepEqual(upgraded.data.local[`credentials:${profile.id}`], old);
  await upgraded.send({ type: 'profile:save', profile: { id: 'another-profile', name: 'Another Institution' } });
  assert.equal(upgraded.data.local.institutions.profiles.find(item => item.id === profile.id).library, 'not-installed');
});
