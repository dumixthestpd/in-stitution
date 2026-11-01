const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = path.resolve(__dirname, '../extension/institutions');
for (const name of fs.readdirSync(directory)) {
  const project = path.join(directory, name);
  const metadata = path.join(project, 'package.json');
  if (!fs.existsSync(metadata) || !JSON.parse(fs.readFileSync(metadata)).institutionPack) continue;
  const result = spawnSync(process.execPath, ['--test', ...fs.readdirSync(project).filter(file => file.endsWith('.test.cjs'))], { cwd: project, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
