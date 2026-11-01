const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, pkg.version);
assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting', 'userScripts']);
assert.ok(!manifest.host_permissions);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
assert.equal(manifest.minimum_chrome_version, '135');
assert.ok(!manifest.externally_connectable);
for (const size of [16, 32, 48, 128]) {
  const name = manifest.icons?.[size];
  assert.equal(typeof name, 'string', `Missing ${size}px extension icon`);
  const bytes = fs.readFileSync(path.join(extension, name));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), size);
  assert.equal(bytes.readUInt32BE(20), size);
}
for (const size of [16, 32]) assert.equal(manifest.action.default_icon?.[size], manifest.icons[size]);
const scripts = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((item) => item.js), 'popup.js', 'pack-manager.js', 'pack-runtime.js', 'pack-frame.js', 'pack-archive.js', 'pack-settings.js', 'pack-settings-frame.js'];
assert.equal(manifest.options_ui.page, 'packs.html');
assert.equal(manifest.options_ui.open_in_tab, true);
const workerSource = fs.readFileSync(path.join(extension, manifest.background.service_worker), 'utf8');
for (const call of workerSource.matchAll(/importScripts\(([^)]+)\)/g)) {
  for (const file of call[1].matchAll(/"([^"]+)"/g)) scripts.push(file[1]);
}
for (const file of new Set(scripts)) new vm.Script(fs.readFileSync(path.join(extension, file), 'utf8'), { filename: file });
for (const file of fs.readdirSync(path.join(root, 'mcp')).filter(file => file.endsWith('.cjs'))) new vm.Script(fs.readFileSync(path.join(root, 'mcp', file), 'utf8'), { filename: `mcp/${file}` });
const html = fs.readFileSync(path.join(extension, manifest.action.default_popup), 'utf8');
for (const page of [html, fs.readFileSync(path.join(extension, manifest.options_ui.page), 'utf8')]) {
  for (const match of page.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(extension, match[1])), match[1]);
  assert.ok(!/<script[^>]*>\s*[^<\s]/.test(page), 'No inline extension-page scripts');
}
for (const item of manifest.content_scripts) {
  assert.ok(!item.all_frames, 'Only top-level pages');
  for (const pattern of item.matches) assert.match(pattern, /^https:\/\/(?:\*\.)?[a-z0-9.-]+\/\*$/);
}
const core = require('../extension/core.js');
const background = fs.readFileSync(path.join(extension, manifest.background.service_worker), 'utf8');
const bundle = require('../extension/institutions/catalog.js');
const projectPresets = fs.readdirSync(path.join(extension, 'institutions'), { withFileTypes: true }).filter(item => item.isDirectory()).flatMap(item => {
  const file = path.join(extension, 'institutions', item.name, 'pack/manifest.json');
  return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf8')).institution] : [];
});
for (const file of manifest.content_scripts[0].js.filter(file => file.startsWith('institutions/'))) {
  assert.ok(html.includes(`src="${file}"`), `Popup must load ${file}`);
  assert.ok(file === 'institutions/catalog.js' || bundle.scripts.includes(file), `Worker bundle must load ${file}`);
}
for (const file of fs.readdirSync(extension).filter(file => /\.(?:js|html|json)$/.test(file))) {
  // Composition references are allowed; institution behavior and domains are not.
  const source = fs.readFileSync(path.join(extension, file), 'utf8').replace(/institutions\/[a-z0-9-]+\/index\.js/g, 'institution-module');
  for (const preset of [...core.libraries().filter(library => library.preset).map(library => library.preset), ...projectPresets]) {
    for (const marker of [preset.id, preset.name, ...core.profileOrigins(preset).map(origin => new URL(origin).hostname)]) {
      assert.ok(!source.toLowerCase().includes(marker.toLowerCase()), `${file} contains institution-specific data: ${marker}`);
    }
  }
}
for (const provider of core.PROVIDERS) {
  for (const domain of provider.domains) {
    assert.ok(manifest.content_scripts.some((item) => item.matches.some((pattern) => {
      const host = pattern.slice(8, -2).replace(/^\*\./, '');
      return domain === host || (pattern.includes('*.') && domain.endsWith(`.${host}`));
    })), `Missing content script match for ${domain}`);
  }
}
const packs = require('../extension/packs.js');
let packCount = 0;
function checkPacks(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory() && !fs.existsSync(path.join(file, 'package.json'))) checkPacks(file);
    else if (item.name.endsWith('.institution.json')) { packs.parse(fs.readFileSync(file, 'utf8')); packCount++; }
  }
}
checkPacks(path.join(extension, 'institutions'));
console.log(`Manifest, ${new Set(scripts).size} JavaScript files, ${packCount} institution packs, extension-page assets, and ${core.PROVIDERS.length} provider families checked.`);
