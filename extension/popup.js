/* global Institution, ReferenceManagers */
"use strict";

const byId = (id) => document.getElementById(id);
let tabId;
let refreshing = false;
let selectedInstitution;
let editorId;
let editorDigest;

const profileFields = { id: "profile-id", name: "profile-name", shortName: "profile-short-name", library: "profile-library",
  searchTerm: "profile-search", carsiSearchTerm: "profile-carsi", federation: "profile-federation", entityId: "profile-entity" };
const lines = (id) => byId(id).value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
for (const manager of ReferenceManagers.list()) {
  const option = document.createElement("option");
  option.value = manager.id;
  option.textContent = manager.name;
  byId("reference-manager").append(option);
}
byId("reference-manager").addEventListener("change", async () => {
  try {
    await command({ type: "reference-manager:select", managerId: byId("reference-manager").value });
    feedback("Reference manager selected. Use its native browser controls to save articles.");
  } catch (error) { feedback(error.message, true); }
  await refresh();
});
function fillProfile(profile) {
  byId("profile-form").hidden = false;
  editorId = profile.id || "new";
  editorDigest = profile.adapterDigest;
  for (const [key, id] of Object.entries(profileFields)) byId(id).value = profile[key] || (key === "library" ? "manual" : "");
  for (const [key, id] of [["aliases", "profile-aliases"], ["identityOrigins", "profile-identity"], ["discoveryOrigins", "profile-discovery"]]) byId(id).value = (profile[key] || []).join("\n");
  byId("profile-cas").value = profile.cas?.loginUrl || "";
  byId("profile-services").value = (profile.cas?.servicePrefixes || []).join("\n");
}
function readProfile() {
  const value = Object.fromEntries(Object.entries(profileFields).map(([key, id]) => [key, byId(id).value]));
  return Institution.normalizeProfile({ ...value, ...(value.library === "executable-pack" ? { adapterDigest: editorDigest } : {}), aliases: lines("profile-aliases"), identityOrigins: lines("profile-identity"), discoveryOrigins: lines("profile-discovery"),
    cas: byId("profile-cas").value.trim() ? { loginUrl: byId("profile-cas").value.trim(), servicePrefixes: lines("profile-services") } : null });
}
for (const library of Institution.libraries()) {
  const option = document.createElement("option"); option.value = library.id; option.textContent = library.name;
  byId("profile-library").append(option);
}
byId("change-institution").addEventListener("click", () => { byId("institution-settings").open = true; byId("institution-select").focus(); });
byId("configure-pack").addEventListener("click", () => { void chrome.tabs.create({ url: chrome.runtime.getURL("packs.html") + "#" + selectedInstitution.id }); });
byId("open-packs").addEventListener("click", async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL("packs.html") }); }
  catch { feedback("Open Institution packs from the extension’s Options page.", true); }
});
byId("institution-select").addEventListener("change", async () => {
  try { await command({ type: "profile:select", profileId: byId("institution-select").value }); editorId = null; await refresh(); }
  catch (error) { feedback(error.message, true); }
});
byId("new-profile").addEventListener("click", () => fillProfile({ library: "manual" }));
for (const { preset } of Institution.libraries().filter((library) => library.preset)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-button";
  button.textContent = `Use ${preset.shortName} preset`;
  button.addEventListener("click", () => fillProfile(preset));
  byId("institution-presets").append(button);
}
byId("profile-library").addEventListener("change", () => {
  const library = Institution.libraries().find((item) => item.id === byId("profile-library").value);
  if (library.preset) fillProfile(library.preset);
});
byId("profile-name").addEventListener("input", () => {
  if (editorId === "new") byId("profile-id").value = byId("profile-name").value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
});
byId("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const profile = readProfile();
    const origins = Institution.optionalOrigins(profile);
    // Request in the submit gesture, before any asynchronous message calls.
    if (origins.length && !await chrome.permissions.request({ origins })) throw new Error("Institution host access was not granted. The profile was not saved.");
    await command({ type: "profile:save", profile });
    editorId = null;
    feedback("Institution saved. New sign-ins will use its authentication library.");
    await refresh();
  } catch (error) { feedback(error.message, true); }
});
byId("remove-profile").addEventListener("click", async () => {
  const profileId = selectedInstitution.id;
  const button = byId("remove-profile");
  if (profileId === "unconfigured") return;
  if (button.dataset.confirmFor !== profileId) {
    button.dataset.confirmFor = profileId;
    button.textContent = `Remove ${selectedInstitution.shortName}?`;
    byId("remove-profile-help").hidden = false;
    return;
  }
  button.disabled = true;
  try {
    await command({ type: "profile:remove", profileId });
    editorId = null; feedback("Institution and saved login settings removed."); await refresh();
  } catch (error) { feedback(error.message, true); }
  finally { button.disabled = false; }
});
byId("export-profile").addEventListener("click", () => {
  try {
    const profile = readProfile();
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2) + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${profile.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { feedback(error.message, true); }
});
byId("import-profile").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 20000) throw new Error("Profile JSON must be smaller than 20 KB.");
    fillProfile(Institution.normalizeProfile(JSON.parse(await file.text())));
    feedback("Profile imported into the editor. Review its library and hosts, then save to activate.");
  } catch (error) { feedback(error.message, true); }
  finally { event.target.value = ""; }
});

async function command(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "The extension could not complete this action.");
  return response;
}

function feedback(message, error = false) {
  byId("feedback").textContent = message;
  byId("feedback").classList.toggle("error", error);
}

async function refresh() {
  if (tabId === undefined || refreshing) return;
  refreshing = true;
  try {
    const state = await command({ type: "popup:state", tabId });
    const active = state.flow?.active;
    selectedInstitution = state.profile;
    const profile = state.profile;
    const removeButton = byId("remove-profile");
    removeButton.hidden = profile.id === "unconfigured";
    if (removeButton.dataset.confirmFor !== profile.id) {
      delete removeButton.dataset.confirmFor;
      removeButton.textContent = "Remove institution";
      byId("remove-profile-help").hidden = true;
    }
    const manager = ReferenceManagers.get(state.referenceManager?.id);
    byId("reference-manager").value = manager.id;
    byId("manager-guidance").textContent = ReferenceManagers.guidance(manager.id, state.flow?.phase);
    byId('institution-name').textContent = profile.name;
    byId('institution-subtitle').textContent = profile.shortName;
    byId('institution-monogram').textContent = profile.id === "unconfigured" ? "＋" : [...profile.shortName][0];
    document.querySelector('.institution .check').hidden = profile.id === "unconfigured";
    byId('start-label').textContent = 'Continue with ' + profile.shortName;
    if (profile.id === "unconfigured") byId('start-label').textContent = 'Install your institution pack';
    byId('institution-select').replaceChildren(...state.profiles.map(item => {const option=document.createElement('option'); option.value=item.id;option.textContent=item.name;return option}));
    byId('institution-select').value = profile.id;
    if (!editorId) fillProfile(profile);
    const ownsLogin = state.packOwned === true;
    byId("legacy-auth-settings").hidden = ownsLogin;
    byId("configure-pack").hidden = !ownsLogin;
    byId("profile-form").hidden = ownsLogin;
    const allowsCredentials = Institution.libraryFor(profile).supportsCredentials;
    byId('save-credentials').disabled = !allowsCredentials;
    byId('username').disabled = !allowsCredentials;
    byId('password').disabled = !allowsCredentials;
    byId('auto-submit').disabled = !allowsCredentials;
    byId('credential-help').textContent = allowsCredentials ? 'Optional. Saved separately for this institution, only on this browser, without extension-level encryption.' : 'This library uses your normal university sign-in. Your browser password manager and MFA continue normally.';
    byId("access-title").textContent = state.provider?.name || (state.supported ? "Institutional sign-in" : "Start with a research site");
    byId("availability").textContent = active ? "IN PROGRESS" : state.supported ? "AVAILABLE" : "OPEN A SITE";
    byId("availability").classList.toggle("unsupported", !state.supported);
    byId("site-description").textContent = state.supported
      ? "Continue through your university’s institutional sign-in. Keep your research in this tab."
      : "Open one of the research sites below, then continue with your institution from that page.";
    byId("start").disabled = profile.id !== "unconfigured" && (!state.supported || active);
    byId("stop").hidden = !active;
    byId("status").textContent = (!state.hostAccess ? "Continue to allow access to this institution’s login hosts." : state.flow?.message) || (state.supported ? "Ready when you are. Only runs when you start it." : "Institutional access requires a library subscription.");
    byId("auto-submit").checked = state.settings.autoSubmit;
    byId("auto-consent").checked = state.settings.autoConsent;
    byId("auto-start").checked = state.settings.autoStart;
    byId("browser-only").checked = state.settings.browserOnly === true;
    byId("credential-state").textContent = state.hasCredentials ? "Saved on this browser" : "Not saved";
    byId("clear-credentials").disabled = !state.hasCredentials;
    if (profile.id === "unconfigured") {
      byId("access-title").textContent = "Add your institution";
      byId("availability").textContent = "SET UP";
      byId("site-description").textContent = "Install your institution’s pack to set up university sign-in.";
      byId("status").textContent = "Drop your institution pack into the installer, then follow its setup screen.";
    }
  } catch (error) { feedback(error.message, true); }
  finally { refreshing = false; }
}

byId("start").addEventListener("click", async () => {
  if (selectedInstitution.id === "unconfigured") { await chrome.tabs.create({ url: chrome.runtime.getURL("packs.html") }); return; }
  byId("start").disabled = true;
  try {
    const origins = Institution.optionalOrigins(selectedInstitution);
    if (origins.length && !await chrome.permissions.request({ origins })) throw new Error("Institution host access was not granted.");
    await command({ type: "profile:save", profile: selectedInstitution });
    await command({ type: "flow:start", tabId });
    feedback("Sign-in started. You can close this popup.");
  } catch (error) { feedback(error.message, true); }
  await refresh();
});

byId("stop").addEventListener("click", async () => {
  try { await command({ type: "flow:stop", tabId }); feedback("Sign-in helper stopped."); }
  catch (error) { feedback(error.message, true); }
  await refresh();
});

for (const id of ["auto-submit", "auto-consent", "auto-start", "browser-only"]) {
  byId(id).addEventListener("change", async () => {
    try {
      if (id === "auto-start" && byId(id).checked) {
        const origins = Institution.optionalOrigins(selectedInstitution);
        if (origins.length && !await chrome.permissions.request({ origins })) throw new Error("Institution host access was not granted.");
        await command({ type: "profile:save", profile: selectedInstitution });
      }
      await command({ type: "settings:save", profileId: selectedInstitution.id, settings: { autoSubmit: byId("auto-submit").checked, autoConsent: byId("auto-consent").checked, autoStart: byId("auto-start").checked, browserOnly: byId("browser-only").checked } });
      feedback("Preferences saved.");
    } catch (error) { feedback(error.message, true); }
    await refresh();
  });
}

byId("credentials-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await command({ type: "credentials:save", profileId: selectedInstitution.id, username: byId("username").value, password: byId("password").value });
    byId("credentials-form").reset();
    feedback("Credentials saved locally. They are only released to this institution’s library during a sign-in you start.");
  } catch (error) { feedback(error.message, true); }
  finally { byId("password").value = ""; }
  await refresh();
});

byId("import-credentials").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 32768) throw new Error("Choose a credentials file smaller than 32 KB.");
    const credentials = Institution.parseCredentialFile(await file.text());
    await command({ type: "credentials:save", profileId: selectedInstitution.id, ...credentials });
    credentials.password = "";
    feedback("Credentials imported and saved locally for this institution.");
  } catch (error) { feedback(error.message, true); }
  finally { event.target.value = ""; }
  await refresh();
});

byId("clear-credentials").addEventListener("click", async () => {
  try {
    await command({ type: "credentials:clear", profileId: selectedInstitution.id });
    byId("credentials-form").reset();
    feedback("Saved credentials removed from this browser. Existing university sessions stay signed in.");
  } catch (error) { feedback(error.message, true); }
  await refresh();
});

for (const provider of Institution.PROVIDERS) {
  const link = document.createElement("a");
  link.href = provider.home;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${provider.name} ↗`;
  byId("provider-list").append(link);
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "session" || area === "local") void refresh();
});

void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  tabId = tabs[0]?.id;
  if (tabId === undefined) throw new Error("Open a research site in a browser tab first.");
  return refresh();
}).catch((error) => feedback(error.message, true));
