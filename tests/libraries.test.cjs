const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');
const institution = require('./fixtures/institution.cjs');
require('../examples/example-university.js');

const standard = () => core.normalizeProfile({ id: 'other', library: 'standard-cas', name: 'Other University', shortName: 'Other U', aliases: ['另一所大学'],
  identityOrigins: ['https://sso.other.edu'], cas: { loginUrl: 'https://auth.other.edu/sso/signin', servicePrefixes: ['https://sso.other.edu/federation/'] } });

test('each institution chooses a library with its own route classification', () => {
  const profile = core.normalizeProfile(core.libraries().find(item => item.id === 'example-university').preset);
  assert.equal(core.pageKind('https://login.example.edu/portal/start', profile), 'login');
  assert.equal(core.pageKind('https://login.example.edu/oidc/authorize', profile), 'identity');
  assert.equal(core.pageKind('https://login.example.edu/cas/login', profile), null);
  assert.equal(core.isCredentialPage('https://login.example.edu/portal/start', profile), false);
  assert.equal(core.pageKind('https://cas.fixture.edu/cas/login', profile), null);
});

test('standard CAS is an explicit reusable library and supports different URL paths', () => {
  const profile = standard();
  const url = 'https://auth.other.edu/sso/signin?service=' + encodeURIComponent('https://sso.other.edu/federation/return');
  assert.equal(core.pageKind(url, profile), 'login');
  assert.ok(core.isCredentialPage(url, profile));
  assert.equal(core.isCredentialPage(url, institution), false);
  assert.equal(core.isCredentialPage(url.replace('sso.other.edu%2F', 'sso.other.edu.evil.test%2F'), profile), false);
  assert.ok(core.isInstitution('另一所大学', profile));
  assert.equal(core.isInstitution('Fixture U', profile), false);
});

test('profiles are declarative, reject unavailable libraries, and never export passwords', () => {
  assert.throws(() => core.normalizeProfile({ id: 'new', name: 'New University', library: 'missing' }), /not bundled/);
  const profile = core.normalizeProfile({ id: 'new', name: 'New University', password: 'fixture-only', script: 'alert(1)' });
  assert.equal(profile.library, 'manual');
  assert.equal(JSON.stringify(profile).includes('fixture-only'), false);
  assert.deepEqual(core.optionalOrigins(profile), []);
  assert.equal(core.libraryFor(profile).supportsCredentials, false);
});

test('profile snapshots and credential bindings survive institution switching safely', () => {
  const profile = standard();
  const flow = core.createFlow('https://pubs.rsc.org/', 1000, 'snapshot', profile);
  profile.aliases.push('Later edit');
  assert.equal(flow.profile.aliases.includes('Later edit'), false);
  assert.notEqual(core.credentialScope(flow.profile), core.credentialScope(institution));
  assert.notEqual(core.credentialScope(flow.profile), core.credentialScope({ ...flow.profile, library: 'manual' }));
  assert.deepEqual(core.optionalOrigins(flow.profile).sort(), ['https://auth.other.edu/*', 'https://sso.other.edu/*']);
});
