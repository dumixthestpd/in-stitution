const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const institution = require('./fixtures/institution.cjs');

test('recognizes provider families and rejects lookalike, insecure, and credentialed URLs', () => {
  for (const provider of core.PROVIDERS) {
    assert.equal(core.providerFor(provider.home).id, provider.id);
    for (const domain of provider.domains) assert.equal(core.providerFor(`https://${domain}/article/123`).id, provider.id);
  }
  for (const url of ['https://pubs.acs.org.evil.test/', 'https://evilcnki.net/', 'http://www.cnki.net/',
    'https://attacker@cas.fixture.edu/cas/login', 'https://pubs.acs.org:9443/', 'javascript:alert(1)', 'bad']) {
    assert.equal(core.pageKind(url, institution), null, url);
  }
});

test('journeys are bounded in time, action count, and provider family', () => {
  const flow = core.createFlow('https://pubs.rsc.org/en/content/article/1', 1000, 'test', institution);
  assert.ok(core.isActive(flow, 1001));
  assert.equal(core.isActive(flow, flow.expiresAt), false);
  assert.equal(core.isActive({ ...flow, steps: core.LIMITS.maxSteps }, 1001), false);
  assert.equal(core.isActive({ ...flow, active: false }, 1001), false);
  assert.ok(core.isAllowedHop('https://ds.carsi.edu.cn/login/index.html', flow));
  assert.ok(core.isAllowedHop('https://www.rsc.org/rsc-id/account/federatedaccess', flow));
  assert.equal(core.isAllowedHop('https://pubs.acs.org/', flow), false);
  assert.throws(() => core.createFlow('https://example.org/'));
});

test('CAS credentials require the exact university origin and an IdP service', () => {
  const service = encodeURIComponent('https://idp.fixture.edu/idp/Authn/External?conversation=e1s1');
  assert.ok(core.isCasCredentialPage(`https://cas.fixture.edu/cas/login?service=${service}`, institution));
  for (const url of [
    'https://cas.fixture.edu/cas/login',
    'https://cas.fixture.edu/cas/login?service=https://tis.fixture.edu/cas',
    'https://cas.fixture.edu/cas/login?service=https://idp.fixture.edu.evil.test/idp/',
    'https://cas.fixture.edu/cas/login?service=http://idp.fixture.edu/idp/',
    'https://cas.fixture.edu.evil.test/cas/login?service=' + service,
    'https://cas.fixture.edu/cas/login?service=https://idp.fixture.edu/other/'
  ]) assert.equal(core.isCasCredentialPage(url, institution), false, url);
});

test('matches the configured institution in Chinese and English without confusing nearby institutions', () => {
  for (const name of ['示例大学', 'Fixture U', 'Fixture University of Science and Technology',
    'Fixture University of Science & Technology', '示例大学（Fixture University of Science and Technology）']) assert.ok(core.isInstitution(name, institution));
  for (const name of ['South China University of Technology', 'Shenzhen University', 'Fixture Unique', 'Sudan University of Science and Technology']) assert.equal(core.isInstitution(name, institution), false);
});

test('automation options are explicit booleans and default off', () => {
  assert.deepEqual(core.sanitizeSettings(), { autoSubmit: false, autoConsent: false, autoStart: false, browserOnly: false });
  assert.deepEqual(core.sanitizeSettings({ autoSubmit: 'true', autoConsent: 1, browserOnly: 'true', password: 'fake' }), { autoSubmit: false, autoConsent: false, autoStart: false, browserOnly: false });
  assert.deepEqual(core.sanitizeSettings({ autoSubmit: true, autoConsent: true, browserOnly: true }), { autoSubmit: true, autoConsent: true, autoStart: false, browserOnly: true });
});

test('local credential import accepts the existing file format and never echoes invalid contents', () => {
  assert.deepEqual(core.parseCredentialFile('fixture-user:fixture:password\n'), { username: 'fixture-user', password: 'fixture:password' });
  assert.deepEqual(core.parseCredentialFile('{"sid":"fixture-user","pwd":"fixture-password"}'), { username: 'fixture-user', password: 'fixture-password' });
  for (const input of ['fixture-sensitive-invalid', 'name:', '{"username":"fixture-sensitive-invalid"}', 'name:password\nextra']) {
    assert.throws(() => core.parseCredentialFile(input), error => !error.message.includes('fixture-sensitive-invalid'));
  }
});

test('authentication brokers and SAML callbacks are not final research-page returns', () => {
  for (const url of ['https://id.elsevier.com/as/authorization.oauth2', 'https://auth.elsevier.com/ShibAuth/institutionLogin',
    'https://sso.rsc.org/WAYF', 'https://fsso.cnki.net/secure/default.aspx', 'https://pubs.rsc.org/institutional-login',
    'https://pubs.acs.org/Shibboleth.sso/Login', 'https://www.tandfonline.com/action/ssostart',
    'https://www.webofknowledge.com/', 'https://www.webofscience.com/wos/static/html/login-splash/roaming.html']) assert.equal(core.isResearchPage(url), false, url);
  for (const url of ['https://www.scopus.com/pages/error', 'https://www.scopus.com/pages/checkAccess', 'https://www.scopus.com/shibboleth']) assert.equal(core.isResearchPage(url), false, url);
  for (const url of ['https://www.scopus.com/pages/home', 'https://pubs.rsc.org/', 'https://www.tandfonline.com/', 'https://www.cnki.net/']) assert.equal(core.isResearchPage(url), true, url);
  assert.equal(core.isResearchPage('https://pubs.rsc.org.evil.test/'), false);
});
