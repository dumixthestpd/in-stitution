const fs = require('node:fs');
const path = require('node:path');
const { release } = require('./release-projects.cjs');
const { readStoredZip, writeZip } = require('./zip.cjs');
const root = path.resolve(__dirname, '..');
async function setup(output = path.join(root, 'dist/setup')) {
  const projects = await release();
  const core = projects.find(project => project.project === 'in-stitution');
  const files = readStoredZip(path.join(core.directory, `in-stitution-${core.version}.zip`)).map(([name, data]) => ['in-stitution/' + name, data]);
  const packs = [];
  for (const project of projects.filter(project => project !== core)) {
    const name = `${project.project}-${project.version}.instpack`;
    files.push([name, fs.readFileSync(path.join(project.directory, name))]); packs.push(name);
  }
  files.push(['START-HERE.txt', Buffer.from(`in-stitution ${core.version} — fresh setup\n\n1. Extract this entire ZIP into a permanent folder.\n2. In chrome://extensions (or edge://extensions), enable Developer mode.\n   Click Load unpacked and select the in-stitution folder beside this file.\n3. Open the extension's Details and enable Allow User Scripts.\n4. Open in-stitution from the browser toolbar and click Install institution pack.\n   Drop one of the .instpack files listed below into the installer.\n5. Review the sites, install, and complete your institution's setup screen.\n   Then open a research page and use Continue with your institution.\n\nIncluded packs:\n${packs.map(name => '  ' + name).join('\n') || '  None — obtain a pack from your institution maintainer.'}\n\nTo remove an institution: Change institution → Remove institution.\nThe institution pack manager also has Remove institution on each saved card.\n\nFor a fresh test, disable the older in-stitution copy while testing this one.\nThis package includes no saved accounts, preferences, sessions or browser profile.\nKeep the extracted folder in place; unpacked extensions use its files.\n`)]);
  const directory = path.resolve(output, `in-stitution-${core.version}`);
  const archive = path.join(output, `in-stitution-setup-${core.version}.zip`);
  writeZip(files, archive);
  for (const [name, data] of files) {
    const destination = path.resolve(directory, name);
    if (!destination.startsWith(directory + path.sep)) throw new Error('Invalid setup path.');
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, data);
  }
  return { directory, archive };
}
if (require.main === module) void setup().then(result => console.log(JSON.stringify(result, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
module.exports = { setup };
