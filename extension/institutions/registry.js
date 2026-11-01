(() => {
  "use strict";
  const libraries = new Map();
  globalThis.InstitutionLibraries = Object.freeze({
    register(library) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(library.id) || libraries.has(library.id)) throw new Error("Invalid or duplicate institution library.");
      for (const method of ["classify", "credentialsAllowed", "login", "identity", "validate"]) {
        if (typeof library[method] !== "function") throw new Error(`Institution library needs ${method}().`);
      }
      libraries.set(library.id, Object.freeze(library));
    },
    get(id) { return libraries.get(id); },
    list() { return [...libraries.values()].map(({ id, name, supportsCredentials, preset }) => ({ id, name, supportsCredentials, preset })); },
    async migrate(storage, core) {
      for (const library of libraries.values()) await library.migrate?.(storage, core);
    }
  });
})();
