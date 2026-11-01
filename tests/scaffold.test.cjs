const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createInstitution, createSourcePack } = require('../scripts/new-institution.cjs');

const repository = path.resolve(__dirname, '..');
const options = { id: 'contributor-u', name: 'Contributor University', origin: 'https://login.contributor.example' };
const composition = ['extension/institutions/catalog.js', 'extension/manifest.json', 'extension/popup.html'];
function fixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'in-stitution-scaffold-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('in-stitution-scaffold-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const directory of ['extension', 'mcp']) fs.cpSync(path.join(repository, directory), path.join(root, directory), { recursive: true });
  fs.copyFileSync(path.join(repository, 'package.json'), path.join(root, 'package.json'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(repository, 'scripts/check.cjs'), path.join(root, 'scripts/check.cjs'));
  return root;
}
const snapshot = root => composition.map(file => fs.readFileSync(path.join(root, file), 'utf8'));

test('institution starter registers across worker, popup and content scripts and runs its own tests', t => {
  const root = fixture(t);
  const files = createInstitution(root, options);
  assert.equal(files.length, 7);
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'extension/institutions/contributor-u/institution.institution.json')));
  assert.equal(pack.format, 'in-stitution/institution-pack');
  assert.equal(pack.institution.library, options.id);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json')));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('institutions/contributor-u/index.js') < scripts.indexOf('core.js'));
  assert.equal(manifest.content_scripts[0].matches.some(host => host.includes('contributor.example')), false);
  assert.ok(fs.readFileSync(path.join(root, 'extension/popup.html'), 'utf8').includes('src="institutions/contributor-u/index.js"'));
  const contract = spawnSync(process.execPath, ['--test', 'extension/institutions/contributor-u/library.test.cjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(contract.status, 0, contract.stdout + contract.stderr);
  const check = spawnSync(process.execPath, ['scripts/check.cjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const library = fs.readFileSync(path.join(root, 'extension/institutions/contributor-u/index.js'), 'utf8');
  assert.match(library, /supportsCredentials: false/);
  assert.match(library, /credentialsAllowed\(\) \{ return false; \}/);
});

test('starter dry run previews composition without creating or modifying files', t => {
  const root = fixture(t);
  const before = snapshot(root);
  assert.equal(createInstitution(root, { ...options, dryRun: true }).length, 7);
  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, 'extension/institutions/contributor-u')), false);
});

test('starter rejects unsafe inputs and duplicate IDs without modifying existing libraries', t => {
  const root = fixture(t);
  const before = snapshot(root);
  for (const id of ['../escape', 'Uppercase', 'manual']) assert.throws(() => createInstitution(root, { ...options, id }));
  for (const origin of ['http://login.example.edu', 'https://login.example.edu/form', 'https://user:password@login.example.edu', 'https://login.example.edu/?redirect=evil', 'https://login.example.edu:8443']) {
    assert.throws(() => createInstitution(root, { ...options, origin }));
  }
  assert.deepEqual(snapshot(root), before);
  const files = createInstitution(root, options);
  const created = files.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  assert.throws(() => createInstitution(root, options), /already exists/);
  assert.deepEqual(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')), created);
});

test('starter checks all composition points before writing an institution', t => {
  const root = fixture(t);
  const popupFile = path.join(root, 'extension/popup.html');
  fs.writeFileSync(popupFile, fs.readFileSync(popupFile, 'utf8').replace('  <script src="institutions/catalog.js" defer></script>', ''));
  const before = snapshot(root);
  assert.throws(() => createInstitution(root, options), /popup composition/);
  assert.deepEqual(snapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, 'extension/institutions/contributor-u')), false);
});

test('independent executable scaffolding leaves core composition untouched and runs its own contract', t => {
  const root = fixture(t);
  const before = snapshot(root);
  assert.equal(createSourcePack(root, { ...options, dryRun: true }).length, 6);
  assert.deepEqual(snapshot(root), before);
  createSourcePack(root, options);
  assert.deepEqual(snapshot(root), before);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/institutions/contributor-u/pack/manifest.json')));
  assert.equal(manifest.institution.library, 'executable-pack');
  const contract = spawnSync(process.execPath, ['--test', 'extension/institutions/contributor-u/pack.test.cjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(contract.status, 0, contract.stdout + contract.stderr);
  assert.throws(() => createSourcePack(root, options), /already exists/);
});
