const test = require('node:test');
const assert = require('node:assert/strict');
const packs = require('../extension/packs.js');
const profile = require('./fixtures/institution.cjs');
const source = () => packs.fromProfile(profile, { version: '1.2.0', maintainer: 'Fixture maintainer', description: 'Test institution settings' });

test('institution packs round-trip public settings and preserve exact credential boundaries', () => {
  const pack = source();
  assert.deepEqual(packs.parse('\uFEFF' + JSON.stringify(pack)), pack);
  assert.equal(pack.institution.cas.loginUrl, profile.cas.loginUrl);
  assert.deepEqual(pack.institution.identityOrigins, profile.identityOrigins);
  assert.equal(pack.maintainer, 'Fixture maintainer');
});

test('pack fields cannot carry scripts, credentials, automation or executable rules', () => {
  for (const extra of [{ scripts: ['alert(1)'] }, { password: 'private-fixture' }, { settings: { autoSubmit: true } }, { rules: [{ action: 'submit' }] }]) {
    assert.throws(() => packs.normalize({ ...source(), ...extra }), /unsupported fields/);
  }
  for (const extra of [{ password: 'private-fixture' }, { autoStart: true }, { script: 'alert(1)' }]) {
    assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, ...extra } }), /unsupported fields/);
  }
  assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, cas: { ...profile.cas, script: 'alert(1)' } } }), /unsupported fields/);
  assert.throws(() => packs.parse(JSON.stringify(source()).replace('"format":', '"__proto__":{},"format":')), /unsupported fields/);
});

test('unknown engines and formats fail clearly without attempting code installation', () => {
  assert.throws(() => packs.normalize({ ...source(), formatVersion: 99 }), /format is not supported/);
  assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, library: 'not-bundled' } }), /login engine not included/);
  assert.throws(() => packs.normalize({ ...source(), id: 'different' }), /IDs must match/);
  assert.throws(() => packs.normalize({ ...source(), version: 'latest' }), /version/);
});

test('invalid, oversized and unsafe institution settings do not expose file contents in errors', () => {
  assert.throws(() => packs.parse('private-fixture'), error => !error.message.includes('private-fixture'));
  assert.throws(() => packs.parse(' '.repeat(65537)), /smaller than 64 KB/);
  assert.throws(() => packs.normalize({ ...source(), description: '字'.repeat(65536) }), /smaller than 64 KB/);
  assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, identityOrigins: ['http://login.example.edu'] } }), /HTTPS/);
  for (const origin of ['https://*.example.edu', 'https://*']) {
    assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, identityOrigins: [origin] } }), /exact HTTPS origins/);
  }
  assert.throws(() => packs.normalize({ ...source(), institution: { ...profile, cas: { ...profile.cas, servicePrefixes: ['https://idp.fixture.edu/not-a-prefix'] } } }), /ending in/);
});
