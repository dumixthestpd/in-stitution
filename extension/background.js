/* global Institution, InstitutionRoutes, ReferenceManagers, InstitutionPacks */
"use strict";
importScripts("institutions/catalog.js", "core.js", "routes.js", "integrations/reference-managers.js", "packs.js", "adapter-host.js");
const adapterHost = InstitutionAdapterHost.create({ chrome, core: Institution, packs: InstitutionPacks });
let adapterListenerAttached = false;
let adapterRegistrationFailed = false;

// Content scripts receive only explicit replies, never direct storage access.
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
]).then(async () => {
  await InstitutionLibraries.migrate(chrome.storage.local, Institution);
  await syncProfileScripts((await configuration()).profiles);
});
const flowKey = (tabId) => `flow:${tabId}`;
const locks = new Map();

function serialized(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(work);
  locks.set(key, task);
  task.finally(() => { if (locks.get(key) === task) locks.delete(key); }).catch(() => {});
  return task;
}

async function readFlow(tabId) {
  const key = flowKey(tabId);
  const flow = (await chrome.storage.session.get(key))[key] || null;
  if (flow?.profile && !Institution.libraryFor(flow.profile)) return { ...flow, profile: Institution.normalizeProfile({ ...flow.profile, library: "manual", cas: null }), active: false, phase: "stopped", message: "Install this institution’s pack to continue." };
  return flow;
}

async function writeFlow(tabId, flow) {
  await chrome.storage.session.set({ [flowKey(tabId)]: flow });
}

async function configuration() {
  const { institutions } = await chrome.storage.local.get("institutions");
  if (institutions) return institutions;
  const profiles = [Institution.normalizeProfile(Institution.INSTITUTION)];
  return { selectedId: profiles[0].id, profiles };
}

function usableProfile(profile) {
  // Missing optional libraries cannot use the old credential scope. Read-only
  // fallback leaves their source records intact during unrelated profile edits.
  return Institution.libraryFor(profile) ? profile : Institution.normalizeProfile({ ...profile, library: "manual", cas: null });
}

async function selectedProfile() {
  const config = await configuration();
  return usableProfile(config.profiles.find((profile) => profile.id === config.selectedId));
}

async function settings(profileId) {
  const key = `settings:${profileId}`;
  const value = (await chrome.storage.local.get(key))[key];
  return Institution.sanitizeSettings(value);
}

async function credentialsFor(profile) {
  const key = `credentials:${profile.id}`;
  const credentials = (await chrome.storage.local.get(key))[key];
  return credentials?.scope === Institution.credentialScope(profile) ? credentials : null;
}

async function syncProfileScripts(profiles, packs, strict = false) {
  const installed = packs || await installedPacks();
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const desired = [];
  for (const savedProfile of profiles) {
    const profile = usableProfile(savedProfile);
    const matches = Institution.optionalOrigins(profile);
    if (matches.length && await chrome.permissions.contains({ origins: matches })) {
      desired.push({ id: `institution-profile-${profile.id}`, matches, js: [...InstitutionBundle.scripts, "core.js", "content.js"], runAt: "document_idle", persistAcrossSessions: true });
      if (installed.some((pack) => adapterHost.matchesProfile(pack, profile) && pack.adapter.frames === "all")) desired.push({
        id: `institution-profile-frames-${profile.id}`, matches: [...new Set([...profile.identityOrigins, ...(profile.adapterReturnOrigins || [])])].map((origin) => origin + "/*"), js: ["pack-frame.js"], allFrames: true, runAt: "document_idle", persistAcrossSessions: true
      });
    }
  }
  for (const script of existing.filter((item) => item.id.startsWith("institution-profile-"))) {
    if (!desired.some((item) => item.id === script.id)) await chrome.scripting.unregisterContentScripts({ ids: [script.id] });
  }
  for (const script of desired) {
    if (existing.some((item) => item.id === script.id)) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }
  attachAdapterListener();
  try { await adapterHost.sync(profiles, installed); adapterRegistrationFailed = false; }
  catch { adapterRegistrationFailed = true; if (strict) throw new Error("The institution adapter could not be registered. Check its JavaScript and Allow User Scripts setting."); }
}

function trustedPopup(sender) {
  return !sender.tab && sender.url === chrome.runtime.getURL("popup.html");
}

function trustedPackPage(sender) {
  return sender.url?.split("#")[0] === chrome.runtime.getURL("packs.html") && sender.frameId === 0;
}

async function installedPacks() {
  const { institutionPacks } = await chrome.storage.local.get("institutionPacks");
  return Array.isArray(institutionPacks) ? institutionPacks : [];
}

function packSnapshot(config, packs, id) {
  return JSON.stringify({ profile: config.profiles.find((item) => item.id === id) || null, pack: packs.find((item) => item.id === id) || null });
}

function packJson(value) {
  const json = JSON.stringify(value);
  if (json === undefined || new TextEncoder().encode(json).length > 65536) throw new Error("Pack data must be JSON smaller than 64 KB.");
  return JSON.parse(json);
}
async function packData(id) {
  const key = `packData:${id}`;
  return (await chrome.storage.local.get(key))[key] || { config: {}, state: {} };
}

async function tabContext(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    try {
      const page = await chrome.tabs.sendMessage(tabId, { type: "page:describe" });
      if (page?.url) tab.url = page.url;
    } catch { /* A tab opened before installation needs a refresh. */ }
  }
  return tab;
}

async function wake(tabId) {
  try { await chrome.tabs.sendMessage(tabId, { type: "flow:wake" }); }
  catch {
    // A tab already open at installation may not have its declarative script yet.
    await chrome.scripting.executeScript({ target: { tabId }, files: [...InstitutionBundle.scripts, "core.js", "content.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "flow:wake" });
  }
}

async function handle(message, sender) {
  await ready;
  const packPage = trustedPackPage(sender);
  if (packPage && !["packs:state", "pack:preview", "pack:install", "pack:export", "pack:remove", "pack:select", "pack:runtime", "pack:configure", "pack:configure-save"].includes(message.type)) throw new Error("Use the extension popup for that setting.");
  if (trustedPopup(sender) || packPage) {
    if (["pack:configure", "pack:configure-save"].includes(message.type)) {
      const pack = (await installedPacks()).find((item) => item.id === message.profileId && item.adapter?.apiVersion === 2);
      const profile = (await configuration()).profiles.find((item) => item.id === message.profileId);
      if (!pack || !adapterHost.matchesProfile(pack, profile)) throw new Error("Install this institution's current adapter before configuring it.");
      return serialized(`pack-data:${pack.id}`, async () => {
        const data = await packData(pack.id);
        if (message.type === "pack:configure") return { ok: true, pack, config: data.config, revision: JSON.stringify(data.config) };
        if (message.digest !== pack.adapter.digest || message.revision !== JSON.stringify(data.config)) throw new Error("The pack or settings changed. Reopen its setup screen.");
        await chrome.storage.local.set({ [`packData:${pack.id}`]: { ...data, config: packJson(message.config) } });
        return { ok: true };
      });
    }
    if (message.type === "packs:state") {
      const config = await configuration();
      const packs = await installedPacks();
      return { ok: true, ...config, runtimeAvailable: await adapterHost.available(), packs: packs.filter((pack) => config.profiles.some((profile) => profile.id === pack.id)).map((pack) => ({
        id: pack.id, version: pack.version, maintainer: pack.maintainer, executable: pack.formatVersion === 2, configurable: pack.adapter?.apiVersion === 2,
        modified: JSON.stringify(config.profiles.find((profile) => profile.id === pack.id)) !== JSON.stringify(pack.institution)
      })) };
    }
    if (message.type === "pack:runtime") {
      await syncProfileScripts((await configuration()).profiles);
      return { ok: true, available: await adapterHost.available(), registrationFailed: adapterRegistrationFailed };
    }
    if (message.type === "pack:preview") {
      const pack = message.pack ? await InstitutionPacks.prepare(message.pack) : InstitutionPacks.parse(message.text);
      const config = await configuration();
      const packs = await installedPacks();
      return { ok: true, pack, executable: pack.formatVersion === 2, runtimeAvailable: await adapterHost.available(), origins: Institution.optionalOrigins(pack.institution),
        engine: Institution.libraryFor(pack.institution).name,
        replaces: config.profiles.find((profile) => profile.id === pack.id)?.name || null,
        installedVersion: packs.find((item) => item.id === pack.id)?.version || null,
        snapshot: packSnapshot(config, packs, pack.id) };
    }
    if (message.type === "pack:export") {
      const profile = (await configuration()).profiles.find((item) => item.id === message.profileId);
      if (!profile) throw new Error("Choose a saved institution to export.");
      const pack = InstitutionPacks.fromProfile(profile, (await installedPacks()).find((item) => item.id === profile.id));
      return { ok: true, pack: pack.formatVersion === 2 ? await InstitutionPacks.prepare({ ...pack, adapter: { ...pack.adapter, digest: undefined } }) : pack };
    }
    if (message.type === "popup:state") {
      const tab = await tabContext(message.tabId);
      const flow = await readFlow(tab.id);
      const config = await configuration();
      const profile = usableProfile(config.profiles.find((item) => item.id === config.selectedId));
      const credentials = await credentialsFor(profile);
      const origins = Institution.optionalOrigins(profile);
      const { referenceManager } = await chrome.storage.local.get("referenceManager");
      return { ok: true, profile, profiles: config.profiles, packOwned: (await installedPacks()).some((pack) => pack.id === profile.id && pack.adapter?.apiVersion === 2), supported: !!Institution.pageKind(tab.url, profile), provider: Institution.providerFor(tab.url),
        referenceManager: ReferenceManagers.get(referenceManager),
        flow: flow ? { ...flow, active: Institution.isActive(flow) && Institution.isAllowedHop(tab.url, flow) } : null,
        settings: await settings(profile.id), hasCredentials: !!credentials?.username && !!credentials?.password,
        hostAccess: !origins.length || await chrome.permissions.contains({ origins }) };
    }
    if (message.type === "reference-manager:select") {
      if (!ReferenceManagers.valid(message.managerId)) throw new Error("Choose an available reference manager.");
      await chrome.storage.local.set({ referenceManager: message.managerId });
      return { ok: true };
    }
    if (["profile:save", "pack:install"].includes(message.type)) {
      const pack = message.type === "pack:install" ? await InstitutionPacks.prepare(message.pack) : null;
      const profile = pack ? pack.institution : Institution.normalizeProfile(message.profile);
      const origins = Institution.optionalOrigins(profile);
      if (origins.length && !await chrome.permissions.contains({ origins })) throw new Error("Allow access to this institution’s configured hosts before saving.");
      const config = await configuration();
      const packs = await installedPacks();
      if (pack && message.snapshot !== packSnapshot(config, packs, pack.id)) throw new Error("This institution changed after review. Drop the pack again to review its current settings.");
      if (pack?.formatVersion === 2 && !await adapterHost.available()) throw new Error("Enable Allow User Scripts for in-stitution in the browser’s extension Details, then check again and install.");
      const previous = config.profiles.find((item) => item.id === profile.id);
      const profiles = [...config.profiles.filter((item) => item.id !== profile.id && item.id !== "unconfigured"), profile];
      if (profiles.length > 20) throw new Error("Save at most 20 institution profiles.");
      const updatedPacks = pack ? [...packs.filter((item) => item.id !== pack.id), pack] : packs;
      try { await syncProfileScripts(profiles, updatedPacks, pack?.formatVersion === 2); }
      catch (error) { await syncProfileScripts(config.profiles, packs); throw error; }
      if (previous && Institution.credentialScope(previous) !== Institution.credentialScope(profile)) {
        await chrome.storage.local.remove(`credentials:${profile.id}`);
        await chrome.storage.local.remove(`settings:${profile.id}`);
      }
      await chrome.storage.local.set({ institutions: { selectedId: profile.id, profiles },
        ...(pack ? { institutionPacks: updatedPacks } : {}) });
      return { ok: true };
    }
    if (["profile:select", "pack:select"].includes(message.type)) {
      const config = await configuration();
      if (!config.profiles.some((profile) => profile.id === message.profileId)) throw new Error("Choose a saved institution.");
      await chrome.storage.local.set({ institutions: { ...config, selectedId: message.profileId } });
      return { ok: true };
    }
    if (["profile:remove", "pack:remove"].includes(message.type)) {
      const config = await configuration();
      const profiles = config.profiles.filter((profile) => profile.id !== message.profileId);
      if (!profiles.length) profiles.push(Institution.normalizeProfile(Institution.INSTITUTION));
      await syncProfileScripts(profiles);
      await serialized(`pack-data:${message.profileId}`, async () => {
        await chrome.storage.local.remove(`credentials:${message.profileId}`);
        await chrome.storage.local.remove(`settings:${message.profileId}`);
        await chrome.storage.local.remove(`packData:${message.profileId}`);
        await chrome.storage.local.set({ institutions: { selectedId: profiles.some((item) => item.id === config.selectedId) ? config.selectedId : profiles[0].id, profiles },
          institutionPacks: (await installedPacks()).filter((pack) => pack.id !== message.profileId) });
      });
      return { ok: true };
    }
    if (message.type === "flow:start") {
      const tab = await tabContext(message.tabId);
      const profile = await selectedProfile();
      if (profile.id === "unconfigured") throw new Error("Install your institution pack or choose an institution first.");
      const origins = Institution.optionalOrigins(profile);
      if (origins.length && !await chrome.permissions.contains({ origins })) throw new Error("Save this institution again to restore access to its login hosts.");
      const flow = Institution.createFlow(tab.url, Date.now(), crypto.randomUUID(), profile);
      await writeFlow(tab.id, flow);
      try { await wake(tab.id); }
      catch {
        await writeFlow(tab.id, { ...flow, active: false, phase: "stopped", message: "Reload this page, then try again." });
        throw new Error("Reload this page, then try again.");
      }
      return { ok: true };
    }
    if (message.type === "flow:stop") {
      const flow = await readFlow(message.tabId);
      if (flow) await writeFlow(message.tabId, { ...flow, active: false, userStopped: true, phase: "stopped", message: "Sign-in helper stopped." });
      await chrome.tabs.sendMessage(message.tabId, { type: "flow:stop" }).catch(() => {});
      if (flow?.profile.library === "executable-pack") await adapterHost.stop(message.tabId, flow.profile, await installedPacks());
      return { ok: true };
    }
    if (message.type === "settings:save") {
      const profile = await selectedProfile();
      if (message.profileId && message.profileId !== profile.id) throw new Error("The selected institution changed. Try again.");
      await chrome.storage.local.set({ [`settings:${profile.id}`]: Institution.sanitizeSettings(message.settings) });
      return { ok: true };
    }
    if (message.type === "credentials:save") {
      const profile = await selectedProfile();
      if (!Institution.libraryFor(profile).supportsCredentials) throw new Error("Configure this institution’s CAS login before saving credentials. Other login methods use your normal browser sign-in.");
      if (message.profileId && message.profileId !== profile.id) throw new Error("The selected institution changed. Try again.");
      const username = typeof message.username === "string" ? message.username.trim() : "";
      const password = typeof message.password === "string" ? message.password : "";
      if (!username || !password || username.length > 200 || password.length > 1000) throw new Error("Enter your university username and password.");
      await chrome.storage.local.set({ [`credentials:${profile.id}`]: { username, password, scope: Institution.credentialScope(profile) } });
      return { ok: true };
    }
    if (message.type === "credentials:clear") {
      const profile = await selectedProfile();
      if (message.profileId && message.profileId !== profile.id) throw new Error("The selected institution changed. Try again.");
      await chrome.storage.local.remove(`credentials:${profile.id}`);
      return { ok: true };
    }
    throw new Error("Unknown extension command.");
  }

  if (message.type === "packs:state" || (typeof message.type === "string" && message.type.startsWith("pack:"))) throw new Error("Open Institution packs in the extension to manage packs.");
  const tabId = sender.tab?.id;
  if (message.type === "adapter:frame-wake") {
    if (tabId === undefined || !sender.documentId || !(sender.frameId > 0)) return { ok: true, available: false };
    const flow = await readFlow(tabId);
    const installed = await installedPacks();
    const pack = installed.find((item) => adapterHost.matchesProfile(item, flow?.profile));
    const origins = flow ? [...flow.profile.identityOrigins, ...(flow.owner === "pack" ? flow.profile.adapterReturnOrigins || [] : [])] : [];
    if (!Institution.isActive(flow) || pack?.adapter.frames !== "all" || !origins.includes(Institution.parseUrl(sender.url)?.origin) || !await chrome.permissions.contains({ origins: Institution.optionalOrigins(flow.profile) })) return { ok: true, available: false };
    return { ok: true, available: await adapterHost.wake(tabId, sender.documentId, flow.profile, installed) };
  }
  if (tabId === undefined || sender.frameId !== 0) throw new Error("Page not authorized.");
  if (message.type === "article:download") throw new Error("Save with your reference manager. Reload this page to remove the older PDF helper.");
  let flow = await readFlow(tabId);
  if (message.type === "page:state" && !flow?.userStopped && (!flow || (flow.active && flow.owner !== "pack" && flow.expiresAt <= Date.now()) || !Institution.isAllowedHop(sender.url, flow))) {
    const profile = await selectedProfile();
    const prefs = await settings(profile.id);
    if (profile.id !== "unconfigured" && Institution.providerFor(sender.url) && prefs.autoStart) {
      const origins = Institution.optionalOrigins(profile);
      if (!origins.length || await chrome.permissions.contains({ origins })) {
        flow = Institution.createFlow(sender.url, Date.now(), crypto.randomUUID(), profile);
        await writeFlow(tabId, flow);
      }
    }
  }
  if (flow && !Institution.pageKind(sender.url, flow.profile)) throw new Error("Page not authorized.");
  if (!Institution.isActive(flow)) return { ok: true, active: false };
  if (!Institution.isAllowedHop(sender.url, flow)) {
    await writeFlow(tabId, { ...flow, active: false, phase: "stopped", message: "Ready to start a new sign-in on this site." });
    return { ok: true, active: false };
  }

  // Once handed off, only the institution adapter owns decisions and completion.
  if (flow.owner === "pack" && !["page:state", "page:stop", "adapter:wake"].includes(message.type)) return { ok: true, active: true };

  if (message.type === "page:stop") {
    await writeFlow(tabId, { ...flow, active: false, userStopped: true, phase: "stopped", message: "Sign-in helper stopped." });
    if (flow.profile.library === "executable-pack") await adapterHost.stop(tabId, flow.profile, await installedPacks());
    return { ok: true, active: false };
  }

  if (message.type === "page:error") {
    await writeFlow(tabId, { ...flow, active: false, phase: "stopped", message: "The helper could not continue on this page. Try again or continue manually." });
    return { ok: true, active: false };
  }

  if (message.type === "page:provider-error" && Institution.providerFor(sender.url)) {
    await writeFlow(tabId, { ...flow, active: false, phase: "provider-error", message: "The publisher returned an error. Continue manually or try again later." });
    return { ok: true, active: false };
  }

  if (message.type === "page:remote-unavailable" && Institution.providerFor(sender.url)) {
    await writeFlow(tabId, { ...flow, active: false, phase: "remote-unavailable", message: "This provider offers no remote login for the selected institution. Check your library’s access instructions." });
    return { ok: true, active: false };
  }

  if (message.type === "page:access-present" && Institution.pageKind(sender.url, flow.profile) === "provider" && (Institution.isResearchPage(sender.url) || flow.visitedIdentity)) {
    await writeFlow(tabId, { ...flow, active: false, phase: "access-present", message: `This page already shows institutional access for ${flow.profile.shortName}. Continue reading on the publisher’s page.` });
    return { ok: true, active: false };
  }

  if (message.type === "adapter:wake") {
    if (!await adapterHost.available()) return { ok: true, available: false, message: "Enable Allow User Scripts for in-stitution in browser Details, then start a fresh login." };
    const origin = Institution.parseUrl(sender.url)?.origin;
    const adapterOrigins = [...flow.profile.identityOrigins, ...(flow.owner === "pack" ? flow.profile.adapterReturnOrigins || [] : [])];
    if (!sender.documentId || !adapterOrigins.includes(origin)) return { ok: true, available: false };
    const current = await chrome.tabs.sendMessage(tabId, { type: "page:route-check", flowId: flow.id }, { documentId: sender.documentId }).catch(() => null);
    if (!current?.active || !adapterOrigins.includes(Institution.parseUrl(current.url)?.origin)) return { ok: true, available: false };
    return { ok: true, available: await adapterHost.wake(tabId, sender.documentId, flow.profile, await installedPacks()) };
  }
  if (message.type === "page:route") {
    if ((await settings(flow.profile.id)).browserOnly || !sender.documentId) return { ok: true, active: true };
    // Chrome can retain the injected document's original sender URL after an
    // SPA changes its query. Bind its current URL to the same origin/document.
    const value = message.url ?? sender.url;
    const source = Institution.parseUrl(value);
    if (!source || source.origin !== Institution.parseUrl(sender.url)?.origin) return { ok: true, active: true };
    const route = InstitutionRoutes.plan(value, flow);
    if (!route || flow.routeAttempts?.includes(route.id) || flow.steps + 1 >= Institution.LIMITS.maxSteps) return { ok: true, active: true };
    // Bind navigation to the still-current document and journey, including Stop.
    const current = await chrome.tabs.sendMessage(tabId, { type: "page:route-check", flowId: flow.id }, { documentId: sender.documentId }).catch(() => null);
    if (!current?.active || current.url !== value) return { ok: true, active: true };
    flow.routeAttempts = [...(flow.routeAttempts || []), route.id];
    flow.steps += 1;
    flow.phase = "institution";
    flow.message = `Opening ${flow.profile.shortName} sign-in directly…`;
    await writeFlow(tabId, flow);
    try { await chrome.tabs.update(tabId, { url: route.url }); }
    catch {
      // Consume the attempt even on failure so the DOM fallback cannot loop.
      flow.message = "Continuing with the page’s institutional sign-in controls.";
      await writeFlow(tabId, flow);
      return { ok: true, active: true };
    }
    return { ok: true, active: true, navigating: true };
  }

  if (message.type === "page:state") {
    const kind = Institution.pageKind(sender.url, flow.profile);
    if (kind === "login" || kind === "identity") {
      flow.visitedIdentity = true;
      await writeFlow(tabId, flow);
    } else if (kind === "discovery") {
      flow.visitedDiscovery = true;
      await writeFlow(tabId, flow);
    } else if (flow.owner !== "pack" && kind === "provider" && Institution.isResearchPage(sender.url) && (flow.visitedIdentity || flow.visitedDiscovery)) {
      flow.active = false;
      flow.phase = "returned";
      flow.message = "Returned to the publisher. Check the page for institutional access.";
      await writeFlow(tabId, flow);
      return { ok: true, active: false };
    }
    return { ok: true, active: true, flow, settings: await settings(flow.profile.id) };
  }
  if (message.type === "page:progress") {
    const allowed = ["discovering", "institution", "credentials", "consent", "manual"];
    if (!allowed.includes(message.phase)) throw new Error("Unknown sign-in stage.");
    flow.phase = message.phase;
    if (message.action && message.handoff === true && sender.documentId) flow.handoffDocumentId = sender.documentId;
    // Never persist arbitrary page content, URLs, usernames, or passwords.
    flow.message = ({ discovering: "Opening institutional sign-in…", institution: `Selecting ${flow.profile.shortName}…`,
      credentials: `Continue at the ${flow.profile.shortName} login page.`, consent: "Review the university attribute release page.",
      manual: "Continue on the page. The helper will follow supported sign-in steps." })[message.phase];
    if (message.action) flow.steps += 1;
    if (flow.steps >= Institution.LIMITS.maxSteps) { flow.active = false; flow.message = "Step limit reached. You can continue manually."; }
    await writeFlow(tabId, flow);
    return { ok: true, active: flow.active };
  }
  if (["auth:credentials", "cas:credentials"].includes(message.type)) {
    if (!Institution.isCredentialPage(sender.url, flow.profile) || flow.casAttempted) return { ok: true };
    const credentials = await credentialsFor(flow.profile);
    return { ok: true, credentials: credentials ? { username: credentials.username, password: credentials.password } : null };
  }
  if (["auth:submit", "cas:submit"].includes(message.type)) {
    if (!Institution.isCredentialPage(sender.url, flow.profile) || flow.casAttempted || !(await settings(flow.profile.id)).autoSubmit) return { ok: true, allowed: false };
    flow.casAttempted = true;
    await writeFlow(tabId, flow);
    return { ok: true, allowed: true };
  }
  throw new Error("Unknown page command.");
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Journeys serialize per tab; both trusted settings pages share one queue.
  const configurationMessage = trustedPackPage(sender) || (trustedPopup(sender) && !["flow:start", "flow:stop", "popup:state"].includes(message?.type));
  const key = configurationMessage ? "configuration" : sender.tab?.id ?? message?.tabId ?? "configuration";
  const task = serialized(key, () => handle(message || {}, sender));
  task.then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});

async function handleAdapter(message, sender) {
  await ready;
  const tabId = sender.tab?.id;
  const flow = tabId === undefined ? null : await readFlow(tabId);
  const pack = await adapterHost.authenticate(message, sender, await installedPacks(), flow);
  if (!pack) return { ok: true, active: false };
  if (message.operation === "state") {
    const owned = pack.adapter.apiVersion === 2;
    await writeFlow(tabId, { ...flow, visitedIdentity: true, ...(owned ? { owner: "pack", phase: "institution", message: "Your institution adapter is handling sign-in." } : {}) });
    if (owned) await chrome.tabs.sendMessage(tabId, { type: "adapter:handoff", flowId: flow.id }, { frameId: 0 }).catch(() => {});
    return { ok: true, active: true, flowId: flow.id, entryUrl: flow.entryUrl, pageRole: flow.profile.identityOrigins.includes(Institution.parseUrl(sender.url)?.origin) ? "identity" : "return", researchPage: Institution.isResearchPage(sender.url), expiresAt: owned ? null : flow.expiresAt, profile: flow.profile, settings: await settings(flow.profile.id),
      ...(owned ? { config: (await packData(pack.id)).config } : {}) };
  }
  if (pack.adapter.apiVersion === 2 && message.operation === "storage") return serialized(`pack-data:${pack.id}`, async () => {
    if (!(await installedPacks()).some((item) => adapterHost.matchesProfile(item, flow.profile))) return { ok: true, active: false };
    const data = await packData(pack.id);
    if (message.action === "get") return { ok: true, active: true, value: data.state };
    if (message.action !== "set") throw new Error("Unknown pack storage operation.");
    await chrome.storage.local.set({ [`packData:${pack.id}`]: { ...data, state: packJson(message.value) } });
    return { ok: true, active: true };
  });
  if (pack.adapter.apiVersion === 2 && message.operation === "page-run") {
    packJson(message.args);
    return { pageJob: true, flowId: flow.id, source: message.source, args: message.args };
  }
  if (pack.adapter.apiVersion === 2 && message.operation === "request") {
    const origin = Institution.parseUrl(message.url)?.origin;
    if (![...flow.profile.identityOrigins, ...pack.adapter.networkOrigins].includes(origin)) throw new Error("The API site was not declared by this pack.");
    packJson(message.options ?? {});
    return { requestJob: true, flowId: flow.id, url: message.url, options: message.options ?? {} };
  }
  if (pack.adapter.apiVersion === 2 && message.operation === "step") return { ok: true, active: true };
  if (message.operation === "step") return handle({ type: "page:progress", phase: "institution", action: true }, sender);
  if (message.operation === "notice") {
    if (typeof message.message !== "string" || message.message.length > 240) throw new Error("Invalid adapter notice.");
    await chrome.tabs.sendMessage(tabId, { type: "adapter:notice", flowId: flow.id, message: message.message }, sender.frameId > 0 ? { frameId: 0 } : { documentId: sender.documentId }).catch(() => {});
    return { ok: true, active: true };
  }
  if (message.operation === "navigate") {
    if (!Institution.isAllowedHop(message.url, flow)) throw new Error("The adapter navigation is outside its approved sites.");
    const current = sender.frameId === 0 ? await chrome.tabs.sendMessage(tabId, { type: "page:route-check", flowId: flow.id }, { documentId: sender.documentId }).catch(() => null) : { active: true };
    if (!current?.active) return { ok: true, active: false };
    const step = pack.adapter.apiVersion === 2 ? { ok: true, active: true } : await handle({ type: "page:progress", phase: "institution", action: true }, sender);
    const frameNavigation = sender.frameId > 0 && message.target !== "tab";
    if (step.active && !frameNavigation) await chrome.tabs.update(tabId, { url: message.url });
    return { ...step, ...(frameNavigation ? { frameNavigation: true } : {}) };
  }
  if (message.operation === "complete" || message.operation === "failed") {
    if (message.returnUrl && !Institution.isAllowedHop(message.returnUrl, flow)) throw new Error("The return page is outside the approved sites.");
    await writeFlow(tabId, { ...flow, active: false, phase: message.operation === "complete" ? "returned" : "stopped",
      message: message.operation === "complete" ? "The institution adapter finished. Check the page for institutional access." : "The institution adapter could not continue. Use the normal sign-in or contact its maintainer." });
    await chrome.tabs.sendMessage(tabId, { type: "flow:stop" }, { documentId: sender.documentId }).catch(() => {});
    await adapterHost.stop(tabId, flow.profile, await installedPacks());
    if (message.operation === "complete" && message.returnUrl) await chrome.tabs.update(tabId, { url: message.returnUrl });
    return { ok: true, active: false };
  }
  throw new Error("This adapter operation is unavailable. Stored credentials and extension settings are not exposed to imported code.");
}

function attachAdapterListener() {
  if (adapterListenerAttached || !chrome.runtime.onUserScriptMessage) return;
  chrome.runtime.onUserScriptMessage.addListener((message, sender, respond) => {
    const task = serialized(sender.tab?.id ?? "untrusted-adapter", () => handleAdapter(message, sender));
    task.then(async (reply) => {
      if (!reply.pageJob && !reply.requestJob) return reply;
      // Do not hold the tab queue while page-owned asynchronous code runs.
      const value = reply.pageJob ? packJson(await adapterHost.pageRun(sender, reply.source, reply.args)) : await adapterHost.request(reply.url, reply.options);
      const current = await readFlow(sender.tab.id);
      return current?.id === reply.flowId && await adapterHost.authenticate(message, sender, await installedPacks(), current) ? { ok: true, active: true, value } : { ok: true, active: false };
    }).then(respond, () => respond({ ok: false, active: false, error: "The institution adapter request was rejected." }));
    return true;
  });
  adapterListenerAttached = true;
}
attachAdapterListener();

const syncGrantedProfiles = () => {
  void serialized("configuration", async () => { await ready; await syncProfileScripts((await configuration()).profiles); }).catch(() => {});
};
chrome.permissions.onRemoved.addListener(syncGrantedProfiles);
chrome.permissions.onAdded.addListener(syncGrantedProfiles);
chrome.runtime.onInstalled?.addListener(syncGrantedProfiles);

chrome.tabs.onRemoved.addListener((tabId) => {
  return serialized(tabId, async () => {
    const data = await chrome.storage.session.get(null);
    for (const key of Object.keys(data).filter((key) => key === flowKey(tabId) || (key.startsWith("adapterDocument:") && data[key].tabId === tabId))) await chrome.storage.session.remove(key);
  }).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== "complete") return;
  void readFlow(tabId).then((flow) => {
    if (Institution.isActive(flow)) return chrome.tabs.sendMessage(tabId, { type: "flow:wake" }).catch(() => {});
  }).catch(() => {});
});
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId === undefined) return;
  // Some publishers open the normal login link in a new tab.
  const inherit = async () => {
    await ready;
    const flow = await readFlow(tab.openerTabId);
    if (Institution.isActive(flow)) await writeFlow(tab.id, { ...flow });
  };
  void inherit().catch(() => {});
});
