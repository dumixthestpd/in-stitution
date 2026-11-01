/* Imported code executes only in USER_SCRIPT worlds, never in the worker. */
(() => {
  "use strict";
  function create({ chrome, core, packs }) {
    async function available() {
      try { await chrome.userScripts.getScripts({ ids: ["institution-runtime-availability"] }); return true; } catch { return false; }
    }
    const worldId = (pack) => `institution-${pack.id}-${pack.adapter.digest.slice(0, 16)}`;
    const matchesProfile = (pack, profile) => pack?.formatVersion === 2 && profile?.library === "executable-pack" && pack.adapter.digest === profile.adapterDigest && core.credentialScope(pack.institution) === core.credentialScope(profile);
    function sources(pack, token) {
      const resources = Object.fromEntries(pack.adapter.resources.map((name) => [name, pack.files[name]]));
      return [{ code: `globalThis.__institutionPackBootstrap=${JSON.stringify({ id: pack.id, digest: pack.adapter.digest, token, resources })};` },
        { file: "pack-runtime.js" }, ...pack.adapter.scripts.map((name) => ({ code: pack.files[name] }))];
    }
    async function sync(profiles, installed) {
      if (!await available()) { await chrome.storage.session.set({ adapterCapabilities: [] }); return false; }
      const existing = await chrome.userScripts.getScripts();
      const { adapterCapabilities = [] } = await chrome.storage.session.get("adapterCapabilities");
      const capabilities = [];
      const desired = [];
      for (const profile of profiles.filter((item) => item.library === "executable-pack")) {
        const stored = installed.find((item) => item.id === profile.id);
        if (!matchesProfile(stored, profile) || !await chrome.permissions.contains({ origins: core.optionalOrigins(profile) })) continue;
        const pack = await packs.prepare(stored);
        const previous = adapterCapabilities.find((item) => item.id === pack.id && item.digest === pack.adapter.digest);
        const token = previous?.token || crypto.randomUUID();
        capabilities.push({ id: pack.id, digest: pack.adapter.digest, token });
        const world = worldId(pack);
        await chrome.userScripts.configureWorld({ worldId: world, messaging: true,
          csp: `script-src 'self'; object-src 'none'; connect-src ${[...profile.identityOrigins, ...(pack.adapter.networkOrigins || [])].join(" ")}` });
        const matches = [...new Set([...profile.identityOrigins, ...(profile.adapterReturnOrigins || [])])].map((origin) => origin + "/*");
        // Register for native parsing/lifecycle, but never inject on mere visits.
        // The trusted worker executes source only for an active, matching flow.
        desired.push({ id: `institution-adapter-${pack.id}`, worldId: world, world: "USER_SCRIPT", matches, excludeMatches: [...matches],
          allFrames: false, runAt: "document_idle", js: sources(pack, token) });
      }
      for (const script of desired) {
        if (existing.some((item) => item.id === script.id)) await chrome.userScripts.update([script]);
        else await chrome.userScripts.register([script]);
      }
      const removed = existing.filter((item) => item.id.startsWith("institution-adapter-") && !desired.some((script) => script.id === item.id)).map((item) => item.id);
      if (removed.length) await chrome.userScripts.unregister({ ids: removed });
      await chrome.storage.session.set({ adapterCapabilities: capabilities });
      return true;
    }
    async function authenticate(message, sender, installed, flow) {
      if (!message || !Number.isInteger(sender.frameId) || sender.frameId < 0 || !sender.documentId || sender.tab?.id === undefined || !core.isActive(flow) || !await available()) return null;
      const pack = installed.find((item) => item.id === message.packId);
      if (sender.frameId !== 0 && pack?.adapter.frames !== "all") return null;
      const url = core.parseUrl(sender.url);
      const origins = [...flow.profile.identityOrigins, ...(flow.owner === "pack" ? flow.profile.adapterReturnOrigins || [] : [])];
      if (!matchesProfile(pack, flow.profile) || !url || !origins.includes(url.origin)) return null;
      if (!await chrome.permissions.contains({ origins: core.optionalOrigins(flow.profile) })) return null;
      const { adapterCapabilities = [] } = await chrome.storage.session.get("adapterCapabilities");
      const capability = adapterCapabilities.find((item) => item.id === pack.id && item.digest === pack.adapter.digest);
      return capability && capability.token === message.token ? pack : null;
    }
    async function wake(tabId, documentId, profile, installed) {
      const pack = installed.find((item) => item.id === profile.id);
      if (!matchesProfile(pack, profile) || !await available()) return false;
      const { adapterCapabilities = [] } = await chrome.storage.session.get("adapterCapabilities");
      const capability = adapterCapabilities.find((item) => item.id === pack.id && item.digest === pack.adapter.digest);
      if (!capability) return false;
      const documentKey = `adapterDocument:${documentId}`;
      const previous = (await chrome.storage.session.get(documentKey))[documentKey];
      if (previous && (previous.id !== pack.id || previous.digest !== pack.adapter.digest)) return false;
      await chrome.storage.session.set({ [documentKey]: { tabId, documentId, id: pack.id, digest: pack.adapter.digest } });
      const target = { tabId, documentIds: [documentId] };
      const world = worldId(pack);
      // Fire-and-forget: imported code may call back into the per-tab queue.
      void chrome.userScripts.execute({ target, world: "USER_SCRIPT", worldId: world,
        js: [{ code: "Boolean(globalThis.InstitutionPack)" }] }).then(async (results) => {
          const key = `flow:${tabId}`;
          const flow = (await chrome.storage.session.get(key))[key];
          const latest = (await chrome.storage.session.get("adapterCapabilities")).adapterCapabilities || [];
          if (!core.isActive(flow) || !matchesProfile(pack, flow.profile) || !latest.some((item) => item.id === pack.id && item.token === capability.token)) return;
          await chrome.userScripts.execute({ target, world: "USER_SCRIPT", worldId: world,
            js: results[0]?.result ? [{ code: "globalThis.InstitutionPack.wake();void 0" }] : sources(pack, capability.token) });
        }).catch(() => {});
      return true;
    }
    async function pageRun(sender, source, args) {
      if (typeof source !== "string" || source.length > 65536) throw new Error("Invalid page script.");
      // Native MAIN execution, pinned to the authenticated document; never eval in the worker.
      const code = `(${source})(...${JSON.stringify(args ?? [])})`;
      const results = await chrome.userScripts.execute({ target: { tabId: sender.tab.id, documentIds: [sender.documentId] }, world: "MAIN", js: [{ code }] });
      if (results[0]?.error) throw new Error("The institution page script failed.");
      return results[0]?.result ?? null;
    }
    async function stop(tabId, profile, installed) {
      const pack = installed.find((item) => item.id === profile.id);
      if (!matchesProfile(pack, profile) || !await available()) return;
      const data = await chrome.storage.session.get(null);
      const documentIds = Object.entries(data).filter(([key, value]) => key.startsWith("adapterDocument:") && value.tabId === tabId && value.id === pack.id && value.digest === pack.adapter.digest).map(([, value]) => value.documentId);
      await Promise.allSettled(documentIds.map((documentId) => chrome.userScripts.execute({ target: { tabId, documentIds: [documentId] }, world: "USER_SCRIPT", worldId: worldId(pack), js: [{ code: "globalThis.InstitutionPack?.stop();void 0" }] })));
    }
    async function request(url, options) {
      const timeout = options.timeoutMs ?? 30000;
      if (!Number.isFinite(timeout) || timeout < 0 || timeout > 2147483647) throw new Error("Invalid request timeout.");
      if (options.redirect !== undefined && !["error", "manual"].includes(options.redirect)) throw new Error("Redirects must stop at the declared API site.");
      const response = await fetch(url, { method: options.method || "GET", headers: options.headers, body: options.body,
        credentials: options.credentials === "omit" ? "omit" : "include", redirect: options.redirect || "error",
        ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}) });
      const reader = response.body?.getReader();
      const chunks = [];
      let length = 0;
      try {
        if (reader) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1048576) throw new Error("The login API response exceeds 1 MB.");
          chunks.push(value);
        }
      } catch (error) { await reader?.cancel().catch(() => {}); throw error; }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { ok: response.ok, status: response.status, ...(response.type === "opaqueredirect" ? { opaqueRedirect: true } : {}), headers: Object.fromEntries(response.headers.entries()), body: new TextDecoder().decode(bytes) };
    }
    return Object.freeze({ available, sync, authenticate, wake, matchesProfile, pageRun, stop, request });
  }
  const api = Object.freeze({ create });
  globalThis.InstitutionAdapterHost = api;
  if (typeof module !== "undefined") module.exports = api;
})();
