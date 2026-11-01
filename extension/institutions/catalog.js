/* Bundle composition only. University behavior stays in its own library. */
(() => {
  "use strict";
  const modules = ["registry.js", "auth.js", "manual.js", "standard-cas.js", "executable.js"];
  const scripts = Object.freeze(modules.map((file) => `institutions/${file}`));
  if (typeof module !== "undefined") {
    for (const file of modules) require(`./${file}`);
  } else if (typeof importScripts === "function") {
    importScripts(...scripts);
  }
  globalThis.InstitutionBundle = Object.freeze({ scripts });
  if (typeof module !== "undefined") module.exports = globalThis.InstitutionBundle;
})();
