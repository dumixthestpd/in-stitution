/* Capture belongs to the native reference manager. No translators or downloads. */
(() => {
  "use strict";
  const managers = Object.freeze([
    Object.freeze({ id: "zotero", name: "Zotero Connector", help: "Use Zotero’s browser toolbar button to save the article and available PDF to your selected Zotero collection." }),
    Object.freeze({ id: "endnote", name: "EndNote Click", help: "Use EndNote Click’s native viewer and export controls to save to EndNote or another reference manager." }),
    Object.freeze({ id: "none", name: "Other / sign-in only", help: "Once institutional access is available, save with your preferred reference manager." })
  ]);
  function get(id = "zotero") { return managers.find((manager) => manager.id === id) || managers[0]; }
  function guidance(id, phase) {
    const manager = get(id);
    const prefix = phase === "access-present" ? "This page shows institutional access. " : phase === "returned" ? "Check institutional access on the returned page. " : "in-stitution handles institutional sign-in. ";
    return prefix + manager.help;
  }
  const api = Object.freeze({ list: () => managers, get, valid: (id) => managers.some((manager) => manager.id === id), guidance });
  globalThis.ReferenceManagers = api;
  if (typeof module !== "undefined") module.exports = api;
})();
