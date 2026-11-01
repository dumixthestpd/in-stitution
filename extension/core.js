/* Shared by the popup, service worker, content script and Node tests. */
(() => {
  "use strict";

  if (typeof module !== "undefined" && !globalThis.InstitutionLibraries) {
    require("./institutions/catalog.js");
  }

  const SETTINGS = Object.freeze({ autoSubmit: false, autoConsent: false, autoStart: false, browserOnly: false });
  const LIMITS = Object.freeze({ journeyMs: 10 * 60 * 1000, debounceMs: 300, maxSteps: 30 });
  const INSTITUTION = Object.freeze({ id: "unconfigured", library: "manual", name: "Choose your institution", shortName: "Institution", aliases: [], searchTerm: "", carsiSearchTerm: "", federation: "", entityId: "", identityOrigins: [], discoveryOrigins: [], cas: null });
  const PROVIDERS = Object.freeze([
    { id: "wos", name: "Web of Science", home: "https://www.webofscience.com/", domains: ["webofscience.com", "webofknowledge.com", "webofscience.clarivate.cn", "access.clarivate.com", "login.clarivate.com"] },
    { id: "elsevier", name: "ScienceDirect & Scopus", home: "https://www.sciencedirect.com/", domains: ["sciencedirect.com", "scopus.com", "auth.elsevier.com", "id.elsevier.com"] },
    { id: "springer", name: "Springer Nature", home: "https://link.springer.com/", domains: ["link.springer.com", "link.springernature.com", "www.nature.com", "idp.springer.com", "auth.springernature.com", "wayf.springernature.com", "fsso.springer.com", "sp.nature.com", "secure.nature.com", "idp.nature.com"] },
    { id: "wiley", name: "Wiley Online Library", home: "https://onlinelibrary.wiley.com/", domains: ["onlinelibrary.wiley.com", "login.wiley.com"] },
    { id: "ieee", name: "IEEE Xplore", home: "https://ieeexplore.ieee.org/", domains: ["ieeexplore.ieee.org"] },
    { id: "acs", name: "ACS Publications", home: "https://pubs.acs.org/", domains: ["pubs.acs.org"] },
    { id: "rsc", name: "Royal Society of Chemistry", home: "https://pubs.rsc.org/", domains: ["pubs.rsc.org", "www.rsc.org", "shib.rsc.org", "sso.rsc.org"] },
    { id: "cnki", name: "CNKI / 中国知网", home: "https://www.cnki.net/", domains: ["cnki.net"] },
    { id: "taylor", name: "Taylor & Francis", home: "https://www.tandfonline.com/", domains: ["tandfonline.com"] },
    { id: "jstor", name: "JSTOR", home: "https://www.jstor.org/", domains: ["jstor.org"] }
  ]);
  const DISCOVERY_HOSTS = ["ds.carsi.edu.cn", "service.seamlessaccess.org"];
  const STATIC_AUTH_ORIGINS = DISCOVERY_HOSTS.map((host) => `https://${host}`);
  const PROVIDER_AUTH_HOSTS = ["auth.elsevier.com", "id.elsevier.com", "access.clarivate.com", "login.clarivate.com",
    "idp.springer.com", "auth.springernature.com", "wayf.springernature.com", "fsso.springer.com", "sp.nature.com", "secure.nature.com", "idp.nature.com", "login.wiley.com",
    "shib.rsc.org", "sso.rsc.org", "shib.sso.rsc.org", "fsso.cnki.net"];

  function parseUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hostname.includes("*") ? url : null;
    } catch { return null; }
  }

  function domainMatches(host, domain) {
    return host === domain || host.endsWith(`.${domain}`);
  }

  function providerFor(value) {
    const url = parseUrl(value);
    return url ? PROVIDERS.find((provider) => provider.domains.some((domain) => domainMatches(url.hostname, domain))) || null : null;
  }

  function isResearchPage(value) {
    const url = parseUrl(value);
    return !!url && !!providerFor(value) && !PROVIDER_AUTH_HOSTS.includes(url.hostname) &&
      !(url.hostname === "www.scopus.com" && ["/pages/error", "/pages/checkAccess", "/shibboleth"].includes(url.pathname)) &&
      !(["webofknowledge.com", "www.webofknowledge.com"].includes(url.hostname) && url.pathname === "/") &&
      !/^\/(?:Shibboleth\.sso(?:\/|$)|SAML\/|FederatedAccess\/|ExternalAuthentication\/|institutional-login(?:\/|$)|institutionSearch(?:\/|$)|action\/(?:ssostart|showLogin)(?:\/|$)|servlet\/wayf\.jsp|wos\/static\/html\/login-splash\/)/i.test(url.pathname);
  }

  function normalizeProfile(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter an institution profile object.");
    const text = (key, required = false) => {
      const result = typeof value[key] === "string" ? value[key].trim() : "";
      if ((required && !result) || result.length > 240) throw new Error(`Invalid institution ${key}.`);
      return result;
    };
    const id = text("id", true);
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw new Error("Profile ID must start with a letter and contain only lowercase letters, numbers, and hyphens (48 characters maximum).");
    const name = text("name", true);
    const shortName = text("shortName") || name;
    const aliases = value.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.length > 20 || aliases.some((alias) => typeof alias !== "string" || !alias.trim() || alias.length > 240)) throw new Error("Aliases must be a list of at most 20 nonempty names.");
    const origins = (items) => {
      if (!Array.isArray(items) || items.length > 20) throw new Error("Institution hosts must be a list of HTTPS origins.");
      return [...new Set(items.map((item) => {
        const url = parseUrl(item);
        if (!url || url.pathname !== "/" || url.search || url.hash) throw new Error("Institution hosts must be exact HTTPS origins, such as https://login.example.edu.");
        return url.origin;
      }))];
    };
    const entityId = text("entityId");
    if (entityId && !parseUrl(entityId)) throw new Error("The institution entity ID must be an HTTPS URL.");
    let cas = null;
    if (value.cas != null) {
      const login = parseUrl(value.cas.loginUrl);
      if (!login || login.search || login.hash || login.pathname === "/") throw new Error("CAS login URL must be an exact HTTPS page without query parameters.");
      const prefixes = value.cas.servicePrefixes;
      if (!Array.isArray(prefixes) || !prefixes.length || prefixes.length > 20) throw new Error("CAS needs at least one allowed service URL prefix.");
      cas = { loginUrl: login.href, servicePrefixes: [...new Set(prefixes.map((prefix) => {
        const url = parseUrl(prefix);
        if (!url || url.search || url.hash || !url.pathname.endsWith("/")) throw new Error("CAS service prefixes must be HTTPS URLs ending in /.");
        return url.href;
      }))] };
    }
    const library = text("library") || "manual";
    if (!InstitutionLibraries.get(library)) throw new Error(`Institution library '${library}' is not bundled. Install a reviewed library before using this profile.`);
    const profile = { id, library, name, shortName, aliases: [...new Set(aliases.map((alias) => alias.trim()))],
      searchTerm: text("searchTerm") || name, carsiSearchTerm: text("carsiSearchTerm") || text("searchTerm") || name,
      federation: text("federation"), entityId, identityOrigins: origins(value.identityOrigins ?? []),
      discoveryOrigins: origins(value.discoveryOrigins ?? []), cas };
    if (library === "executable-pack") {
      profile.adapterDigest = typeof value.adapterDigest === "string" ? value.adapterDigest : "";
      if (value.adapterOrigins?.length) profile.adapterOrigins = origins(value.adapterOrigins);
      if (value.adapterReturnOrigins?.length) profile.adapterReturnOrigins = origins(value.adapterReturnOrigins);
    }
    libraryFor(profile).validate(profile);
    return profile;
  }

  function libraryFor(profile) { return InstitutionLibraries.get(profile.library || "manual"); }

  function profileOrigins(profile) {
    return [...new Set([...profile.identityOrigins, ...profile.discoveryOrigins, ...(profile.adapterOrigins || []), ...(profile.adapterReturnOrigins || []),
      ...(profile.cas ? [new URL(profile.cas.loginUrl).origin, ...profile.cas.servicePrefixes.map((prefix) => new URL(prefix).origin)] : [])])];
  }

  function optionalOrigins(profile) {
    return profileOrigins(profile).filter((origin) => profile.library === "executable-pack" || !STATIC_AUTH_ORIGINS.includes(origin)).map((origin) => `${origin}/*`);
  }

  function credentialScope(profile) {
    return JSON.stringify({ library: profile.library, cas: profile.cas ? { loginUrl: profile.cas.loginUrl, servicePrefixes: [...profile.cas.servicePrefixes].sort() } : null, identityOrigins: [...profile.identityOrigins].sort(), ...(profile.adapterDigest ? { adapterDigest: profile.adapterDigest } : {}) });
  }

  function pageKind(value, profile = INSTITUTION) {
    const url = parseUrl(value);
    if (!url) return null;
    const route = libraryFor(profile).classify(url, profile, api);
    if (route) return route;
    if (DISCOVERY_HOSTS.includes(url.hostname) || profile.discoveryOrigins.includes(url.origin)) return "discovery";
    if (profile.adapterReturnOrigins?.includes(url.origin) && !providerFor(value)) return "return";
    return providerFor(value) ? "provider" : null;
  }

  function isAllowedHop(value, flow) {
    const url = parseUrl(value);
    if (!url) return false;
    const profile = flow?.profile || INSTITUTION;
    if (DISCOVERY_HOSTS.includes(url.hostname) || profileOrigins(profile).includes(url.origin)) return true;
    const provider = providerFor(value);
    return !!provider && (!flow?.providerId || provider.id === flow.providerId);
  }

  function isInstitution(value, profile = INSTITUTION) {
    const normalize = (name) => String(name).normalize("NFKC").replace(/&/g, "and").replace(/\s+/g, " ").trim().toLowerCase();
    const label = normalize(value);
    const libraryAliases = libraryFor(profile)?.preset?.aliases || [];
    return [profile.name, profile.shortName, ...profile.aliases, ...libraryAliases].filter(Boolean).some((alias) => {
      const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(label);
    });
  }

  function isCredentialPage(value, profile = INSTITUTION) {
    const url = parseUrl(value);
    return !!url && profileOrigins(profile).includes(url.origin) && libraryFor(profile).credentialsAllowed(url, profile, api);
  }

  function isActive(flow, now = Date.now()) {
    return !!flow && flow.active === true && (flow.owner === "pack" || (flow.expiresAt > now && flow.steps < LIMITS.maxSteps));
  }

  function createFlow(value, now = Date.now(), id = "", institution = INSTITUTION) {
    const profile = normalizeProfile(institution);
    if (!pageKind(value, profile)) throw new Error("Open a supported research site or institutional discovery page first.");
    const provider = providerFor(value);
    const entryUrl = isResearchPage(value) ? new URL(value).origin + new URL(value).pathname : null;
    return { id, profile, entryUrl, providerId: provider?.id || null, providerName: provider?.name || "Institutional sign-in", active: true,
      startedAt: now, expiresAt: now + LIMITS.journeyMs, steps: 0, visitedIdentity: false, casAttempted: false,
      phase: "discovering", message: "Looking for institutional sign-in…" };
  }

  function sanitizeSettings(value = {}) {
    return { autoSubmit: value.autoSubmit === true, autoConsent: value.autoConsent === true, autoStart: value.autoStart === true, browserOnly: value.browserOnly === true };
  }

  function parseCredentialFile(text) {
    if (typeof text !== "string" || text.length > 32768) throw new Error("Choose a small credentials file in username:password or JSON format.");
    const content = text.replace(/^\uFEFF/, "").trim();
    let username, password;
    try {
      if (content.startsWith("{")) {
        const value = JSON.parse(content);
        username = value.username ?? value.sid;
        password = value.password ?? value.pwd;
      } else {
        const split = content.indexOf(":");
        if (split < 1 || /[\r\n]/.test(content)) throw new Error();
        username = content.slice(0, split);
        password = content.slice(split + 1);
      }
    } catch { throw new Error("Invalid credentials file. Use one username:password line or a JSON object with username and password."); }
    if (typeof username !== "string" || !username.trim() || username.length > 200 || typeof password !== "string" || !password || password.length > 1000) throw new Error("The credentials file needs a valid username and password.");
    return { username: username.trim(), password };
  }

  const api = { SETTINGS, LIMITS, INSTITUTION, PROVIDERS, libraries: InstitutionLibraries.list, libraryFor, normalizeProfile, profileOrigins, optionalOrigins, credentialScope, parseUrl, domainMatches, providerFor, isResearchPage, pageKind, isAllowedHop,
    isInstitution, isCredentialPage, isCasCredentialPage: isCredentialPage, isActive, createFlow, sanitizeSettings, parseCredentialFile };
  globalThis.Institution = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
