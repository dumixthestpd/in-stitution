// Create a local institution library. No downloaded code or guessed login flow.
const fs = require('node:fs');
const path = require('node:path');

function createInstitution(root, { id, name, origin, dryRun = false }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error('Use a lowercase institution ID, up to 48 letters, numbers and hyphens.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 240) throw new Error('Supply an institution name of 1–240 characters.');
  let login;
  try { login = new URL(origin); } catch { throw new Error('Supply a verified HTTPS login origin, such as https://login.example.edu.'); }
  if (login.protocol !== 'https:' || login.username || login.password || login.port || login.pathname !== '/' || login.search || login.hash) throw new Error('Login origin must be an exact HTTPS origin without a path, credentials or query.');
  const directory = path.join(root, 'extension', 'institutions', id);
  if (fs.existsSync(directory) || fs.existsSync(directory + '.js')) throw new Error('That institution ID already exists. Existing libraries are never overwritten.');
  const catalogFile = path.join(root, 'extension/institutions/catalog.js');
  const manifestFile = path.join(root, 'extension/manifest.json');
  const popupFile = path.join(root, 'extension/popup.html');
  const catalog = fs.readFileSync(catalogFile, 'utf8');
  const match = catalog.match(/const modules = (\[[\s\S]*?\]);/);
  if (!match) throw new Error('Cannot locate the bundle catalog. No files changed.');
  const modules = JSON.parse(match[1]);
  if (!Array.isArray(modules) || modules.some(item => typeof item !== 'string') || modules.includes(`${id}/index.js`)) throw new Error('Invalid or duplicate bundle entry. No files changed.');
  const script = `institutions/${id}/index.js`;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const groups = manifest.content_scripts.filter(item => item.js?.includes('institutions/catalog.js'));
  if (!groups.length || groups.some(item => !item.js.includes('core.js') || item.js.includes(script))) throw new Error('Cannot safely update manifest composition. No files changed.');
  for (const group of groups) group.js.splice(group.js.indexOf('institutions/catalog.js'), 0, script);
  const popup = fs.readFileSync(popupFile, 'utf8');
  const anchor = '  <script src="institutions/catalog.js" defer></script>';
  if (popup.split(anchor).length !== 2 || popup.includes(`src="${script}"`)) throw new Error('Cannot safely update popup composition. No files changed.');
  const profile = { id, library: id, name: name.trim(), shortName: name.trim(), aliases: [], searchTerm: name.trim(),
    carsiSearchTerm: name.trim(), federation: '', entityId: '', identityOrigins: [login.origin], discoveryOrigins: [], cas: null };
  const quote = JSON.stringify;
  const index = `/* Institution-owned authentication. Implement only verified steps here. */
/* global InstitutionLibraries */
InstitutionLibraries.register({
  id: ${quote(id)}, name: ${quote(name.trim())}, supportsCredentials: false,
  preset: ${JSON.stringify(profile, null, 2).replace(/\n/g, '\n  ')},
  validate(profile) {
    if (!profile.identityOrigins.includes(${quote(login.origin)})) throw new Error("The institution login origin is required.");
  },
  classify(url) {
    // Refine this to verified paths when implementing automatic steps.
    return url.origin === ${quote(login.origin)} ? "identity" : null;
  },
  credentialsAllowed() { return false; },
  async login(ctx) {
    await ctx.phase("manual", "Complete your institution's normal sign-in and verification on this page.");
  },
  async identity(ctx) { await this.login(ctx); }
});
`;
  const tests = `const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../core.js');
const library = core.libraryFor({ library: ${quote(id)} });

test(${quote(id + ' classifies its own origin without releasing credentials')}, () => {
  const profile = core.normalizeProfile(library.preset);
  assert.equal(core.pageKind(${quote(login.origin + '/login')}, profile), 'identity');
  assert.equal(core.pageKind(${quote(login.origin + '.invalid/login')}, profile), null);
  assert.equal(core.isCredentialPage(${quote(login.origin + '/login')}, profile), false);
  assert.equal(library.supportsCredentials, false);
  assert.throws(() => core.normalizeProfile({ ...profile, identityOrigins: [] }), /origin/);
});

// Add real path/choice/consent tests and Chromium fixtures before automation.
// These starter checks do not establish live institution support.
`;
  const readme = `# ${name.trim().replace(/[\r\n]/g, ' ')} institution library

Status: starter; manual authentication only. No live support claimed.

- Maintainer: add a public handle or contact.
- Login origin: ${login.origin}
- Authentication: document the verified protocol and page sequence.
- Account/password/MFA steps: use the institution's native flow until implemented.
- Institution rules: document permitted automation and required user steps.

## Implement and verify

Keep this institution's routes, aliases, consent rules, tests and account evidence
in this directory. Shared publisher fixes belong in shared provider adapters.
Use the library hooks in index.js; CAS is optional. Credentials default disabled.
Add every required origin to the profile and grant only verified hosts.

Run npm test, npm run check and npm run test:browser from the repository root.
Add fake-account browser fixtures; never commit real accounts or raw auth traces.

| Provider | On-campus result | Off-campus result | Verified date |
| --- | --- | --- | --- |
| Add tested providers | Not checked | Not checked | — |

Record fresh-session results, MFA/manual boundaries and unsupported providers.
On-campus IP access alone does not verify remote authentication.
[Contributor instructions](../../../CONTRIBUTING.md)

The generated institution.institution.json is an installable settings pack for a
build containing this library. To support a new engine, submit the reviewed code
with the extension; dropping a pack never installs executable JavaScript.
`;
  const pack = { format: 'in-stitution/institution-pack', formatVersion: 1, id, version: '1.0.0',
    maintainer: 'Replace with your maintainer name', description: 'Starter configuration; manual login only. Live support has not been verified.', institution: profile };
  const writes = [
    [path.join(directory, 'index.js'), index], [path.join(directory, 'library.test.cjs'), tests], [path.join(directory, 'README.md'), readme],
    [path.join(directory, 'institution.institution.json'), JSON.stringify(pack, null, 2) + '\n'],
    [catalogFile, catalog.replace(match[0], `const modules = ${JSON.stringify([...modules, `${id}/index.js`])};`)],
    [manifestFile, JSON.stringify(manifest, null, 2) + '\n'],
    [popupFile, popup.replace(anchor, `  <script src="${script}" defer></script>\n${anchor}`)]
  ];
  const files = writes.map(([file]) => path.relative(root, file).replaceAll('\\', '/'));
  if (dryRun) return files;
  fs.mkdirSync(directory);
  for (const [file, contents] of writes) fs.writeFileSync(file, contents, { flag: file.startsWith(directory + path.sep) ? 'wx' : 'w' });
  return files;
}

function createSourcePack(root, { id, name, origin, dryRun = false }) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(id) || typeof name !== 'string' || !name.trim() || name.length > 240) throw new Error('Supply a valid institution ID and name.');
  let url;
  try { url = new URL(origin); } catch { throw new Error('Supply a verified HTTPS institution origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname.includes('*') || url.pathname !== '/' || url.search || url.hash) throw new Error('Use one exact HTTPS origin.');
  const directory = path.join(root, 'extension/institutions', id);
  if (fs.existsSync(directory) || fs.existsSync(directory + '.js')) throw new Error('That institution ID already exists. Existing files are never overwritten.');
  const manifest = { format: 'in-stitution/institution-pack', formatVersion: 2, id, version: '1.0.0', maintainer: 'Replace with your maintainer name',
    description: 'Starter adapter; live sign-in has not been verified.', institution: { id, library: 'executable-pack', name: name.trim(), shortName: name.trim(), identityOrigins: [url.origin], cas: null },
    adapter: { apiVersion: 2, scripts: ['adapter.js'], resources: ['settings.html', 'settings.js'], settings: { html: 'settings.html', scripts: ['settings.js'], styles: [] }, networkOrigins: [] } };
  const code = `/* Implement this institution's verified flow; no CAS assumption. */
InstitutionPack.register(async (ctx) => {
  // ctx.config is whatever your setup screen returns. Use ctx.storage for state.
  // Use ctx.page.run(fn, ...args) to call this institution's page JavaScript.
  // Use ctx.click(key, element), ctx.navigate(key, url), ctx.resources,
  // ctx.notice(text) and ctx.complete(). Check ctx.current()/ctx.signal
  // around asynchronous work and respect required user confirmation/MFA.
  await ctx.notice("Complete your institution's normal sign-in and verification.");
});
`;
  const readme = `# ${name.trim().replace(/[\r\n]/g, ' ')} executable institution pack

Status: starter. Maintainer: replace this with your public maintainer details.
Before coding, find your institution’s maintained SSO/login stack, campus
developer projects and library access documentation. Verify reuse rights and
retain attribution. Read the Institution Pack Developer Guide in the framework
checkout, then implement and verify this institution’s actual flow.
Implement the verified login flow in adapter.js and declare exact sites in
manifest.json. This is an independent pack, not a bundled core library.

Build from the repository root:

    npm run institution:build -- extension/institutions/${id}/pack

Drop the generated .instpack file into Institution packs. Chrome 135+ and
Allow User Scripts are required. No core rebuild or catalog registration.
Replace settings.html/settings.js with your own setup screen and return any JSON
configuration; it becomes ctx.config. Your pack owns its login protocol and
completion. Use background APIs, page functions and persistent state as needed.
The legacy vault stays separate. Keep private settings and credentials out of code.

Record protocols, institution rules, tested providers, manual steps, dates and
on-campus/off-campus results here. A starter test is not live verification.
SDK and trust boundaries: ../../../../docs/institution-packs.md
`;
  const testSource = `const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packs = require('../../packs.js');
test(${JSON.stringify(id + ' executable source pack prepares independently')}, async () => {
  const directory = path.join(__dirname, 'pack');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  const files = Object.fromEntries([...manifest.adapter.scripts, ...(manifest.adapter.resources || [])].map(name => [name, fs.readFileSync(path.join(directory, name), 'utf8')]));
  const pack = await packs.prepare({ ...manifest, files });
  assert.equal(pack.institution.library, 'executable-pack');
  assert.match(pack.adapter.digest, /^[a-f0-9]{64}$/);
});
`;
  const files = [[path.join(directory, 'pack/manifest.json'), JSON.stringify(manifest, null, 2) + '\n'], [path.join(directory, 'pack/adapter.js'), code],
    [path.join(directory, 'pack/settings.html'), '<label>Institution configuration (JSON)<textarea id="config" rows="12" style="width:95%"></textarea></label>\n'],
    [path.join(directory, 'pack/settings.js'), 'InstitutionPackSettings.register({ load(config) { document.querySelector("#config").value = JSON.stringify(config, null, 2); }, save() { return JSON.parse(document.querySelector("#config").value); } });\n'],
    [path.join(directory, 'pack/README.md'), readme], [path.join(directory, 'pack.test.cjs'), testSource]];
  if (!dryRun) { fs.mkdirSync(path.join(directory, 'pack'), { recursive: true }); for (const [file, source] of files) fs.writeFileSync(file, source, { flag: 'wx' }); }
  return files.map(([file]) => path.relative(root, file).replaceAll('\\', '/'));
}

if (require.main === module) {
  try {
    const options = {};
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help')) {
      console.log('npm run institution:new -- --id my-u --name "My University" --origin https://login.example.edu [--dry-run] [--bundled]');
    } else {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dry-run') { options.dryRun = true; continue; }
        if (args[i] === '--bundled') { options.bundled = true; continue; }
        if (!['--id', '--name', '--origin'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected --id, --name and --origin. Use --help for an example.');
        const key = args[i].slice(2);
        options[key] = args[++i];
      }
      const files = (options.bundled ? createInstitution : createSourcePack)(path.resolve(__dirname, '..'), options);
      console.log((options.dryRun ? 'Would create/update:' : options.bundled ? 'Created bundled institution library:' : 'Created independent executable institution source pack:') + '\n' + files.join('\n'));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { createInstitution, createSourcePack };
