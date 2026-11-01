const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const institution = require('./fixtures/institution.cjs');
const routes = require('../extension/routes.js');
const discovery = (callback, extra = {}) => 'https://ds.carsi.edu.cn/login/index.html?' + new URLSearchParams({
  entityID: 'https://fsso.cnki.net/shibboleth', return: callback, ...extra
});
const flow = (profile = institution) => core.createFlow('https://www.cnki.net/', Date.now(), 'fixture', profile);

test('CNKI entry route skips school discovery and retains article flows', () => {
  const plan = routes.plan('https://www.cnki.net/', flow());
  const url = new URL(plan.url);
  assert.equal(plan.id, 'cnki:sp-init');
  assert.equal(url.origin + url.pathname, 'https://fsso.cnki.net/Shibboleth.sso/Login');
  assert.equal(url.searchParams.get('entityID'), institution.entityId);
  assert.equal(url.searchParams.get('target'), 'https://fsso.cnki.net/secure/default.aspx');
  for (const source of ['https://www.cnki.net/article/123', 'https://www.cnki.net/?search=123', 'https://unknown.cnki.net/']) assert.equal(routes.plan(source, flow()), null);
});

test('discovery response preserves the SP query bytes and uses the journey institution', () => {
  const callback = 'https://fsso.cnki.net/Shibboleth.sso/Login?SAMLDS=1&target=cookie%3Afixture%2B123&state=a%20b';
  const plan = routes.plan(discovery(callback), flow());
  assert.equal(plan.url, callback + '&entityID=' + encodeURIComponent(institution.entityId));
  const other = core.normalizeProfile({ id: 'other', name: 'Other University', entityId: 'https://sso.other.edu/metadata', identityOrigins: ['https://sso.other.edu'] });
  const alternate = routes.plan(discovery(callback, { returnIDParam: 'idp' }), flow(other));
  assert.equal(new URL(alternate.url).searchParams.get('idp'), other.entityId);
});

test('untrusted discovery callbacks and ambiguous or unsupported transactions fall back', () => {
  const callback = 'https://fsso.cnki.net/Shibboleth.sso/Login';
  for (const target of ['https://evil.test/Shibboleth.sso/Login', 'http://fsso.cnki.net/Shibboleth.sso/Login',
    'https://fsso.cnki.net.evil.test/Shibboleth.sso/Login', 'https://www.cnki.net/redirect',
    'https://fsso.cnki.net/Shibboleth.sso/Login#fragment', callback + '?entityID=existing',
    'https://pubs.acs.org/Shibboleth.sso/Login', 'https://user@fsso.cnki.net/Shibboleth.sso/Login',
    'https://arbitrary.cnki.net/Shibboleth.sso/Login']) assert.equal(routes.plan(discovery(target), flow()), null, target);
  for (const extra of [{ policy: 'unknown' }, { returnIDParam: 'redirect' }, { entityID: '' }]) assert.equal(routes.plan(discovery(callback, extra), flow()), null);
  for (const suffix of ['&return=second', '&entityID=second', '&returnIDParam=idp&returnIDParam=idp']) assert.equal(routes.plan(discovery(callback) + suffix, flow()), null);
  assert.equal(routes.plan(discovery(callback).replace('ds.carsi.edu.cn', 'ds.carsi.edu.cn.evil.test'), flow()), null);
  assert.equal(routes.plan('https://ds.carsi.edu.cn/login/index.html', flow()), null);
  assert.equal(routes.plan(discovery(callback), { ...flow(), active: false }), null);
  assert.equal(routes.plan(discovery(callback), { ...flow(), providerId: null }), null);
  assert.equal(routes.plan(discovery(callback), flow(core.normalizeProfile({ id: 'manual', name: 'Manual' }))), null);
});

test('published provider routes use the selected university and preserve supported return URLs', () => {
  const profile = core.normalizeProfile({ id: 'other', name: 'Other University', entityId: 'https://sso.other.edu/metadata', identityOrigins: ['https://sso.other.edu'] });
  for (const [source, endpoint, entityKey, targetKey] of [
    ['https://link.springer.com/book/fixture?chapter=2', 'https://fsso.springer.com/federation/init', 'entityId', 'returnUrl'],
    ['https://www.nature.com/articles/fixture', 'https://sp.nature.com/saml/login', 'idp', 'targetUrl'],
    ['https://ieeexplore.ieee.org/', 'https://ieeexplore.ieee.org/servlet/wayf.jsp', 'entityId', 'url'],
    ['https://ieeexplore.ieee.org/Xplore/home.jsp', 'https://ieeexplore.ieee.org/servlet/wayf.jsp', 'entityId', 'url'],
    ['https://onlinelibrary.wiley.com/', 'https://onlinelibrary.wiley.com/action/ssostart', 'idp', 'redirectUri'],
    ['https://www.scopus.com/', 'https://auth.elsevier.com/ShibAuth/institutionLogin', 'entityID', 'appReturnURL'],
    ['https://www.scopus.com/pages/home', 'https://auth.elsevier.com/ShibAuth/institutionLogin', 'entityID', 'appReturnURL'],
    ['https://pubs.acs.org/', 'https://pubs.acs.org/Shibboleth.sso/Login', 'entityID', 'target'],
    ['https://www.tandfonline.com/', 'https://www.tandfonline.com/action/ssostart', 'idp', 'redirectUri']
  ]) {
    const plan = routes.plan(source, core.createFlow(source, Date.now(), 'fixture', profile));
    const url = new URL(plan.url);
    assert.equal(url.origin + url.pathname, endpoint);
    assert.equal(url.searchParams.get(entityKey), profile.entityId);
    assert.equal(url.searchParams.get(targetKey), source === 'https://www.scopus.com/pages/home' ? 'https://www.scopus.com/' : source);
  }
  const source = 'https://www.sciencedirect.com/';
  const url = new URL(routes.plan(source, core.createFlow(source, Date.now(), 'fixture', institution)).url);
  const router = new URL(url.searchParams.get('appReturnURL'));
  assert.equal(router.origin + router.pathname, 'https://www.sciencedirect.com/user/router/shib');
  assert.equal(router.searchParams.get('targetURL'), source);
});

test('RSC broker entry skips menus while letting the publisher establish its OIDC state', () => {
  const source = 'https://pubs.rsc.org/';
  const route = routes.plan(source, core.createFlow(source, Date.now(), 'fixture', institution));
  assert.equal(route.id, 'rsc:broker-init');
  const url = new URL(route.url);
  assert.equal(url.origin + url.pathname, 'https://pubs.rsc.org/FederatedAccess/FederatedLogin');
  assert.equal(url.searchParams.get('returnUrl'), source);
  assert.equal(core.isResearchPage(url.href), false);
});


test('direct entry routes do not replace active protocol transactions or unsupported content paths', () => {
  for (const source of ['https://id.elsevier.com/as/resume', 'https://fsso.springer.com/federation/init',
    'https://secure.nature.com/saml2/continue', 'https://www.sciencedirect.com/science/article/pii/fixture',
    'https://ieeexplore.ieee.org/document/fixture', 'https://onlinelibrary.wiley.com/doi/fixture']) assert.equal(routes.plan(source, core.createFlow(source)), null, source);
  for (const key of ['SAMLRequest', 'RelayState', 'entityId', 'code', 'ticket']) {
    const source = 'https://link.springer.com/?' + key + '=fixture';
    assert.equal(routes.plan(source, core.createFlow(source)), null, key);
  }
});

test('entity IDs retain their exact configured identifier rather than URL normalization', () => {
  const profile = core.normalizeProfile({ id: 'other', name: 'Other University', entityId: 'https://sso.other.edu', identityOrigins: ['https://sso.other.edu'] });
  const plan = routes.plan('https://onlinelibrary.wiley.com/', core.createFlow('https://onlinelibrary.wiley.com/', Date.now(), 'fixture', profile));
  assert.equal(new URL(plan.url).searchParams.get('idp'), profile.entityId);
  assert.equal(new URL(routes.plan(discovery('https://fsso.cnki.net/Shibboleth.sso/Login'), flow(profile)).url).searchParams.get('entityID'), profile.entityId);
});
