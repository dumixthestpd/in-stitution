"use strict";
const byId = (id) => document.getElementById(id);
let pendingPack;
let reviewGeneration = 0;
let busy = false;

function feedback(message, error = false) {
  byId("pack-feedback").textContent = message;
  byId("pack-feedback").classList.toggle("error", error);
}
async function command(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || "The extension could not complete that action. Try again.");
  return reply;
}
function cancelReview() {
  reviewGeneration++;
  pendingPack = null;
  byId("pack-review").hidden = true;
  byId("pack-file").value = "";
}
async function reviewFile(file) {
  if (busy) return;
  cancelReview();
  const generation = reviewGeneration;
  try {
    if (!file || file.size > 2097152) throw new Error("Choose one institution archive smaller than 2 MB.");
    feedback("Reading institution pack…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reply = await command(bytes[0] === 0x50 && bytes[1] === 0x4b
      ? { type: "pack:preview", pack: await InstitutionPackArchive.read(bytes) }
      : { type: "pack:preview", text: await file.text() });
    if (generation !== reviewGeneration) return;
    pendingPack = reply;
    byId("review-name").textContent = reply.pack.institution.name;
    byId("review-description").textContent = reply.pack.description;
    byId("review-version").textContent = reply.pack.version;
    byId("review-maintainer").textContent = reply.pack.maintainer;
    byId("review-engine").textContent = reply.engine;
    byId("review-executable").hidden = !reply.executable;
    byId("review-source").hidden = !reply.executable;
    byId("review-code").textContent = reply.executable ? Object.entries(reply.pack.files).map(([name, source]) => `// ${name}\n${source}`).join("\n\n") : "";
    byId("runtime-help").hidden = !reply.executable || reply.runtimeAvailable;
    byId("review-account").textContent = reply.executable
      ? "Installation selects this institution. The adapter owns its login flow and setup screen. Account details you enter in its setup are shared with this pack."
      : "Installation selects this institution. Configure automatic sign-in and any supported saved credentials separately in the extension.";
    const list = byId("review-origins");
    list.replaceChildren();
    for (const origin of reply.origins) {
      const item = document.createElement("li");
      item.textContent = origin.slice(0, -2);
      list.append(item);
    }
    if (!reply.origins.length) {
      const item = document.createElement("li"); item.textContent = "No additional login sites requested."; list.append(item);
    }
    byId("review-replacement").textContent = reply.replaces
      ? `Replaces saved settings for ${reply.replaces}${reply.installedVersion ? ` (pack ${reply.installedVersion})` : ""}. Changed sign-in configuration clears its saved credentials and automation choices.`
      : "Adds a new institution. Automatic sign-in starts off.";
    byId("install-pack").textContent = reply.replaces ? "Replace and use institution" : "Install institution";
    byId("pack-review").hidden = false;
    feedback("Pack ready. Review the institution and login sites, then install.");
  } catch (error) { if (generation === reviewGeneration) feedback(error.message, true); }
}
byId("pack-file").addEventListener("change", (event) => { void reviewFile(event.target.files[0]); });
byId("choose-pack").addEventListener("click", () => { if (!busy) byId("pack-file").click(); });
document.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? "none" : "copy";
  byId("pack-drop").classList.add("dragging");
});
document.addEventListener("dragleave", (event) => { if (!event.relatedTarget) byId("pack-drop").classList.remove("dragging"); });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  byId("pack-drop").classList.remove("dragging");
  if (busy) return;
  const files = event.dataTransfer?.files;
  if (!files || files.length !== 1) { cancelReview(); feedback("Drop one institution pack at a time.", true); return; }
  void reviewFile(files[0]);
});
byId("cancel-pack").addEventListener("click", () => { if (!busy) { cancelReview(); feedback(""); } });
byId("install-pack").addEventListener("click", async () => {
  if (!pendingPack || busy) return;
  const review = pendingPack;
  busy = true;
  byId("install-pack").disabled = true;
  byId("cancel-pack").disabled = true;
  byId("pack-file").disabled = true;
  byId("choose-pack").disabled = true;
  try {
    // Keep the permission request in this explicit install-button gesture.
    const permissions = { ...(review.origins.length ? { origins: review.origins } : {}), ...(review.executable ? { permissions: ["userScripts"] } : {}) };
    if ((review.origins.length || review.executable) && !await chrome.permissions.request(permissions)) throw new Error("Adapter or site access was not allowed. The institution was not installed.");
    await command({ type: "pack:install", pack: review.pack, snapshot: review.snapshot });
    cancelReview();
    feedback(`${review.pack.institution.name} installed and selected. Open a research page and continue with your institution.`);
    await refresh();
    if (review.pack.adapter?.apiVersion === 2) await InstitutionPackSetup.open(review.pack.id);
  } catch (error) { if (review.executable) byId("runtime-help").hidden = false; feedback(error.message, true); }
  finally {
    busy = false;
    byId("install-pack").disabled = false;
    byId("cancel-pack").disabled = false;
    byId("pack-file").disabled = false;
    byId("choose-pack").disabled = false;
  }
});

async function exportPack(profileId) {
  const { pack } = await command({ type: "pack:export", profileId });
  const executable = pack.formatVersion === 2;
  const url = URL.createObjectURL(new Blob([executable ? InstitutionPackArchive.write(pack) : JSON.stringify(pack, null, 2) + "\n"], { type: executable ? "application/zip" : "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = `${pack.id}.${executable ? "instpack" : "institution.json"}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
byId("runtime-settings").addEventListener("click", () => { void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }).catch(() => feedback("Open this extension’s Details in your browser and enable Allow User Scripts.", true)); });
byId("runtime-check").addEventListener("click", async () => {
  try {
    const state = await command({ type: "pack:runtime" });
    byId("runtime-help").hidden = state.available;
    feedback(state.available ? "Institution adapters are enabled. You can install this pack." : "Enable Allow User Scripts in the extension’s browser Details, then check again.", !state.available);
  } catch (error) { feedback(error.message, true); }
});
async function refresh() {
  const state = await command({ type: "packs:state" });
  const list = byId("installed-packs");
  list.replaceChildren();
  for (const profile of state.profiles) {
    if (profile.id === "unconfigured") continue;
    const pack = state.packs.find((item) => item.id === profile.id);
    const card = document.createElement("article"); card.className = "saved-item";
    const title = document.createElement("h3"); title.textContent = profile.name + (profile.id === state.selectedId ? " · Selected" : "");
    const detail = document.createElement("p");
    detail.textContent = pack ? `Pack ${pack.version} · ${pack.maintainer} · ${pack.executable ? "Executable adapter" : "Settings pack"}${pack.modified ? " · Settings edited locally" : ""}` : "Saved institution · export its settings as a pack";
    const actions = document.createElement("div"); actions.className = "actions";
    if (pack?.configurable) {
      const configure = document.createElement("button"); configure.type = "button"; configure.className = "secondary"; configure.textContent = "Configure institution";
      configure.addEventListener("click", () => { void InstitutionPackSetup.open(profile.id).catch((error) => feedback(error.message, true)); });
      actions.append(configure);
    }
    if (profile.id !== state.selectedId) {
      const selectButton = document.createElement("button"); selectButton.type = "button"; selectButton.className = "secondary"; selectButton.textContent = "Use institution";
      selectButton.addEventListener("click", async () => {
        if (busy) return;
        try { await command({ type: "pack:select", profileId: profile.id }); feedback(`${profile.name} selected.`); await refresh(); }
        catch (error) { feedback(error.message, true); }
      });
      actions.append(selectButton);
    }
    const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "secondary"; exportButton.textContent = "Export pack";
    exportButton.addEventListener("click", () => { void exportPack(profile.id).catch((error) => feedback(error.message, true)); });
    actions.append(exportButton);
    if (profile.id !== "unconfigured") {
      const removeButton = document.createElement("button"); removeButton.type = "button"; removeButton.className = "secondary danger-button"; removeButton.textContent = "Remove institution";
      removeButton.addEventListener("click", async () => {
        try {
          // A second click on a separate control confirms removal of local data.
          if (removeButton.dataset.confirm !== "yes") { removeButton.dataset.confirm = "yes"; removeButton.textContent = "Remove institution and saved login?"; return; }
          if (busy) return;
          await command({ type: "pack:remove", profileId: profile.id });
          InstitutionPackSetup.close();
          feedback("Institution and its saved login settings removed. Existing website sessions remain signed in.");
          await refresh();
        } catch (error) { feedback(error.message, true); }
      });
      actions.append(removeButton);
    }
    card.append(title, detail, actions); list.append(card);
  }
  if (!list.children.length) {
    const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "No institutions installed yet. Drop your institution pack above to get started."; list.append(empty);
  }
}
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void refresh().catch((error) => feedback(error.message, true)); });
void refresh().then(() => {
  const id = location.hash.slice(1);
  if (id) return InstitutionPackSetup.open(id);
}).catch((error) => feedback(error.message, true));
