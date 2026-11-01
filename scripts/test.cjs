const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function tests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    if (item.isDirectory() && fs.existsSync(path.join(file, 'package.json'))) return [];
    return item.isDirectory() ? tests(file) : item.name.endsWith('.test.cjs') ? [file] : [];
  });
}
const result = spawnSync(process.execPath, ['--test', ...tests(path.join(root, 'tests')), ...tests(path.join(root, 'extension/institutions'))], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
