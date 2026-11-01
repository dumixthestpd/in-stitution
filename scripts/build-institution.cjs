const fs = require('node:fs');
const path = require('node:path');
const packs = require('../extension/packs.js');
const archive = require('../extension/pack-archive.js');

async function build(directory, outputDirectory) {
  const root = fs.realpathSync(directory);
  const manifestFile = path.join(root, 'manifest.json');
  if (fs.lstatSync(manifestFile).isSymbolicLink() || fs.statSync(manifestFile).size > 65536) throw new Error('Use a local institution manifest smaller than 64 KB.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.formatVersion !== 2 || !Array.isArray(manifest.adapter?.scripts) || manifest.adapter.scripts.length > 8 || !Array.isArray(manifest.adapter.resources ?? []) || (manifest.adapter.resources || []).length > 8) throw new Error('Choose an executable institution pack source folder.');
  const files = {};
  for (const name of [...manifest.adapter.scripts, ...(manifest.adapter.resources || []), ...['README.md', 'LICENSE'].filter(name => fs.existsSync(path.join(root, name)))]) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) || name.split('/').some(part => part === '.' || part === '..') || /(?:^|\/)(?:credentials?|secrets?|tokens?)(?:[._-]|$)/i.test(name)) throw new Error('Declare safe local adapter files; credentials do not belong in a pack.');
    const file = path.join(root, name);
    const real = fs.realpathSync(file);
    if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile() || fs.statSync(real).size > 262144) throw new Error('Pack files must stay inside the source folder and be smaller than 256 KB.');
    files[name] = fs.readFileSync(real, 'utf8');
  }
  const { digest, ...adapter } = manifest.adapter;
  const pack = await packs.prepare({ ...manifest, adapter, files });
  const output = path.join(outputDirectory, `${pack.id}-${pack.version}.instpack`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(output, archive.write(pack));
  return output;
}
if (require.main === module) {
  const directory = process.argv[2];
  if (!directory || directory === '--help') console.log('npm run institution:build -- path/to/institution-pack');
  else void build(path.resolve(directory), path.resolve(__dirname, '../dist/institutions')).then(file => console.log(file), () => { console.error('Institution pack build failed. Check its manifest, declared local files and adapter format.'); process.exitCode = 1; });
}
module.exports = { build };
