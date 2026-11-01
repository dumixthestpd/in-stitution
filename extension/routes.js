/* Worker-side protocol routing. No page DOM, credentials, or network session. */
(() => {
  "use strict";
  const core = typeof module !== "undefined" ? require("./core.js") : globalThis.Institution;
  const singlePolicy = "urn:oasis:names:tc:SAML:profiles:SSO:idp-discovery-protocol:single";
  function navigation(id, endpoint, parameters) {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return { id, url: url.href };
  }

  function plan(value, flow) {
    if (!core.isActive(flow) || !flow.providerId || typeof value !== "string" || value.length > 16384) return null;
    const source = core.parseUrl(value);
    const profile = flow.profile;
    const identity = core.parseUrl(profile.entityId);
    const entityId = profile.entityId;
    if (!source || source.hash || !identity || !profile.identityOrigins.includes(identity.origin) || !core.isAllowedHop(value, flow)) return null;
    const provider = core.PROVIDERS.find((item) => item.id === flow.providerId);
    if (!provider) return null;

    // Publisher SP-init routes verified in a browser. Only fresh
    // content/entry pages qualify; never replace an existing broker transaction.
    const hasTransaction = [...source.searchParams.keys()].some((key) => /^(?:SAMLRequest|SAMLResponse|RelayState|SAMLDS|idp|entityID|return|returnUrl|redirect_uri|code|state|ticket)$/i.test(key));
    if (core.isResearchPage(value) && !hasTransaction) {
      if (provider.id === "springer" && ["link.springer.com", "link.springernature.com"].includes(source.hostname)) {
        return navigation("springer:sp-init", "https://fsso.springer.com/federation/init", { entityId, returnUrl: source.href });
      }
      if (provider.id === "springer" && source.hostname === "www.nature.com") {
        return navigation("nature:sp-init", "https://sp.nature.com/saml/login", { idp: entityId, targetUrl: source.href });
      }
      const entryPage = source.pathname === "/" ||
        (source.hostname === "ieeexplore.ieee.org" && source.pathname === "/Xplore/home.jsp") ||
        (source.hostname === "www.scopus.com" && source.pathname === "/pages/home");
      if (entryPage && !source.search) {
        if (provider.id === "acs" && source.hostname === "pubs.acs.org") {
          return navigation("acs:sp-init", "https://pubs.acs.org/Shibboleth.sso/Login", { entityID: entityId, target: source.href });
        }
        if (provider.id === "rsc" && source.hostname === "pubs.rsc.org") {
          return navigation("rsc:broker-init", "https://pubs.rsc.org/FederatedAccess/FederatedLogin", { returnUrl: source.href });
        }
        if (provider.id === "taylor" && source.hostname === "www.tandfonline.com") {
          return navigation("taylor:sp-init", "https://www.tandfonline.com/action/ssostart", { idp: entityId, redirectUri: source.href });
        }
        if (provider.id === "ieee" && source.hostname === "ieeexplore.ieee.org") {
          return navigation("ieee:sp-init", "https://ieeexplore.ieee.org/servlet/wayf.jsp", { entityId, url: source.href });
        }
        if (provider.id === "wiley" && source.hostname === "onlinelibrary.wiley.com") {
          return navigation("wiley:sp-init", "https://onlinelibrary.wiley.com/action/ssostart", { idp: entityId, redirectUri: source.href });
        }
        if (provider.id === "elsevier" && ["www.sciencedirect.com", "www.scopus.com"].includes(source.hostname)) {
          // Scopus's root processes the federated return before redirecting to
          // /pages/home. Returning straight to the app can leave Preview access.
          const target = source.hostname === "www.sciencedirect.com"
            ? "https://www.sciencedirect.com/user/router/shib?" + new URLSearchParams({ targetURL: source.href }) : "https://www.scopus.com/";
          return navigation("elsevier:sp-init", "https://auth.elsevier.com/ShibAuth/institutionLogin", { entityID: entityId, appReturnURL: target });
        }
      }
    }

    // CNKI's verified SP-init endpoint owns the SAML transaction and return target.
    // Only its entry pages qualify: article/search URLs retain their normal flow.
    if (provider.id === "cnki" && ["www.cnki.net", "fsso.cnki.net"].includes(source.hostname) && source.pathname === "/" && !source.search) {
      const destination = new URL("https://fsso.cnki.net/Shibboleth.sso/Login");
      destination.searchParams.set("entityID", entityId);
      destination.searchParams.set("target", "https://fsso.cnki.net/secure/default.aspx");
      return { id: "cnki:sp-init", url: destination.href };
    }

    // OASIS discovery response: preserve the SP's existing query bytes/state.
    // Unsupported callbacks/policies use the existing discovery-page controls.
    if (source.origin !== "https://ds.carsi.edu.cn" || !["/DS/WAYF", "/login/index.html"].includes(source.pathname)) return null;
    for (const key of ["return", "returnIDParam", "entityID", "policy"]) {
      if (source.searchParams.getAll(key).length > 1) return null;
    }
    if (!source.searchParams.get("entityID")) return null;
    const policy = source.searchParams.get("policy");
    if (policy && policy !== singlePolicy) return null;
    const destination = core.parseUrl(source.searchParams.get("return"));
    const parameter = source.searchParams.get("returnIDParam") || "entityID";
    const callbackHosts = provider.id === "cnki" ? ["fsso.cnki.net"] : provider.domains;
    if (!destination || destination.hash || !["entityID", "idp"].includes(parameter) || destination.searchParams.has(parameter) ||
      !callbackHosts.includes(destination.hostname) || destination.pathname !== "/Shibboleth.sso/Login") return null;
    return { id: "saml:discovery", url: destination.href + (destination.search ? "&" : "?") + parameter + "=" + encodeURIComponent(entityId) };
  }

  const api = Object.freeze({ plan });
  globalThis.InstitutionRoutes = api;
  if (typeof module !== "undefined") module.exports = api;
})();
