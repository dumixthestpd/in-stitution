// Real Chromium DOM tests using CDP pipes; no npm packages or live accounts.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const https = require('node:https');
const { createHash, X509Certificate } = require('node:crypto');
const loopbackTls = require('../tests/fixtures/localhost-tls.cjs');
const loopbackSpki = createHash('sha256').update(new X509Certificate(loopbackTls.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'extension');
const bundle = require('../extension/institutions/catalog.js');
const coreModule = require('../extension/core.js');
const fixtureInstitution = require('../tests/fixtures/institution.cjs');
const core = [...bundle.scripts, 'core.js', 'integrations/reference-managers.js'].map(file=>fs.readFileSync(path.join(extension,file),'utf8')).join('\n');
const content = fs.readFileSync(path.join(extension, 'content.js'), 'utf8');
const browserPath = process.env.BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((file) => fs.existsSync(file));
if (!browserPath) throw new Error('Set BROWSER_PATH to a Chromium, Chrome, or Edge executable.');

const profile = path.join(root, '.browser-test', `run-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
// Grant only fixture university origins in this temporary build. Production
// grants remain optional and are checked by scripts/check.cjs.
const fixtureExtension = path.join(profile, 'extension');
fs.cpSync(extension, fixtureExtension, { recursive: true });
const fixtureManifest = JSON.parse(fs.readFileSync(path.join(fixtureExtension, 'manifest.json'), 'utf8'));
fixtureManifest.content_scripts[0].matches.push(...coreModule.profileOrigins(fixtureInstitution).map(origin => origin + '/*'));
fixtureManifest.host_permissions = coreModule.profileOrigins(fixtureInstitution).map(origin => origin + '/*');
fixtureManifest.host_permissions.push('https://login.example.edu/*');
fixtureManifest.host_permissions.push('https://api.example.edu/*');
fixtureManifest.host_permissions.push('https://pubs.rsc.org/*');
fixtureManifest.host_permissions.push('https://127.0.0.1/*');
fs.writeFileSync(path.join(fixtureExtension, 'manifest.json'), JSON.stringify(fixtureManifest));
const flags = ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server',
  '--disable-component-update', '--disable-sync', '--disable-gpu', '--disable-software-rasterizer',
  '--in-process-gpu', '--enable-unsafe-extension-debugging', '--remote-debugging-pipe', `--ignore-certificate-errors-spki-list=${loopbackSpki}`, `--user-data-dir=${profile}`, 'about:blank'];
if (process.argv.includes('--no-sandbox')) flags.unshift('--no-sandbox');
const browser = spawn(browserPath, flags, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
let stderr = '';
browser.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-3000); });
let nextId = 0;
let buffer = '';
const waiting = new Map();
const handlers = new Map();
browser.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const packet = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!packet) continue;
    const message = JSON.parse(packet);
    if (message.id) {
      const pending = waiting.get(message.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    } else handlers.get(`${message.sessionId}:${message.method}`)?.(message.params);
  }
});
browser.on('error', (error) => {
  for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(error); }
  waiting.clear();
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timed out: ${method}. ${stderr}`)); }, 10000);
    waiting.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(session, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(session, expression, description) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    try { if (await evaluate(session, expression)) return; } catch {}
    await delay(100);
  }
  const diagnostic = await evaluate(session, 'JSON.stringify({url:location.href,buttons:[...document.querySelectorAll("button,a,mat-option")].map(e=>({text:e.textContent,hidden:e.hidden,disabled:e.disabled})),messages:window.fixture?.messages,error:window.__institutionLastError,helper:window.__institutionStatus?.(),selected:window.selected,expand:typeof expand})').catch(() => 'Page unavailable');
  throw new Error(`Browser assertion timed out: ${description}. ${diagnostic}`);
}


const casUrl = 'https://cas.fixture.edu/cas/login?service=' + encodeURIComponent('https://idp.fixture.edu/idp/Authn/External');
const casHtml = (extra = '', action = '/cas/login', method = 'post') => `<form id="fm1" action="${action}" method="${method}"><input name="username"><input name="password" type="password">${extra}<button type="submit">登录</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}</script>`;
const carsiHtml = `<button id="all" onclick="expand()">全部</button><input id="show" placeholder="请输入高校/机构名称"><ul id="schools">${'<li onclick="void selectidp">Other University</li>'.repeat(32)}</ul><button onclick="if(window.selected)location.href=${JSON.stringify(casUrl).replaceAll('"', '&quot;')}">登录</button><script>function selectidp(){window.selected=true;document.querySelector('#show').value='示例大学'}function expand(){document.querySelector('#schools').innerHTML='<li onclick="selectidp()">示例大学</li>'+ '<li onclick="void selectidp">Other University</li>'.repeat(200)}</script>`;

function bridge(options = {}) {
  return `
  window.fixture={active:true,messages:[],submissions:0};
  const listeners=[];
  window.chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async message=>{
    fixture.messages.push(message.type);
    if(message.type==='page:state')return {ok:true,active:fixture.active,flow:{id:'fixture',profile:${JSON.stringify(options.institution || fixtureInstitution)},expiresAt:Date.now()+600000},settings:${JSON.stringify({ autoSubmit: false, autoConsent: false, ...options })}};
    if(message.type==='page:stop'){fixture.active=false;return {ok:true,active:false}};
    if(message.type==='auth:credentials')return {ok:true,credentials:{username:'fixture-user',password:'fixture-only-password'}};
    if(message.type==='auth:submit')return {ok:true,allowed:fixture.submissions++===0};
    return {ok:true,active:fixture.active};
  }}};
  window.stopFixture=()=>{fixture.active=false;listeners.forEach(fn=>fn({type:'flow:stop'}, {}, ()=>{}))};
  `;
}

async function page(url, routes, options = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  handlers.set(`${sessionId}:Fetch.requestPaused`, (request) => {
    const resource = routes[request.request.url] ?? routes[new URL(request.request.url).pathname];
    const task = resource === undefined
      ? send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' }, sessionId)
      : send('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: typeof resource === 'object' ? resource.type : 'text/html; charset=utf-8' }],
        body: Buffer.from(typeof resource === 'object' ? resource.body : `<!doctype html><meta charset="utf-8">${resource}`).toString('base64') }, sessionId);
    void task.catch(() => {});
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
  if (options.realExtension) {
    handlers.set(`${sessionId}:Runtime.exceptionThrown`, event => console.error('Fixture page exception: ' + (event.exceptionDetails.exception?.description || event.exceptionDetails.text)));
    await send('Runtime.enable', {}, sessionId);
  }
  if (!options.realExtension) {
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: core + '\n' + (options.librarySource || '') + '\n' + bridge(options) + '\ndocument.addEventListener("DOMContentLoaded",()=>{\n' + content + '\n});'
    }, sessionId);
  }
  if (options.beforeNavigate) await options.beforeNavigate();
  await send('Page.navigate', { url }, sessionId);
  return { session: sessionId, close: () => send('Target.closeTarget', { targetId }) };
}

async function main() {
  const version = await send('Browser.getVersion');
  console.log(`Browser: ${version.product}`);
  let passed = 0;
  async function run(name, fn) {
    if (process.argv.includes('--pack-only') && !/unpacked extension|institution packs/.test(name)) return;
    if (process.argv.includes('--actual-only') && !/actual|unpacked|compatibility/.test(name)) return;
    await fn(); passed++; console.log(`PASS ${name}`);
  }
  await run('publisher menu → CARSI full list → separate Login → CAS autofill', async () => {
    const p = await page('https://pubs.rsc.org/article/fixture', {
      '/article/fixture': '<button onclick="document.querySelector(\'#menu\').hidden=false">Log in</button><div id="menu" hidden><a href="https://ds.carsi.edu.cn/login/index.html">Log in via your home institution</a></div>',
      'https://ds.carsi.edu.cn/login/index.html': carsiHtml,
      [casUrl]: casHtml()
    });
    await until(p.session, `location.hostname==='cas.fixture.edu' && document.querySelector('[name=password]')?.value==='fixture-only-password'`, 'full discovery chain reaches CAS');
    assert.equal(await evaluate(p.session, 'window.submits'), 0);
    await p.close();
  });
  await run('Clarivate Material federation selector enables Go to institution', async () => {
    const p = await page('https://access.clarivate.com/login', {
      '/login': `<mat-select formcontrolname="federationName" onclick="document.querySelector('mat-option').hidden=false" style="display:block;padding:12px">Institution</mat-select><mat-option hidden role="option" onclick="document.querySelector('#go').disabled=false">CHINA CERNET Federation</mat-option><button id="go" disabled onclick="window.chosen=true">Go to institution</button>`
    });
    await until(p.session, 'window.chosen===true', 'CERNET selected and submitted');
    await p.close();
  });
  await run('Clarivate retries an unready selector without closing an expanded menu', async () => {
    const html = '<mat-select formcontrolname="federationName" aria-expanded="false" style="display:block;padding:12px"><div class="mat-mdc-select-trigger">Institution</div></mat-select><mat-option hidden role="option" onclick="document.querySelector(\'#go\').disabled=false">CHINA CERNET Federation</mat-option><button id="go" disabled onclick="window.chosen=true">Go to institution</button><script>const select=document.querySelector("mat-select");setTimeout(()=>{select.querySelector(".mat-mdc-select-trigger").onclick=()=>{window.opens=(window.opens||0)+1;select.setAttribute("aria-expanded","true");setTimeout(()=>document.querySelector("mat-option").hidden=false,1200)}},900)</script>';
    const p = await page('https://access.clarivate.com/login', { '/login': html });
    await until(p.session, 'window.chosen===true', 'late-ready selector selected and continued');
    assert.equal(await evaluate(p.session, 'window.opens'), 1);
    assert.ok((await evaluate(p.session, 'window.__institutionStatus().actions')).filter(key=>key.startsWith('federation:open:')).length <= 3);
    await p.close();
  });
  await run('Springer never follows a known personal-only header login', async () => {
    const p=await page('https://link.springer.com/', {'/':'<a href="https://idp.springer.com/auth/personal/springernature" onclick="event.preventDefault();window.wrongLogin=true">Log in</a>'});
    await until(p.session,'document.querySelector(\'[data-in-stitution]\')!==null','helper shows content-page guidance');
    await delay(600);
    assert.equal(await evaluate(p.session,'window.wrongLogin===true'),false);
    await p.close();
  });
  await run('existing institution banners prevent personal sign-in on WoS and Springer', async () => {
    for (const [url,selector] of [['https://www.webofscience.com/','institutional-name'],['https://link.springer.com/','app-article-masthead__access']]) {
      const p=await page(url, {'/':'<span class="'+selector+'">Access provided by Fixture University of Science and Technology</span><button onclick="window.wrongLogin=true">Sign In</button>'});
      await until(p.session,'fixture.messages.includes(\'page:access-present\')','institution banner recognized');
      assert.equal(await evaluate(p.session,'window.wrongLogin===true'),false);
      await p.close();
    }
  });
  await run('CAS auto-submit is opt-in and only submits once', async () => {
    const p = await page(casUrl, { [casUrl]: casHtml() }, { autoSubmit: true });
    await until(p.session, 'window.submits===1', 'CAS requestSubmit fires');
    await delay(700);
    assert.equal(await evaluate(p.session, 'window.submits'), 1);
    await p.close();
  });
  await run('CAS refuses external form actions and GET credential submission', async () => {
    for (const html of [casHtml('', 'https://example.org/collect'), casHtml('', '/cas/login', 'get')]) {
      const p = await page(casUrl, { [casUrl]: html }, { autoSubmit: true });
      await until(p.session, 'document.querySelector("[data-in-stitution]")!==null', 'helper reached CAS');
      await delay(500);
      assert.equal(await evaluate(p.session, 'window.submits'), 0);
      assert.equal(await evaluate(p.session, 'document.querySelector("[name=password]").value'), '');
      await p.close();
    }
  });
  await run('CAS errors and captcha leave fields untouched', async () => {
    for (const extra of ['<div class="errors">Login failed</div>', '<input name="captcha">']) {
      const p = await page(casUrl, { [casUrl]: casHtml(extra) }, { autoSubmit: true });
      await until(p.session, 'document.querySelector("[data-in-stitution]")!==null', 'helper reached CAS');
      await delay(500);
      assert.equal(await evaluate(p.session, 'document.querySelector("[name=password]").value'), '');
      assert.equal(await evaluate(p.session, 'window.submits'), 0);
      await p.close();
    }
  });
  await run('locale-independent consent button respects the consent preference', async () => {
    const url = 'https://idp.fixture.edu/idp/profile/SAML2/POST/SSO';
    for (const enabled of [false, true]) {
      const p = await page(url, { [url]: '<form onsubmit="event.preventDefault();window.accepted=true"><input type="submit" name="_eventId_proceed" value=""></form>' }, { autoConsent: enabled });
      await until(p.session, 'document.querySelector("[data-in-stitution]")!==null', 'consent step visible');
      if (enabled) await until(p.session, 'window.accepted===true', 'consent proceeded');
      else { await delay(600); assert.equal(await evaluate(p.session, 'window.accepted===true'), false); }
      await p.close();
    }
  });
  await run('a university library handles a non-CAS campus portal and OIDC handoff', async () => {
    const source=fs.readFileSync(path.join(root,'examples/example-university.js'),'utf8');
    const fixtureProfile={id:'example-university',library:'example-university',name:'Example University',shortName:'Example U',aliases:[],searchTerm:'Example University',carsiSearchTerm:'Example University',federation:'',entityId:'',identityOrigins:['https://login.example.edu'],discoveryOrigins:[],cas:null};
    const p=await page('https://login.example.edu/portal/start',{
      '/portal/start':'<button data-action="campus-sso" onclick="location.href=\'https://login.example.edu/oidc/authorize\'">Use campus account</button>',
      '/oidc/authorize':'<h1>University account and MFA</h1>'
    },{librarySource:source,institution:fixtureProfile});
    await until(p.session,'location.pathname===\'/oidc/authorize\' && document.querySelector(\'[data-in-stitution]\')!==null','custom library completed campus handoff');
    assert.equal(await evaluate(p.session,'fixture.messages.includes(\'auth:credentials\')'),false);
    await p.close();
  });
  await run('institution selection automatically presses the provider continuation button', async () => {
    for (const [url,button] of [['https://wayf.springernature.com/','Access through your institution'],['https://sso.rsc.org/WAYF','Next']]) {
      const html='<label for="institution">Find your institution</label><input id="institution"><button role="option" onclick="window.selected=true">Fixture University of Science and Technology</button><button onclick="if(window.selected)window.continued=true">'+button+'</button>';
      const p=await page(url,{[new URL(url).pathname]:html});
      await until(p.session,'window.continued===true','selected institution continued without a user click');
      await p.close();
    }
  });
  await run('open shadow-root institution forms submit their search and continue', async () => {
    const html='<div id="component"></div><script>const root=document.querySelector("#component").attachShadow({mode:"open"});root.innerHTML=\'<label for="school">Your institution</label><input id="school"><button id="search">Search for your institution</button><div id="results"></div>\';root.querySelector("#search").onclick=()=>{root.querySelector("#results").insertAdjacentHTML("beforeend",\'<button role="option" id="school-option">Fixture University of Science and Technology</button><button id="next">Next</button>\');root.querySelector("#school-option").onclick=()=>window.selected=true;root.querySelector("#next").onclick=()=>{if(window.selected)window.continued=true}}</script>';
    const p=await page('https://www.jstor.org/',{'/':html});
    await until(p.session,'window.continued===true','shadow search and selection completed');
    await p.close();
  });
  await run('keyboard-driven institution suggestions are triggered automatically', async () => {
    const html='<label for="institution">Search for your Institution</label><input id="institution" onkeyup="document.querySelector(\'#results\').hidden=false"><div id="results" hidden><button role="option" onclick="window.selected=true">Fixture University of Science and Technology</button></div>';
    const p=await page('https://ieeexplore.ieee.org/fixture',{'/fixture':html});
    await until(p.session,'window.selected===true','keyup-driven options selected');
    await p.close();
  });
  await run('native federation suffixes do not block the next institution-selection stage', async () => {
    const html='<select id="federation"><option value="">Choose federation</option><option value="carsi">China CERNET Federation (CARSI)</option></select><label for="school">Institution</label><input id="school"><button role="option" onclick="window.selected=true">Fixture University of Science and Technology</button><button onclick="if(window.selected)window.done=true">Next</button>';
    const p=await page('https://onlinelibrary.wiley.com/action/ssostart',{'/action/ssostart':html});
    await until(p.session,'window.done===true','federation selected and institution continued');
    assert.equal(await evaluate(p.session,'document.querySelector("select").value'),'carsi');await p.close();
  });
  await run('separate library-login and find-institution controls both run once', async () => {
    const html='<button onclick="document.querySelector(\'#find\').hidden=false">Log in through your library</button><button id="find" hidden onclick="document.querySelector(\'#picker\').hidden=false">Find my institution</button><section id="picker" hidden><label for="school">Institution</label><input id="school"><button role="option" onclick="window.selected=true">Fixture University of Science and Technology</button><button onclick="if(window.selected)window.done=true">Next</button></section>';
    const p=await page('https://www.jstor.org/',{'/':html});await until(p.session,'window.done===true','two different institutional controls advanced');await p.close();
  });
  await run('Elsevier institution fields with legacy email IDs use institution names and localized continuation', async () => {
    const html='<label for="bdd-email">组织名称或电子邮箱</label><input id="bdd-email" name="els_institution"><button role="option" onclick="window.selected=true">Fixture University of Science and Technology</button><button onclick="if(window.selected)window.done=true">提交并继续 ↗</button>';
    const p=await page('https://id.elsevier.com/as/authorization.oauth2',{'/as/authorization.oauth2':html});await until(p.session,'window.done===true','localized continuation clicked');await p.close();
  });
  await run('empty directory results try configured aliases without selecting unrelated institutions', async () => {
    const html='<label for="school">Institution</label><input id="school" oninput="window.tries=(window.tries||0)+1;const match=this.value===\'示例大学\';document.querySelector(\'.zero-results-prompt\').hidden=match;document.querySelector(\'#match\').hidden=!match"><p class="zero-results-prompt" hidden>0 Results</p><button id="match" role="option" hidden onclick="window.selected=true">示例大学</button><button onclick="if(window.selected)window.done=true">Next</button>';
    const p=await page('https://www.jstor.org/',{'/':html});await until(p.session,'window.done===true','configured alias resolved');assert.ok(await evaluate(p.session,'window.tries<=4'));await p.close();
  });
  await run('CNKI off-campus entry stays in the same tab and selects the institution list', async () => {
    const p=await page('https://www.cnki.net/',{
      '/':'<div id="ecpHideUnit" onclick="document.querySelector(\'.ecp_schoolVisit\').hidden=false">机构登录</div><button class="ecp_schoolVisit" hidden onclick="window.unwantedPopup=true">校外访问 &gt;</button>',
      'https://fsso.cnki.net/':'<a href="#" onclick="window.chosen=true">示例大学</a>'
    });
    await until(p.session,'location.hostname===\'fsso.cnki.net\' && window.chosen===true','off-campus list chosen without a popup or manual click');await p.close();
  });
  await run('Stop disconnects DOM automation', async () => {
    const p = await page('https://pubs.acs.org/fixture', { '/fixture': '<p>Institutional access page</p>' });
    await until(p.session, 'document.querySelector("[data-in-stitution]")!==null', 'helper running');
    await evaluate(p.session, 'stopFixture();document.body.insertAdjacentHTML("beforeend",\'<button onclick="window.clicked=true">Institutional login</button>\')');
    await delay(800);
    assert.equal(await evaluate(p.session, 'window.clicked===true'), false);
    assert.equal(await evaluate(p.session, 'document.querySelector("[data-in-stitution]")!==null'), false);
    await p.close();
  });

  await run('Silverchair federation uses entity IDs despite abbreviated names and a distracting header link', async () => {
    const html = '<a href="/institutional-login" onclick="window.wrong=true;return false">Access through Institution</a><select id="FederationDropdown" onchange="document.querySelector(\'#InstitutionDropdown\').hidden=false"><option>Select</option><option value="carsi">China CERNET Federation (CARSI)</option></select><select id="InstitutionDropdown" hidden onchange="window.selected=this.value"><option>Select</option><option value="https://idp.scut.edu.cn/idp/shibboleth">SOUTH CHINA UNIV OF TECHNOLOGY</option><option value="https://idp.fixture.edu/idp/shibboleth">FIXTURE UNIV SCI &amp; TECHLGY</option></select><a id="shibbolethSelectBtn" href="#" onclick="window.done=!!window.selected;return false">Access through Institution</a>';
    const p = await page('https://pubs.acs.org/institutional-login', { '/institutional-login': html });
    await until(p.session, 'window.done===true', 'abbreviated university selected by exact entity ID');
    assert.equal(await evaluate(p.session, 'window.selected'), 'https://idp.fixture.edu/idp/shibboleth');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    await p.close();
  });

  await run('Scopus skips optional personalization without signing into a personal account', async () => {
    const html = '<title>Personalize your experience</title><input name="els_mail" type="email"><button id="bdd-elsPrimaryBtn" onclick="window.wrong=true">Sign in or register</button><button id="bdd-elsSecondaryBtn" onclick="window.skipped=true">Skip</button>';
    const p = await page('https://id.elsevier.com/as/resume', { '/as/resume': html });
    await until(p.session, 'window.skipped===true', 'optional personalization skipped');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    assert.equal(await evaluate(p.session, 'document.querySelector("input").value'), '');
    await p.close();
  });

  await run('ACS, RSC, JSTOR and Taylor access banners prevent further login clicks', async () => {
    for (const [url, markup] of [
      ['https://pubs.acs.org/', '<button class="at-institution">FIXTURE UNIV SCI &amp; TECHLGY</button>'],
      ['https://pubs.rsc.org/', '<button class="at-institution">FIXTURE UNIVERSITY OF SCIENCE AND TECHNOLOGY OF EXAMPLE</button>'],
      ['https://www.jstor.org/', '<div class="mfe-provider-designation-statement__toggle">Access provided by Fixture University of Science and Technology</div>'],
      ['https://www.tandfonline.com/', '<div class="institution-image-text">Access provided by Fixture University of Science &amp; Technology</div>']
    ]) {
      const p = await page(url, { '/': markup + '<button onclick="window.wrong=true">Sign In</button>' });
      await until(p.session, 'fixture.messages.includes("page:access-present")', 'publisher access recognized');
      assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
      await p.close();
    }
  });

  await run('explicit JSTOR discovery ignores the existing-access header and selects actual results', async () => {
    const html = '<header><button class="mfe-provider-designation-statement__toggle" onclick="window.wrong=true">Access provided by Fixture University of Science and Technology</button></header><label for="school">Institution</label><input id="school" oninput="document.querySelector(\'#match\').hidden=false"><button id="match" role="option" hidden onclick="window.selected=true">Fixture University of Science and Technology</button><button onclick="if(window.selected)window.done=true">Next</button>';
    const p = await page('https://www.jstor.org/institutionSearch', { '/institutionSearch': html });
    await until(p.session, 'window.done===true', 'explicit institution finder completed');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    await p.close();
  });

  await run('provider menu fallback never submits a personal login form', async () => {
    const p = await page('https://access.clarivate.com/login', { '/login': '<form onsubmit="window.wrong=true;return false"><input name="email" type="email"><button type="submit">Log in</button></form>' });
    await until(p.session, 'window.__institutionStatus?.().phase==="manual"', 'personal form left for the user');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    await p.close();
  });

  await run('RSC uses the institutional action button instead of repeating its navigation link', async () => {
    const html = '<header><a href="/institutional-login" onclick="window.wrong=true;return false">Sign in via your Institution</a></header><main><button id="start-institution" hidden onclick="window.started=true">Access through your institution</button></main><script>setTimeout(()=>document.querySelector("#start-institution").hidden=false,700)</script>';
    const p = await page('https://pubs.rsc.org/institutional-login', { '/institutional-login': html });
    await until(p.session, 'window.started===true', 'institutional action used');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    await p.close();
  });

  await run('browser verification defers direct routing and institutional clicks', async () => {
    const p = await page('https://onlinelibrary.wiley.com/', { '/': '<title>Just a moment...</title><button onclick="window.clicked=true">Institutional login</button>' });
    await until(p.session, 'window.__institutionStatus?.().phase==="manual"', 'verification left for the browser or user');
    assert.equal(await evaluate(p.session, 'fixture.messages.includes("page:route")'), false);
    assert.equal(await evaluate(p.session, 'window.clicked===true'), false);
    await evaluate(p.session, 'document.title="Publisher"');
    await until(p.session, 'window.clicked===true', 'normal flow resumes after verification');
    await p.close();
  });

  await run('publisher server errors do not restart login or direct routing', async () => {
    const p = await page('https://www.tandfonline.com/', { '/': '<title>Internal server error</title><button onclick="window.wrong=true">Login</button>' });
    await until(p.session, 'fixture.messages.includes("page:provider-error")', 'publisher error reported');
    assert.equal(await evaluate(p.session, 'fixture.messages.includes("page:route")'), false);
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    await p.close();
  });

  await run('JSTOR retries an unrelated result, finds the historical name and reports unavailable remote login', async () => {
    const html = '<label for="school">Institution</label><input id="school"><p class="zero-results-prompt" hidden>0 Results</p><div class="institution-finder__results"></div><script>const input=document.querySelector("#school"),results=document.querySelector(".institution-finder__results"),zero=document.querySelector(".zero-results-prompt");input.oninput=()=>{window.tries=(window.tries||0)+1;zero.hidden=input.value!=="Fixture University of Science and Technology";results.innerHTML="";if(input.value==="Fixture U")results.innerHTML=\'<a href="#" onclick="window.wrong=true;return false">Sudan University of Science and Technology</a>\';if(input.value==="Fixture University of Science and Technology of Example"){results.innerHTML=\'<a id="match" href="#">Fixture University of Science and Technology of Example 示例大学</a>\';document.querySelector("#match").onclick=()=>{window.selected=true;results.innerHTML=\'<div class="institution-finder__no-access-prompt">Although Fixture University of Science and Technology of Example participates, we were unable to provide you with a way to log in remotely.</div>\';return false}}}</script>';
    const p = await page('https://www.jstor.org/institutionSearch', { '/institutionSearch': html });
    await until(p.session, 'fixture.messages.includes("page:remote-unavailable")', 'unavailable method reported');
    assert.equal(await evaluate(p.session, 'window.wrong===true'), false);
    assert.equal(await evaluate(p.session, 'window.selected===true'), true);
    assert.ok(await evaluate(p.session, 'window.tries<=4'));
    await p.close();
  });

  // Render the actual popup assets with a fixture-only extension API.
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 650, deviceScaleFactor: 2, mobile: false }, sessionId);
  const popupBridge = `window.fixtureOverrides={};window.fixtureCommands=[];window.fixtureManager='zotero';window.chrome={tabs:{query:async()=>[{id:1}]},storage:{onChanged:{addListener(){}}},runtime:{sendMessage:async(message)=>{window.fixtureCommands.push(message);if(message.type==='profile:remove'){window.fixtureOverrides={profile:Institution.normalizeProfile(Institution.INSTITUTION),profiles:[Institution.normalizeProfile(Institution.INSTITUTION)],packOwned:false,supported:false};return {ok:true}}if(message.type==='reference-manager:select'){window.fixtureManager=message.managerId;return {ok:true}}return {ok:true,referenceManager:ReferenceManagers.get(window.fixtureManager),supported:true,provider:{name:'Web of Science'},profile:${JSON.stringify(fixtureInstitution)},profiles:[${JSON.stringify(fixtureInstitution)}],hostAccess:true,flow:null,settings:{autoSubmit:false,autoConsent:false},hasCredentials:false,...window.fixtureOverrides}}}};`;
  const popupHtml = fs.readFileSync(path.join(extension, 'popup.html'), 'utf8').replace('src="icons/icon-128.png"', `src="data:image/png;base64,${fs.readFileSync(path.join(extension,'icons/icon-128.png')).toString('base64')}"`).replace('<script src="core.js" defer></script>', '')
    .replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g, '').replace('<link rel="stylesheet" href="popup.css">', `<style>${fs.readFileSync(path.join(extension, 'popup.css'), 'utf8')}</style>`);
  await send('Page.setDocumentContent', { frameId: (await send('Page.getFrameTree', {}, sessionId)).frameTree.frame.id, html: popupHtml }, sessionId);
  await evaluate(sessionId, core + '\n' + popupBridge + '\n' + fs.readFileSync(path.join(extension, 'popup.js'), 'utf8'));
  await until(sessionId, 'document.querySelector("#start").disabled===false', 'popup is ready');
  assert.equal(await evaluate(sessionId, `(()=>{const input=document.querySelector('#profile-id');const saved=input.value;input.value='my-u';const valid=input.checkValidity();input.value='Invalid_ID';const invalid=!input.checkValidity();input.value=saved;return valid&&invalid})()`), true);
  await delay(200);
  const dimensions = await evaluate(sessionId, '({width:document.body.scrollWidth,height:document.body.scrollHeight})');
  assert.equal(dimensions.width, 390);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: dimensions.height, scale: 1 } }, sessionId);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/popup-preview.png'), Buffer.from(screenshot.data, 'base64'));
  await evaluate(sessionId, 'document.querySelector("#preferences").open=true;document.querySelector(".providers").open=true');
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("#provider-list a").length'), 10);
  assert.equal(await evaluate(sessionId, 'document.body.scrollWidth'), 390);
  assert.equal(await evaluate(sessionId, 'document.querySelectorAll("#reference-manager option").length'), 3);
  await evaluate(sessionId, 'document.querySelector("#reference-manager").value="endnote";document.querySelector("#reference-manager").dispatchEvent(new Event("change"))');
  await until(sessionId, 'document.querySelector("#manager-guidance").textContent.includes("EndNote Click")', 'native manager selection updates handoff guidance');
  await evaluate(sessionId, `window.fixtureOverrides={profile:{...${JSON.stringify(fixtureInstitution)},library:'executable-pack',adapterDigest:'f'.repeat(64)},packOwned:true};refresh()`);
  await evaluate(sessionId, 'document.querySelector("#institution-settings").open=true');
  assert.equal(await evaluate(sessionId, 'document.querySelector("#profile-form").hidden && !!document.querySelector("#remove-profile").getClientRects().length'), true);
  await evaluate(sessionId, 'document.querySelector("#profile-id").value="different-unsaved-id";document.querySelector("#remove-profile").click()');
  assert.equal(await evaluate(sessionId, 'fixtureCommands.some(message=>message.type==="profile:remove")'), false);
  assert.equal(await evaluate(sessionId, '!document.querySelector("#remove-profile-help").hidden'), true);
  await evaluate(sessionId, 'document.querySelector("#remove-profile").click()');
  await until(sessionId, 'document.querySelector("#remove-profile").hidden', 'removing the selected pack restores clean setup');
  assert.equal(await evaluate(sessionId, 'fixtureCommands.find(message=>message.type==="profile:remove").profileId'), fixtureInstitution.id);
  assert.equal(await evaluate(sessionId, '!document.querySelector("#start").disabled && document.querySelector("#start-label").textContent.includes("Install")'), true);
  console.log(`PASS popup renders without overflow; pack removal and fresh setup work; preview saved to docs/popup-preview.png`);
  await send('Target.closeTarget', { targetId });

  let actualWorkerSession;
  await run('unpacked extension loads and runs its actual worker and content scripts together', async () => {
    const loaded = await send('Extensions.loadUnpacked', { path: fixtureExtension });
    let worker;
    const deadline = Date.now() + 6000;
    while (!worker && Date.now() < deadline) {
      const targets = await send('Target.getTargets');
      worker = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url === `chrome-extension://${loaded.id}/background.js`);
      if (!worker) await delay(100);
    }
    assert.ok(worker, `Extension service worker registered (${JSON.stringify(loaded)})`);
    const { sessionId: workerSession } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
    actualWorkerSession = workerSession;
    assert.equal(await evaluate(workerSession, '(async()=>{await ready;return (await selectedProfile()).id})()'), 'unconfigured');
    assert.equal(await evaluate(workerSession, 'Institution.libraries().some(library=>!!library.preset)'), false);
    const p = await page('https://pubs.rsc.org/article/fixture', {
      '/article/fixture': '<button onclick="document.querySelector(\'#menu\').hidden=false">Log in</button><div id="menu" hidden><a href="https://ds.carsi.edu.cn/login/index.html">Log in via your home institution</a></div>',
      'https://ds.carsi.edu.cn/login/index.html': carsiHtml,
      [casUrl]: casHtml()
    }, {
      realExtension: true,
      beforeNavigate: async () => {
        await evaluate(workerSession, `(async()=>{
          await ready;
          const tabs=await chrome.tabs.query({});const tab=tabs.sort((a,b)=>b.id-a.id)[0];
          await chrome.storage.local.set({institutions:{selectedId:'fixture-u',profiles:[${JSON.stringify(fixtureInstitution)}]},'credentials:fixture-u':{username:'fixture-user',password:'fixture-only-password',scope:Institution.credentialScope(${JSON.stringify(fixtureInstitution)})},'settings:fixture-u':{autoSubmit:true,autoConsent:false,autoStart:true}});
          // No journey is seeded: navigation must start it automatically.
          return true;
        })()`);
      }
    });
    try {
      await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'actual extension completes discovery and submits fixture CAS');
    } catch (error) {
      console.error(await evaluate(workerSession, `(async()=>({origins:Institution.optionalOrigins(Institution.INSTITUTION),granted:await chrome.permissions.contains({origins:Institution.optionalOrigins(Institution.INSTITUTION)}),flows:Object.values(await chrome.storage.session.get(null)).map(f=>({active:f.active,phase:f.phase,steps:f.steps})),scripts:await chrome.scripting.getRegisteredContentScripts()}))()`));
      throw error;
    }
    assert.equal(await evaluate(p.session, 'typeof window.fixture'), 'undefined');
    await p.close();
  });

  await run('actual worker skips CNKI menus and institution directory with one direct route', async () => {
    const p = await page('https://www.cnki.net/', {
      '/': '<p>CNKI entry page without institution controls</p>',
      '/Shibboleth.sso/Login': `<script>location.replace(${JSON.stringify(casUrl)})</script>`,
      [casUrl]: casHtml()
    }, { realExtension: true });
    await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'direct CNKI route reaches fixture CAS');
    const attempts = await evaluate(actualWorkerSession, `(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).filter(f=>f.routeAttempts?.includes('cnki:sp-init')).map(f=>f.routeAttempts)})()`);
    assert.ok(attempts.some(ids => ids.length === 1 && ids[0] === 'cnki:sp-init'));
    await p.close();
  });

  await run('actual WOS journey follows discovery through the auto-POST gateway and IdP consent', async () => {
    const consent = 'https://idp.fixture.edu/idp/profile/SAML2/POST/SSO';
    const final = 'https://www.webofscience.com/wos/woscc/smart-search';
    await evaluate(actualWorkerSession, `chrome.storage.local.set({'settings:fixture-u':{autoSubmit:true,autoConsent:true,autoStart:true}})`);
    const p = await page('https://www.webofscience.com/article/fixture', {
      '/article/fixture': '<a href="https://ds.carsi.edu.cn/login/index.html">Institutional login</a>',
      'https://ds.carsi.edu.cn/login/index.html': '<button role="option" onclick="window.selected=true">示例大学</button><button onclick="if(window.selected)location.assign(\'https://www.webofknowledge.com/\')">Login</button>',
      'https://www.webofknowledge.com/': `<p>Continuing authentication</p><script>setTimeout(()=>location.replace(${JSON.stringify(consent)}),1000)</script>`,
      [consent]: `<form onsubmit="event.preventDefault();location.replace('${final}')"><input type="submit" name="_eventId_proceed" value="Continue"></form>`,
      [final]: '<span class="institutional-name">Fixture University of Science and Technology</span>'
    }, { realExtension: true });
    await until(p.session, `location.href===${JSON.stringify(final)}`, 'IdP consent handled after the gateway');
    await until(actualWorkerSession, `(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).some(f=>f.providerId==='wos'&&f.visitedDiscovery&&f.visitedIdentity&&!f.active)})()`, 'WOS journey records both hops and completes');
    await p.close();
  });

  await run('actual worker answers CARSI discovery while preserving opaque SP state', async () => {
    const callback = 'https://pubs.rsc.org/Shibboleth.sso/Login?SAMLDS=1&target=cookie%3Afixture%2B123';
    const directory = 'https://ds.carsi.edu.cn/login/index.html?' + new URLSearchParams({ entityID: 'https://pubs.rsc.org/shibboleth', return: callback });
    const response = callback + '&entityID=' + encodeURIComponent('https://idp.fixture.edu/idp/shibboleth');
    const p = await page('https://pubs.rsc.org/article/protocol-fixture', {
      '/article/protocol-fixture': `<a href="${directory.replaceAll('&', '&amp;')}">Log in via your home institution</a>`,
      [directory]: '<p>Discovery page without visible controls</p>',
      [response]: `<script>location.replace(${JSON.stringify(casUrl)})</script>`,
      [casUrl]: casHtml()
    }, { realExtension: true });
    await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'discovery response reaches fixture CAS with original SP state');
    const attempts = await evaluate(actualWorkerSession, `(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).some(f=>f.routeAttempts?.includes('saml:discovery'))})()`);
    assert.equal(attempts, true);
    await p.close();
  });

  await run('actual worker starts published provider routes without institution menus', async () => {
    for (const [source, endpoint, id] of [
      ['https://link.springer.com/book/fixture', 'https://fsso.springer.com/federation/init', 'springer:sp-init'],
      ['https://www.nature.com/articles/fixture', 'https://sp.nature.com/saml/login', 'nature:sp-init'],
      ['https://ieeexplore.ieee.org/', 'https://ieeexplore.ieee.org/servlet/wayf.jsp', 'ieee:sp-init'],
      ['https://onlinelibrary.wiley.com/', 'https://onlinelibrary.wiley.com/action/ssostart', 'wiley:sp-init'],
      ['https://www.scopus.com/pages/home', 'https://auth.elsevier.com/ShibAuth/institutionLogin', 'elsevier:sp-init'],
      ['https://pubs.acs.org/', 'https://pubs.acs.org/Shibboleth.sso/Login', 'acs:sp-init'],
      ['https://www.tandfonline.com/', 'https://www.tandfonline.com/action/ssostart', 'taylor:sp-init'],
      ['https://pubs.rsc.org/', 'https://pubs.rsc.org/FederatedAccess/FederatedLogin', 'rsc:broker-init']
    ]) {
      const expected = require('../extension/routes.js').plan(source, require('../extension/core.js').createFlow(source, Date.now(), 'fixture', fixtureInstitution)).url;
      const p = await page(source, {
        [source]: '<p>Research page with no login controls</p>',
        [expected]: `<script>location.replace(${JSON.stringify(casUrl)})</script>`,
        [casUrl]: casHtml()
      }, { realExtension: true });
      await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'direct provider handoff reaches CAS: ' + endpoint);
      const routed = await evaluate(actualWorkerSession, `(async()=>{const data=await chrome.storage.session.get(null);return Object.values(data).some(f=>f.routeAttempts?.includes(${JSON.stringify(id)}))})()`);
      assert.equal(routed, true);
      await p.close();
    }
  });

  await run('actual worker routes discovery parameters added after SPA initialization', async () => {
    const initial = 'https://ds.carsi.edu.cn/login/index.html';
    const complete = initial + '?' + new URLSearchParams({entityID:'https://pubs.rsc.org/shibboleth',return:'https://pubs.rsc.org/Shibboleth.sso/Login'});
    const expected = require('../extension/routes.js').plan(complete, coreModule.createFlow('https://pubs.rsc.org/', Date.now(), 'fixture', fixtureInstitution)).url;
    const p = await page('https://pubs.rsc.org/article/spa-fixture', {
      '/article/spa-fixture': `<a href="${initial}">Institutional login</a>`,
      [initial]: `<p id="loading">Loading</p><script>setTimeout(()=>{history.replaceState(null,'',${JSON.stringify(complete)});document.querySelector('#loading').textContent='Ready'},700)</script>`,
      [expected]: `<script>location.replace(${JSON.stringify(casUrl)})</script>`,
      [casUrl]: casHtml()
    }, { realExtension: true });
    await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'late discovery parameters get a direct route');
    await p.close();
  });

  await run('compatibility mode preserves the full CNKI page-based flow', async () => {
    await evaluate(actualWorkerSession, `chrome.storage.local.set({'settings:fixture-u':{autoSubmit:true,autoStart:true,browserOnly:true}})`);
    const p = await page('https://www.cnki.net/', {
      '/': '<button class="ecp_schoolVisit">Off-campus login</button>',
      'https://fsso.cnki.net/': `<a href="${casUrl.replaceAll('&', '&amp;')}">示例大学</a>`,
      [casUrl]: casHtml()
    }, { realExtension: true, beforeNavigate: async () => {
      await evaluate(actualWorkerSession, `(async()=>{globalThis.compatibilityFixtureTabId=(await chrome.tabs.query({})).sort((a,b)=>b.id-a.id)[0].id})()`);
    } });
    await until(p.session, `location.hostname==='cas.fixture.edu' && window.submits===1`, 'compatibility mode uses the CNKI school list');
    const routed = await evaluate(actualWorkerSession, `(async()=>{const key='flow:'+compatibilityFixtureTabId;return !!(await chrome.storage.session.get(key))[key]?.routeAttempts?.length})()`);
    assert.equal(routed, false);
    await p.close();
  });

  await run('actual access companion leaves native reference and PDF controls untouched', async () => {
    const p = await page('https://www.nature.com/articles/fixture', {
      '/articles/fixture': '<span class="app-article-masthead__access">' + fixtureInstitution.name + '</span><a href="/articles/fixture.pdf" onclick="event.preventDefault();window.pdfOpens=(window.pdfOpens||0)+1">Download PDF</a><button id="native-save" onclick="window.saved=true">Save with reference manager</button>'
    }, { realExtension: true, beforeNavigate: async () => {
      // The newest tab is this fixture, still at about:blank. URL filtering
      // would require the broad tabs permission that production does not use.
      await evaluate(actualWorkerSession, `(async()=>{globalThis.fixtureCompanionTabId=(await chrome.tabs.query({})).sort((a,b)=>b.id-a.id)[0].id})()`);
    } });
    await until(actualWorkerSession, `(async()=>{const key='flow:'+fixtureCompanionTabId;return (await chrome.storage.session.get(key))[key]?.phase==='access-present'})()`, 'this article has access and is left for the reference manager');
    await delay(600);
    assert.equal(await evaluate(p.session, '!!document.querySelector("[data-in-stitution-article]")'), false);
    assert.equal(await evaluate(p.session, 'window.pdfOpens || 0'), 0);
    assert.equal(await evaluate(p.session, 'window.saved===true'), false);
    assert.equal(await evaluate(actualWorkerSession, `(async()=>{const {referenceManager}=await chrome.storage.local.get('referenceManager');return ReferenceManagers.get(referenceManager).id})()`), 'zotero');
    await p.close();
  });
  await run('actual institution packs drag, review, install, persist and remove through their own page', async () => {
    const url = await evaluate(actualWorkerSession, `chrome.runtime.getURL('packs.html')`);
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await until(sessionId, 'document.querySelectorAll(".saved-item").length>0', 'pack manager loads its own authorized state');
    const pack = require('../extension/packs.js').fromProfile(coreModule.normalizeProfile({ id: 'pack-fixture', library: 'manual', name: 'Pack University', identityOrigins: ['https://idp.fixture.edu'] }), { maintainer: 'Fixture Maintainer', description: '<script>window.packXss=true</script>' });
    async function drop(value) {
      await evaluate(sessionId, `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify(value))}],'fixture.institution.json',{type:'application/json'}));document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})()`);
    }
    await drop({ ...pack, scripts: ['alert(1)'] });
    await until(sessionId, 'document.querySelector("#pack-feedback").classList.contains("error")', 'script-bearing pack is rejected');
    assert.equal(await evaluate(sessionId, 'document.querySelector("#pack-review").hidden'), true);
    await drop(pack);
    await until(sessionId, '!document.querySelector("#pack-review").hidden', 'dropped pack presents a review');
    assert.equal(await evaluate(sessionId, 'document.querySelector("#review-name").textContent'), 'Pack University');
    assert.equal(await evaluate(sessionId, 'window.packXss===true'), false);
    assert.equal(await evaluate(sessionId, 'document.querySelectorAll("#review-description script").length'), 0);
    assert.equal(await evaluate(actualWorkerSession, `(async()=>!!(await chrome.storage.local.get('institutionPacks')).institutionPacks?.length)()`), false);
    await send('Runtime.evaluate', { expression: 'document.querySelector("#install-pack").click()', userGesture: true }, sessionId);
    await until(sessionId, 'document.querySelector("#pack-feedback").textContent.includes("installed and selected")', 'explicit installation completes through the real worker');
    assert.equal(await evaluate(actualWorkerSession, `(async()=>{const p=await selectedProfile();return p.id==='pack-fixture'&&!(await settings(p.id)).autoStart})()`), true);
    await send('Page.reload', {}, sessionId);
    await until(sessionId, 'document.querySelector("#installed-packs").textContent.includes("Pack 1.0.0")', 'installed pack survives page reload');
    await evaluate(sessionId, '[...document.querySelectorAll(".saved-item")].find(card=>!card.textContent.includes("Pack University")).querySelector("button").click()');
    await until(actualWorkerSession, `(async()=>(await selectedProfile()).id==='fixture-u')()`, 'saved institutions can be selected in the pack manager');
    await until(sessionId, '[...document.querySelectorAll(".saved-item")].some(card=>card.textContent.includes("Pack University")&&card.textContent.includes("Use institution"))', 'the installed pack offers a selection control');
    await evaluate(sessionId, '[...document.querySelectorAll(".saved-item")].find(card=>card.textContent.includes("Pack University")).querySelector("button").click()');
    await until(actualWorkerSession, `(async()=>(await selectedProfile()).id==='pack-fixture')()`, 'the pack can be selected again');
    assert.equal(await evaluate(sessionId, 'document.documentElement.scrollWidth<=window.innerWidth'), true);
    const height = await evaluate(sessionId, 'document.body.scrollHeight');
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1000, height, scale: 1 } }, sessionId);
    fs.writeFileSync(path.join(root, 'docs/packs-preview.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate(sessionId, '[...document.querySelectorAll(".saved-item")].find(card=>card.textContent.includes("Pack University")).querySelector(".danger-button").click()');
    await until(sessionId, 'document.querySelector("#installed-packs").textContent.includes("Remove institution and saved login?")', 'removal requires a separate confirmation click');
    await evaluate(sessionId, '[...document.querySelectorAll("button")].find(b=>b.textContent==="Remove institution and saved login?").click()');
    await until(sessionId, '!document.querySelector("#installed-packs").textContent.includes("Pack University")', 'pack removal preserves the original institution');
    assert.equal(await evaluate(actualWorkerSession, `(async()=>(await selectedProfile()).id)()`), 'fixture-u');
    await send('Target.closeTarget', { targetId });
  });
  await run('actual executable institution packs run unbundled non-CAS portal and API code', async () => {
    const id = await evaluate(actualWorkerSession, 'chrome.runtime.id');
    const { targetId: settingsId } = await send('Target.createTarget', { url: 'chrome://extensions/' });
    const { sessionId: settingsSession } = await send('Target.attachToTarget', { targetId: settingsId, flatten: true });
    await until(settingsSession, '!!chrome.developerPrivate', 'isolated browser extension controls are ready');
    await evaluate(settingsSession, 'new Promise(resolve=>chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true},()=>resolve(true)))');
    const enabled = await evaluate(settingsSession, `new Promise(resolve=>chrome.developerPrivate.updateExtensionConfiguration({extensionId:${JSON.stringify(id)},userScriptsAccess:true},()=>resolve({error:chrome.runtime.lastError?.message||null})))`);
    assert.equal(enabled.error, null, JSON.stringify(enabled));
    const availableWithoutReload = await evaluate(actualWorkerSession, 'adapterHost.available()').catch(() => false);
    if (!availableWithoutReload) {
      const reload = await evaluate(settingsSession, `new Promise(resolve=>chrome.developerPrivate.reload(${JSON.stringify(id)},{},()=>resolve({error:chrome.runtime.lastError?.message||null})))`);
      assert.equal(reload.error, null, JSON.stringify(reload));
      await until(settingsSession, `new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({},items=>resolve(items.some(x=>x.id===${JSON.stringify(id)}&&x.state==='ENABLED'))))`, 'the reloaded fixture is enabled');
      await delay(200);
    }
    const { targetId: managerId } = await send('Target.createTarget', { url: `chrome-extension://${id}/packs.html` });
    const { sessionId: manager } = await send('Target.attachToTarget', { targetId: managerId, flatten: true });
    await until(manager, 'document.querySelectorAll(".saved-item").length>0', 'executable pack manager wakes its worker');
    await send('ServiceWorker.enable', {}, settingsSession);
    await send('ServiceWorker.startWorker', { scopeURL: `chrome-extension://${id}/` }, settingsSession);
    let worker;
    for (let i = 0; i < 40 && !worker; i++) { await delay(100); worker = (await send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url===`chrome-extension://${id}/background.js`); }
    assert.ok(worker);
    actualWorkerSession = (await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })).sessionId;
    await until(actualWorkerSession, '(async()=>{await ready;return adapterHost.available()})()', 'native User Scripts API is enabled in the isolated browser');
    const { build } = require('./build-institution.cjs');
    const archivePath = await build(path.join(root, 'examples/custom-university'), path.join(profile, 'built-packs'));
    const archive = require('../extension/pack-archive.js');
    const packs = require('../extension/packs.js');
    const source = await archive.read(fs.readFileSync(archivePath));
    source.adapter.digest = undefined;
    source.adapter.frames = 'all';
    source.adapter.returnOrigins = ['https://pubs.rsc.org'];
    source.files['adapter.js'] = source.files['adapter.js'].replace('await ctx.complete({ returnUrl: portal.returnUrl });', "await ctx.navigate('publisher-return', portal.returnUrl, { target: 'tab' });");
    source.files['adapter.js'] = source.files['adapter.js'].replace('  const portal =', "  if (ctx.pageRole === 'return') { if (ctx.researchPage) await ctx.complete(); return; }\n  const portal =");
    source.files['adapter.js'] = 'document.documentElement.setAttribute("data-imported-adapter-ran","yes");\n' + source.files['adapter.js'];
    source.files['adapter.js'] = source.files['adapter.js'].replace("  const portal =", `  if (location.pathname === '/hold') {
    if (!ctx.local.waiting) { ctx.local.waiting=true; document.documentElement.setAttribute('data-pack-holding','yes'); ctx.signal.addEventListener('abort',()=>document.documentElement.setAttribute('data-pack-aborted','yes')); }
    return;
  }
  const portal =`);
    const data = Buffer.from(archive.write(await packs.prepare(source))).toString('base64');
    await evaluate(manager, `(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(data)}),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'custom-university.instpack',{type:'application/zip'}));document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))})()`);
    await until(manager, '!document.querySelector("#pack-review").hidden', 'archive source and manifest are reviewed');
    assert.equal(await evaluate(manager, 'document.querySelector("#review-source").hidden'), false);
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false }, manager);
    const previewHeight = await evaluate(manager, 'document.body.scrollHeight');
    const preview = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1000, height: previewHeight, scale: 1 } }, manager);
    fs.writeFileSync(path.join(root, 'docs/executable-pack-preview.png'), Buffer.from(preview.data, 'base64'));
    await send('Runtime.evaluate', { expression: 'document.querySelector("#install-pack").click()', userGesture: true }, manager);
    await until(manager, 'document.querySelector("#pack-feedback").textContent.includes("installed and selected")', 'unbundled source installs through the native API');
    await until(manager, '!document.querySelector("#pack-configuration").hidden && !document.querySelector("#save-pack-settings").disabled', 'the pack supplies its own functioning setup screen');
    const frameTarget = (await send('Target.getTargets')).targetInfos.find((item) => item.type === 'iframe' && item.url.endsWith('/pack-settings-frame.html'));
    let settingsUi;
    let settingsContext;
    if (frameTarget) settingsUi = (await send('Target.attachToTarget', { targetId: frameTarget.targetId, flatten: true })).sessionId;
    else {
      settingsUi = manager;
      const tree = await send('Page.getFrameTree', {}, manager);
      const child = tree.frameTree.childFrames.find((item) => item.frame.url.endsWith('/pack-settings-frame.html'));
      settingsContext = (await send('Page.createIsolatedWorld', { frameId: child.frame.id, worldName: 'fixture-settings' }, manager)).executionContextId;
    }
    const configResult = await send('Runtime.evaluate', { expression: `(()=>{document.querySelector('#realm').value='hospital';document.querySelector('#account').value='fixture-only';document.querySelector('#password').value='fixture-private';return !!document.querySelector('#password')})()`, returnByValue: true, ...(settingsContext ? { contextId: settingsContext } : {}) }, settingsUi);
    assert.equal(configResult.result.value, true);
    await evaluate(manager, 'document.querySelector("#save-pack-settings").click()');
    await until(manager, 'document.querySelector("#settings-feedback").textContent.includes("settings saved")', 'pack-defined configuration is saved without a core field schema');
    assert.equal(await evaluate(manager, `(()=>{try{return !!document.querySelector('iframe').contentDocument}catch{return false}})()`), false);
    assert.equal(await evaluate(actualWorkerSession, `(async()=>{const reply=await handle({type:'pack:export',profileId:'custom-university'},{url:chrome.runtime.getURL('packs.html'),frameId:0});return JSON.stringify(reply).includes('fixture-private')})()`), false);
    const idle = await page('https://login.example.edu/portal/start', { '/portal/start': '<button data-action="campus-account" onclick="window.unexpectedClick=true">Campus account</button>' }, { realExtension: true });
    await until(idle.session, 'document.readyState==="complete"', 'ordinary login-page visit is loaded');
    await delay(700);
    assert.equal(await evaluate(idle.session, 'document.documentElement.hasAttribute("data-imported-adapter-ran")'), false);
    assert.equal(await evaluate(idle.session, 'window.unexpectedClick===true'), false);
    await idle.close();
    await evaluate(actualWorkerSession, `chrome.storage.local.set({'settings:custom-university':{autoStart:true}})`);
    let apiCalls = 0;
    handlers.set(`${actualWorkerSession}:Fetch.requestPaused`, (event) => {
      assert.equal(event.request.method, 'POST');
      assert.deepEqual(JSON.parse(event.request.postData), { realm: 'hospital' });
      apiCalls++;
      void send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{"authenticated":true}').toString('base64') }, actualWorkerSession);
    });
    await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.example.edu/*' }] }, actualWorkerSession);
    const p = await page('https://pubs.rsc.org/article/custom-fixture', {
      '/article/custom-fixture': '<a href="https://login.example.edu/portal/start">Institutional login</a>',
      '/portal/start': '<button data-action="campus-account" onclick="location.href=\'/tenant/choose\'">Campus account</button>',
      '/tenant/choose': '<button data-realm="university" onclick="location.href=\'/wrong-realm\'">University realm</button><button data-realm="hospital" onclick="location.href=\'/library/ready\'">Hospital realm</button>',
      '/library/ready': '<h1>University session ready</h1><script>window.portalSessionReady=true</script>',
      '/api/session': { type: 'application/json', body: '{"authenticated":true}' },
      '/article/pack-return': '<h1>Research article after custom authentication</h1>'
    }, { realExtension: true });
    await until(p.session, 'location.href==="https://pubs.rsc.org/article/pack-return"', 'imported non-CAS code completes choices and a same-origin API call');
    await until(actualWorkerSession, `(async()=>Object.values(await chrome.storage.session.get(null)).some(f=>f?.profile?.id==='custom-university'&&!f.active&&f.visitedIdentity&&f.phase==='returned'))()`, 'publisher content acknowledges completion after navigation');
    assert.equal(await evaluate(p.session, 'typeof window.InstitutionPack'), 'undefined');
    const records = await evaluate(actualWorkerSession, `(async()=>Object.values(await chrome.storage.session.get(null)).filter(f=>f?.profile?.id==='custom-university').map(f=>({active:f.active,visitedIdentity:f.visitedIdentity,phase:f.phase,steps:f.steps})))()`);
    assert.ok(records.some(f => !f.active && f.visitedIdentity && f.phase === 'returned'), JSON.stringify(records));
    assert.equal(await evaluate(actualWorkerSession, `(async()=>{const data=await packData('custom-university');return data.state.completed&&data.state.realm==='hospital'})()`), true);
    assert.equal(apiCalls, 1, 'the institution API call runs in the worker');
    await p.close();
    const framed = await page('https://login.example.edu/frame-shell', {
      '/frame-shell': '<h1>Institution portal shell</h1><iframe src="/portal/start"></iframe>',
      '/portal/start': '<button data-action="campus-account" onclick="location.href=\'/tenant/choose\'">Campus account</button>',
      '/tenant/choose': '<button data-realm="hospital" onclick="location.href=\'/library/ready\'">Hospital realm</button>',
      '/library/ready': '<script>window.portalSessionReady=true</script>',
      '/article/pack-return': '<h1>Article after framed login</h1>'
    }, { realExtension: true, beforeNavigate: async () => {
      await evaluate(actualWorkerSession, `(async()=>{const tab=(await chrome.tabs.query({})).sort((a,b)=>b.id-a.id)[0];await writeFlow(tab.id,Institution.createFlow('https://login.example.edu/frame-shell',Date.now(),'frame-fixture',await selectedProfile()))})()`);
    } });
    await until(framed.session, 'location.href==="https://pubs.rsc.org/article/pack-return"', 'the same pack owns a child-frame login and completes in the parent tab');
    assert.equal(apiCalls, 2);
    await framed.close();
    const held = await page('https://login.example.edu/hold', { '/hold': '<h1>Waiting for institution verification</h1>' }, { realExtension: true, beforeNavigate: async () => {
      await evaluate(actualWorkerSession, `(async()=>{const tab=(await chrome.tabs.query({})).sort((a,b)=>b.id-a.id)[0];globalThis.heldPackTabId=tab.id;await writeFlow(tab.id,Institution.createFlow('https://login.example.edu/hold',Date.now(),'held-fixture',await selectedProfile()))})()`);
    } });
    await until(held.session, 'document.documentElement.hasAttribute("data-pack-holding")', 'pack is waiting for its own verification flow');
    await evaluate(actualWorkerSession, `(async()=>{const pack=(await installedPacks()).find(p=>p.id==='custom-university');await chrome.storage.session.set({'adapterDocument:gone-fixture':{tabId:heldPackTabId,documentId:'gone-fixture',id:pack.id,digest:pack.adapter.digest}});await handle({type:'flow:stop',tabId:heldPackTabId},{url:chrome.runtime.getURL('popup.html')})})()`);
    await until(held.session, 'document.documentElement.hasAttribute("data-pack-aborted")', 'Stop aborts the active pack even when older documents no longer exist');
    await held.close();
    // Real Fetch semantics: a credential-bearing POST must stop before a
    // redirect, while its session cookie remains available to the browser.
    await send('Fetch.disable', {}, actualWorkerSession);
    handlers.delete(`${actualWorkerSession}:Fetch.requestPaused`);
    const redirectRequests = [];
    const server = https.createServer(loopbackTls, (request, response) => {
      redirectRequests.push({ path: request.url, cookie: request.headers.cookie || '' });
      response.writeHead(request.url === '/session-redirect' ? 302 : 200, request.url === '/session-redirect' ? {
        Location: '/never-follow', 'Set-Cookie': 'fixture_session=ready; Secure; HttpOnly; SameSite=Lax; Path=/'
      } : { 'Content-Type': 'text/html' });
      response.end('<h1>Loopback authentication fixture</h1>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `https://127.0.0.1:${server.address().port}`;
    try {
      const redirect = await evaluate(actualWorkerSession, `adapterHost.request(${JSON.stringify(origin + '/session-redirect')},{method:'POST',body:'fixture=only',redirect:'manual',timeoutMs:5000}).catch(error=>({error:error.message}))`);
      assert.deepEqual(redirect, { ok: false, status: 0, opaqueRedirect: true, headers: {}, body: '' });
      assert.equal(redirectRequests.length, 1); assert.equal(redirectRequests[0].path, '/session-redirect');
      const cookies = await send('Storage.getCookies');
      assert.ok(cookies.cookies.some(cookie => cookie.domain === '127.0.0.1' && cookie.name === 'fixture_session' && cookie.value === 'ready' && cookie.httpOnly));
      const tab = await send('Target.createTarget', { url: origin + '/browser-resume' });
      const session = (await send('Target.attachToTarget', { targetId: tab.targetId, flatten: true })).sessionId;
      await until(session, 'document.querySelector("h1")?.textContent==="Loopback authentication fixture"', 'browser can resume the background-created session');
      assert.ok(redirectRequests.some(request => request.path === '/browser-resume' && request.cookie.includes('fixture_session=ready')));
      assert.ok(!redirectRequests.some(request => request.path === '/never-follow'));
      await send('Target.closeTarget', { targetId: tab.targetId });
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await evaluate(manager, '[...document.querySelectorAll(".saved-item")].find(card=>card.textContent.includes("Custom University")).querySelector(".danger-button").click()');
    await evaluate(manager, '[...document.querySelectorAll(".saved-item")].find(card=>card.textContent.includes("Custom University")).querySelector(".danger-button").click()');
    await until(manager, '!document.querySelector("#installed-packs").textContent.includes("Custom University")', 'the executable institution is removable from its manager');
    await evaluate(manager, 'document.querySelector(".saved-item .danger-button").click()');
    await evaluate(manager, 'document.querySelector(".saved-item .danger-button").click()');
    await until(manager, 'document.querySelector("#installed-packs").textContent.includes("No institutions installed")', 'the last manual institution is removable without creating a fake saved institution');
    await send('Target.closeTarget', { targetId: managerId });
    await send('Target.closeTarget', { targetId: settingsId });
  });
  console.log(`${passed + 1} browser checks passed. Live provider authentication was not exercised.`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
  await send('Browser.close').catch(() => {});
  browser.kill();
  for (const pending of waiting.values()) clearTimeout(pending.timer);
});
