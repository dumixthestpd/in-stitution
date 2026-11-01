const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { release, sourceEntries } = require('../scripts/release-projects.cjs');
const archive = require('../extension/pack-archive.js');

function contents(file) {
  const data = fs.readFileSync(file); const files = new Map(); let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0);
    const size = data.readUInt32LE(offset + 18); const nameSize = data.readUInt16LE(offset + 26); const extra = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameSize).toString();
    const start = offset + 30 + nameSize + extra;
    files.set(name, data.subarray(start, start + size)); offset = start + size;
  }
  return files;
}

test('source exports exclude private environment, session, account and key material recursively', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-release-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('institution-release-')); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const file of ['README.md', '.env', '.env.local', 'credentials.txt', 'cookies.json', 'session.json', 'private.key', 'test.pem', 'nested/.env.production', 'nested/adapter.js']) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), 'public fake fixture only');
  }
  assert.deepEqual(sourceEntries(directory).map(([name]) => name), ['nested/adapter.js', 'README.md']);
});
test('core and institution releases have independent sources, versions and runtime artifacts', async t => {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'institution-release-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('institution-release-')); fs.rmSync(directory, { recursive: true, force: true }); });
  const outputs = await release(path.join(directory, 'releases'));
  const metadata = require('../package.json');
  const coreOutput = outputs.find(item => item.project === metadata.name);
  const runtime = contents(path.join(coreOutput.directory, `${metadata.name}-${metadata.version}.zip`));
  const source = contents(path.join(coreOutput.directory, `${metadata.name}-${metadata.version}-source.zip`));
  assert.equal(JSON.parse(runtime.get('manifest.json')).version, metadata.version);
  for (const name of runtime.keys()) assert.doesNotMatch(name, /^institutions\/[^/]+\//);
  for (const name of source.keys()) assert.doesNotMatch(name, /^extension\/institutions\/[^/]+\//);
  for (const project of outputs.filter(item => item.project !== metadata.name)) {
    const pack = await archive.read(fs.readFileSync(path.join(project.directory, `${project.project}-${project.version}.instpack`)));
    assert.equal(pack.version, project.version);
    assert.equal(pack.institution.library, 'executable-pack');
    const independent = contents(path.join(project.directory, `${project.project}-${project.version}-source.zip`));
    assert.equal(JSON.parse(independent.get('package.json')).name, project.project);
    for (const name of independent.keys()) assert.doesNotMatch(name, /(?:^|\/)(?:dist|credentials|\.git|node_modules)(?:\/|\.|$)/);
    const extracted = path.join(directory, project.project); fs.mkdirSync(extracted);
    for (const [name, data] of independent) {
      const target = path.resolve(extracted, name); assert.ok(target.startsWith(extracted + path.sep)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
    }
    const result = spawnSync(process.execPath, ['--test', ...fs.readdirSync(extracted).filter(name => name.endsWith('.test.cjs'))], { cwd: extracted, env: { ...process.env, INSTITUTION_FRAMEWORK: root }, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
