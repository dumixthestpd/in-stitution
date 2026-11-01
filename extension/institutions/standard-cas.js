/* global InstitutionLibraries, InstitutionAuth */
InstitutionLibraries.register({
  id: "standard-cas", name: "Standard CAS + Shibboleth", supportsCredentials: true,
  validate(profile) { if (!profile.cas) throw new Error("The standard CAS library needs a login URL and service prefixes."); },
  classify(url, profile) {
    if (InstitutionAuth.casPage(url, profile)) return "login";
    return profile.identityOrigins.includes(url.origin) || profile.cas.servicePrefixes.some((prefix) => new URL(prefix).origin === url.origin) ? "identity" : null;
  },
  credentialsAllowed(url, profile, core) { return InstitutionAuth.casCredentials(url, profile, core); },
  login(ctx) { return InstitutionAuth.casLogin(ctx); },
  identity(ctx) { return InstitutionAuth.shibbolethConsent(ctx); }
});
