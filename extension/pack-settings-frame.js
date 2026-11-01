/* This page has an opaque origin and no extension APIs. */
(() => {
  "use strict";
  let initialized = false;
  let hooks;
  let nonce;
  const send = (message) => parent.postMessage({ ...message, nonce }, "*");
  Object.defineProperty(globalThis, "InstitutionPackSettings", { value: Object.freeze({
    register(value) {
      if (!value || typeof value.load !== "function" || typeof value.save !== "function") throw new Error("Provide load(config) and save() setup hooks.");
      hooks = value;
    }
  }) });
  window.addEventListener("message", async (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.type === "pack-settings:init" && !initialized) {
      initialized = true; nonce = message.nonce;
      try {
        const descriptor = message.settings;
        const root = document.getElementById("pack-settings-root");
        if (descriptor) {
          root.innerHTML = message.files[descriptor.html];
          for (const name of descriptor.styles) {
            const style = document.createElement("style"); style.textContent = message.files[name]; document.head.append(style);
          }
          for (const name of descriptor.scripts) {
            const script = document.createElement("script"); script.textContent = message.files[name]; document.body.append(script);
          }
          if (!hooks) throw new Error("The pack did not register its setup screen.");
        } else {
          const label = document.createElement("label"); label.textContent = "Institution configuration (JSON)";
          const input = document.createElement("textarea"); input.rows = 14; input.style.width = "95%";
          root.append(label, input);
          hooks = { load: (config) => { input.value = JSON.stringify(config, null, 2); }, save: () => JSON.parse(input.value) };
        }
        await hooks.load(message.config);
        send({ type: "pack-settings:ready" });
      } catch { send({ type: "pack-settings:error", message: "This pack's setup screen could not load. Contact its maintainer." }); }
    }
    if (initialized && message?.nonce === nonce && message.type === "pack-settings:collect") {
      try { send({ type: "pack-settings:value", config: await hooks.save() }); }
      catch { send({ type: "pack-settings:error", message: "Check the institution settings and try again." }); }
    }
  });
})();
