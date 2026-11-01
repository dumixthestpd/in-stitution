"use strict";
(() => {
  let current;
  let pending;
  let generation = 0;
  const byId = (id) => document.getElementById(id);
  const feedback = (message) => { byId("settings-feedback").textContent = message; };
  async function command(message) {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error(reply?.error || "Could not save institution settings.");
    return reply;
  }
  function close() {
    generation++;
    current = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error("Setup closed.")); pending = null; }
    byId("settings-frame-host").replaceChildren();
    byId("pack-configuration").hidden = true;
  }
  async function open(profileId) {
    close();
    const version = generation;
    const reply = await command({ type: "pack:configure", profileId });
    if (version !== generation) return;
    const frame = document.createElement("iframe");
    frame.title = `${reply.pack.institution.name} setup`;
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.src = "pack-settings-frame.html";
    const view = { frame, reply, nonce: crypto.randomUUID(), loaded: false, ready: false };
    current = view;
    byId("settings-name").textContent = reply.pack.institution.name;
    byId("save-pack-settings").disabled = true;
    feedback("Loading institution setup…");
    frame.addEventListener("load", () => {
      if (current !== view) return;
      if (view.loaded) { close(); return; }
      view.loaded = true;
      frame.contentWindow.postMessage({ type: "pack-settings:init", nonce: view.nonce, settings: reply.pack.adapter.settings,
        files: reply.pack.files, config: reply.config }, "*");
    });
    byId("settings-frame-host").append(frame);
    byId("pack-configuration").hidden = false;
    byId("pack-configuration").scrollIntoView({ block: "nearest" });
  }
  window.addEventListener("message", (event) => {
    if (!current || event.source !== current.frame.contentWindow || event.data?.nonce !== current.nonce) return;
    const message = event.data;
    if (message.type === "pack-settings:ready") { current.ready = true; byId("save-pack-settings").disabled = false; feedback(""); }
    if (message.type === "pack-settings:error") {
      feedback(message.message);
      if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message.message)); pending = null; }
    }
    if (message.type === "pack-settings:value" && pending) { clearTimeout(pending.timer); pending.resolve(message.config); pending = null; }
  });
  byId("cancel-pack-settings").addEventListener("click", close);
  byId("save-pack-settings").addEventListener("click", async () => {
    const view = current;
    if (!view?.ready || pending) return;
    byId("save-pack-settings").disabled = true;
    try {
      const config = await new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => { pending = null; reject(new Error("The institution setup did not respond.")); }, 10000) };
        view.frame.contentWindow.postMessage({ type: "pack-settings:collect", nonce: view.nonce }, "*");
      });
      if (current !== view) return;
      await command({ type: "pack:configure-save", profileId: view.reply.pack.id, digest: view.reply.pack.adapter.digest, revision: view.reply.revision, config });
      view.reply.revision = JSON.stringify(config);
      feedback("Institution settings saved on this browser.");
    } catch (error) { if (current === view) feedback(error.message); }
    finally { if (current === view) byId("save-pack-settings").disabled = false; }
  });
  globalThis.InstitutionPackSetup = Object.freeze({ open, close });
})();
