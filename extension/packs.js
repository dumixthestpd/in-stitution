/* Validate settings packs and executable source packs. Never evaluate source. */
(() => {
  "use strict";
  const core = typeof module !== "undefined" ? require("./core.js") : globalThis.Institution;
  const FORMAT = "in-stitution/institution-pack";
  const MAX_BYTES = 65536;
  function keys(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("This institution pack contains unsupported fields. Check its manifest format.");
  }
  function text(value, max, required = true) {
    if (typeof value !== "string" || (required && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("The institution pack has invalid descriptive fields.");
    return value.trim();
  }
  function normalize(value) {
    if (value?.formatVersion === 2) return executable(value);
    if (new TextEncoder().encode(JSON.stringify(value) || "").length > MAX_BYTES) throw new Error("Choose an institution pack smaller than 64 KB.");
    keys(value, ["format", "formatVersion", "id", "version", "maintainer", "description", "institution"]);
    if (value.format !== FORMAT || value.formatVersion !== 1) throw new Error("This institution pack format is not supported. Ask its maintainer for a compatible pack.");
    const id = text(value.id, 48);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error("The institution pack ID is invalid.");
    const version = text(value.version, 64);
    if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[a-zA-Z0-9.-]{1,24})?$/.test(version)) throw new Error("The institution pack needs a version such as 1.0.0.");
    const maintainer = text(value.maintainer, 120);
    const description = text(value.description ?? "", 500, false);
    keys(value.institution, ["id", "library", "name", "shortName", "aliases", "searchTerm", "carsiSearchTerm", "federation", "entityId", "identityOrigins", "discoveryOrigins", "cas"]);
    if (value.institution.id !== id) throw new Error("The pack and institution IDs must match.");
    const library = value.institution.library;
    if (typeof library !== "string" || !core.libraries().some((item) => item.id === library)) throw new Error("This pack needs a login engine not included in this version. Update in-stitution or ask its maintainer for a compatible pack.");
    if (value.institution.cas != null) keys(value.institution.cas, ["loginUrl", "servicePrefixes"]);
    return { format: FORMAT, formatVersion: 1, id, version, maintainer, description, institution: core.normalizeProfile(value.institution) };
  }
  function parse(source) {
    if (typeof source !== "string" || new TextEncoder().encode(source).length > MAX_BYTES) throw new Error("Choose an institution pack smaller than 64 KB.");
    let value;
    try { value = JSON.parse(source.replace(/^\uFEFF/, "")); } catch { throw new Error("This file is not a valid institution pack. Choose a .institution.json file."); }
    if (value?.formatVersion === 2) throw new Error("Choose the complete .instpack archive for an executable institution adapter.");
    return normalize(value);
  }
  function executable(value) {
    if (new TextEncoder().encode(JSON.stringify(value) || "").length > 2097152) throw new Error("The executable institution pack exceeds its size limit.");
    keys(value, ["format", "formatVersion", "id", "version", "maintainer", "description", "institution", "adapter", "files"]);
    if (value.format !== FORMAT || value.formatVersion !== 2) throw new Error("Unsupported executable institution pack format.");
    const id = text(value.id, 48);
    const version = text(value.version, 64);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(id) || !/^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[a-zA-Z0-9.-]{1,24})?$/.test(version)) throw new Error("Invalid institution pack ID or version.");
    keys(value.adapter, ["apiVersion", "scripts", "resources", "digest", "settings", "networkOrigins", "returnOrigins", "frames"]);
    if (![1, 2].includes(value.adapter.apiVersion) || !/^[a-f0-9]{64}$/.test(value.adapter.digest || "")) throw new Error("The executable adapter needs preparation with a valid source fingerprint.");
    const scripts = value.adapter.scripts;
    if (!Array.isArray(scripts) || !scripts.length || scripts.length > 8 || new Set(scripts).size !== scripts.length || scripts.some((name) => typeof name !== "string" || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.js$/.test(name) || name.split("/").some((part) => part === "." || part === ".."))) throw new Error("List one to eight local JavaScript adapter files.");
    keys(value.files, Object.keys(value.files || {}));
    const files = Object.fromEntries(Object.entries(value.files));
    const resources = value.adapter.resources ?? [];
    if (!Array.isArray(resources) || resources.length > 8 || new Set(resources).size !== resources.length || resources.some((name) => typeof name !== "string" || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*\.(?:json|css|txt|html|js)$/.test(name) || name.split("/").some((part) => part === "." || part === "..") || !Object.hasOwn(files, name))) throw new Error("List valid local supporting resource files.");
    const settings = value.adapter.settings;
    if (settings != null) {
      keys(settings, ["html", "scripts", "styles"]);
      if (!resources.includes(settings.html) || !settings.html.endsWith(".html") || ["scripts", "styles"].some((key) => !Array.isArray(settings[key] ?? []) || (settings[key] || []).length > 8 || new Set(settings[key] || []).size !== (settings[key] || []).length || (settings[key] || []).some((name) => !resources.includes(name) || !name.endsWith(key === "scripts" ? ".js" : ".css")))) throw new Error("Declare the pack's setup HTML, JavaScript and styles as resources.");
    }
    const networkOrigins = value.adapter.networkOrigins ?? [];
    if (!Array.isArray(networkOrigins) || networkOrigins.length > 20 || networkOrigins.some((origin) => { const url = core.parseUrl(origin); return !url || url.origin !== origin; })) throw new Error("Declare exact HTTPS API origins.");
    if (value.adapter.apiVersion === 1 && (settings || networkOrigins.length)) throw new Error("Pack-owned configuration requires adapter API 2.");
    const returnOrigins = value.adapter.returnOrigins ?? [];
    if (!Array.isArray(returnOrigins) || returnOrigins.length > 20 || returnOrigins.some((origin) => { const url = core.parseUrl(origin); return !url || url.origin !== origin; }) || (returnOrigins.length && value.adapter.apiVersion !== 2)) throw new Error("Declare exact HTTPS return origins for API 2.");
    if (value.adapter.frames != null && (value.adapter.apiVersion !== 2 || !["top", "all"].includes(value.adapter.frames))) throw new Error("Choose top or all institution frames for API 2.");
    if (Object.keys(files).some((name) => ![...scripts, ...resources, "README.md", "LICENSE"].includes(name))) throw new Error("The archive contains undeclared files. Include only adapter sources, declared resources and documentation.");
    if (Object.keys(files).length > 19 || Object.entries(files).some(([name, source]) => !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) || name.split("/").some((part) => part === "." || part === "..") || typeof source !== "string" || new TextEncoder().encode(source).length > 262144) || scripts.some((name) => !Object.hasOwn(files, name))) throw new Error("The institution pack has missing or invalid source files.");
    keys(value.institution, ["id", "library", "name", "shortName", "aliases", "searchTerm", "carsiSearchTerm", "federation", "entityId", "identityOrigins", "discoveryOrigins", "cas", "adapterDigest", "adapterOrigins", "adapterReturnOrigins"]);
    if (value.institution.id !== id || value.institution.library !== "executable-pack") throw new Error("Executable packs need a matching institution ID and the executable-pack runtime.");
    if (value.institution.cas != null) keys(value.institution.cas, ["loginUrl", "servicePrefixes"]);
    return { format: FORMAT, formatVersion: 2, id, version, maintainer: text(value.maintainer, 120), description: text(value.description ?? "", 500, false),
      institution: core.normalizeProfile({ ...value.institution, adapterDigest: value.adapter.digest, adapterOrigins: networkOrigins, adapterReturnOrigins: returnOrigins }), adapter: { apiVersion: value.adapter.apiVersion, scripts: [...scripts], resources: [...resources], digest: value.adapter.digest,
        ...(value.adapter.apiVersion === 2 ? { frames: value.adapter.frames || "top", networkOrigins: [...new Set(networkOrigins)], ...(returnOrigins.length ? { returnOrigins: [...new Set(returnOrigins)] } : {}), ...(settings ? { settings: { html: settings.html, scripts: settings.scripts || [], styles: settings.styles || [] } } : {}) } : {}) }, files };
  }
  async function prepare(value) {
    if (value?.formatVersion !== 2) return normalize(value);
    const claimed = value.adapter?.digest;
    const pack = executable({ ...value, adapter: { ...value.adapter, digest: "0".repeat(64) } });
    const input = JSON.stringify({ ...(pack.adapter.apiVersion === 2 ? { apiVersion: 2, settings: pack.adapter.settings, frames: pack.adapter.frames, networkOrigins: pack.adapter.networkOrigins, ...(pack.adapter.returnOrigins?.length ? { returnOrigins: pack.adapter.returnOrigins } : {}) } : {}), scripts: pack.adapter.scripts, resources: pack.adapter.resources, files: Object.entries(pack.files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
      origins: [...pack.institution.identityOrigins].sort(), discovery: [...pack.institution.discoveryOrigins].sort(), cas: pack.institution.cas });
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (claimed && claimed !== digest) throw new Error("The adapter source changed without updating its fingerprint. Rebuild the institution archive.");
    return executable({ ...pack, adapter: { ...pack.adapter, digest } });
  }
  function fromProfile(profile, metadata = {}) {
    if (profile.library === "executable-pack") {
      if (metadata.formatVersion !== 2) throw new Error("Export the complete installed adapter, including its source files.");
      return normalize({ ...metadata, institution: profile });
    }
    return normalize({ format: FORMAT, formatVersion: 1, id: profile.id, version: metadata.version || "1.0.0",
      maintainer: metadata.maintainer || "Local configuration", description: metadata.description || "", institution: profile });
  }
  const api = Object.freeze({ FORMAT, MAX_BYTES, normalize, parse, prepare, fromProfile });
  globalThis.InstitutionPacks = api;
  if (typeof module !== "undefined") module.exports = api;
})();
