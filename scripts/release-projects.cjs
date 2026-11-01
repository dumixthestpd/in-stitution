const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeZip } = require('./zip.cjs');
const { build } = require('./build-institution.cjs');
const root = path.resolve(__dirname, '..');
const ignored = new Set(['dist', '.git', 'node_modules', '.browser-live', '.browser-test', '__pycache__']);
function entries(directory, prefix = '', core = false) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(item => {
    const file = path.join(directory, item.name);
    if (ignored.has(item.name) || item.isSymbolicLink() || /^\.env(?:\.|$)/i.test(item.name) || /^(?:credentials?|secrets?|session|cookies?)(?:[._-]|$)/i.test(item.name) || /\.(?:har|log|pyc|pem|key|p12|pfx)$/i.test(item.name)) return [];
    if (item.isDirectory()) {
      if (core && prefix === 'extension/institutions/') return [];
      return entries(file, prefix + item.name + '/', core);
    }
    return [[prefix + item.name, fs.readFileSync(file)]];
  });
}
async function release(output = path.join(root, 'dist/releases')) {
  const packaged = spawnSync(process.execPath, [path.join(root, 'scripts/package.cjs')], { cwd: root, stdio: 'pipe', windowsHide: true });
  if (packaged.status !== 0) throw new Error('Core package validation failed. Run npm run package for details.');
  const version = require('../package.json').version;
  const coreOutput = path.join(output, `in-stitution-${version}`);
  fs.mkdirSync(coreOutput, { recursive: true });
  const extension = `in-stitution-${version}.zip`;
  fs.copyFileSync(path.join(root, 'dist', extension), path.join(coreOutput, extension));
  const files = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE', 'package.json', '.gitignore'].map(name => [name, fs.readFileSync(path.join(root, name))]);
  for (const name of ['extension', 'scripts', 'tests', 'docs', 'mcp', 'examples']) files.push(...entries(path.join(root, name), name + '/', true));
  writeZip(files, path.join(coreOutput, `in-stitution-${version}-source.zip`));
  const outputs = [{ project: 'in-stitution', version, directory: coreOutput }];
  const institutions = path.join(root, 'extension/institutions');
  for (const item of fs.readdirSync(institutions, { withFileTypes: true })) {
    const project = path.join(institutions, item.name); const metadataFile = path.join(project, 'package.json');
    if (!item.isDirectory() || !fs.existsSync(metadataFile)) continue;
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    if (!metadata.institutionPack) continue;
    if (!/^[a-z][a-z0-9-]*$/.test(metadata.name) || metadata.institutionPack !== 'pack') throw new Error('Invalid institution project metadata.');
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'pack/manifest.json'), 'utf8'));
    if (manifest.version !== metadata.version) throw new Error('Institution project/pack versions differ.');
    const target = path.join(output, `${metadata.name}-${metadata.version}`);
    const built = await build(path.join(project, 'pack'), target);
    const named = path.join(target, `${metadata.name}-${metadata.version}.instpack`);
    if (built !== named) { fs.copyFileSync(built, named); fs.unlinkSync(built); }
    writeZip(entries(project), path.join(target, `${metadata.name}-${metadata.version}-source.zip`));
    outputs.push({ project: metadata.name, version: metadata.version, directory: target });
  }
  fs.writeFileSync(path.join(output, 'projects.json'), JSON.stringify(outputs.map(({ project, version, directory }) => ({ project, version, directory: path.relative(output, directory).replaceAll('\\', '/') })), null, 2) + '\n');
  return outputs;
}
if (require.main === module) void release().then(outputs => outputs.forEach(item => console.log(`${item.project} ${item.version}: ${item.directory}`)), error => { console.error(error.message); process.exitCode = 1; });
module.exports = { release, sourceEntries: entries };
