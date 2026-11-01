// Bundled SDK, injected before imported source in a separate User Script world.
(() => {
  "use strict";
  const bootstrap = globalThis.__institutionPackBootstrap;
  delete globalThis.__institutionPackBootstrap;
  if (!bootstrap) return;
  if (globalThis.InstitutionPack) { globalThis.InstitutionPack.wake(); return; }
  const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  const send = (operation, extra = {}) => nativeSend({ type: "institution-adapter", packId: bootstrap.id, token: bootstrap.token, operation, ...extra });
  let adapter;
  let observer;
  let timer;
  let expiry;
  let running = false;
  let queued = false;
  let generation = 0;
  let controller = new AbortController();
  let flowId;
  let local = {};
  const actions = new Set();
  function stop() { generation++; controller.abort(); observer?.disconnect(); clearTimeout(timer); clearTimeout(expiry); timer = null; }
  function schedule() {
    if (!timer) timer = setTimeout(() => { timer = null; void run(); }, 300);
  }
  async function run() {
    if (!adapter) return;
    if (running) { queued = true; return; }
    running = true;
    try {
      const state = await send("state");
      if (!state.active) { stop(); return; }
      if (flowId !== state.flowId || controller.signal.aborted) {
        stop(); controller = new AbortController(); flowId = state.flowId; local = {}; actions.clear();
        observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        if (state.expiresAt != null) expiry = setTimeout(stop, Math.max(0, state.expiresAt - Date.now()));
      }
      const token = generation;
      const current = () => token === generation && !controller.signal.aborted;
      const step = async (key) => {
        if (!current() || actions.has(key)) return false;
        if (typeof key !== "string" || !key || key.length > 80) throw new Error("Use a short stable action key.");
        const reply = await send("step");
        if (!reply.active || !current()) { stop(); return false; }
        actions.add(key); return true;
      };
      const request = async (operation, extra) => {
        if (!current()) throw new Error("The institution flow has stopped.");
        const reply = await send(operation, extra);
        if (!reply.ok || !reply.active || !current()) throw new Error("The institution request could not continue.");
        return reply.value;
      };
      const context = Object.freeze({ profile: state.profile, settings: state.settings, config: state.config, flowId: state.flowId, pageRole: state.pageRole, researchPage: state.researchPage, entryUrl: state.entryUrl, local, signal: controller.signal, current,
        storage: Object.freeze({ get: () => request("storage", { action: "get" }), set: (value) => request("storage", { action: "set", value }) }),
        page: Object.freeze({ run: (fn, ...args) => request("page-run", { source: fn.toString(), args }) }),
        request: (url, options = {}) => request("request", { url, options }),
        resources: Object.freeze({ ...bootstrap.resources }),
        async click(key, element) {
          if (!element || element.ownerDocument !== document || element.disabled || !element.getClientRects().length) return false;
          if (!await step(key)) return false;
          element.click(); return true;
        },
        async navigate(key, url, options = {}) {
          if (!current() || actions.has(key)) return false;
          const reply = await send("navigate", { url, key, target: options.target });
          if (!reply.active || !current()) return false;
          actions.add(key);
          if (reply.frameNavigation) location.assign(url);
          return true;
        },
        async notice(message) {
          if (current()) await send("notice", { message: String(message).slice(0, 240) });
        },
        async complete(options = {}) { if (current()) await send("complete", { returnUrl: options.returnUrl }); stop(); }
      });
      await adapter(context);
    } catch {
      if (!controller.signal.aborted) void send("failed").catch(() => {});
      stop();
    } finally { running = false; if (queued && !controller.signal.aborted) { queued = false; schedule(); } }
  }
  Object.defineProperty(globalThis, "InstitutionPack", { value: Object.freeze({
    register(runAdapter) { if (typeof runAdapter !== "function") throw new Error("Register an adapter function."); adapter = runAdapter; void run(); },
    wake() { schedule(); }, stop
  }), writable: false, configurable: false });
  window.addEventListener("pagehide", stop);
})();
