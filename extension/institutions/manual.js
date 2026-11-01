/* global InstitutionLibraries */
InstitutionLibraries.register({
  id: "manual", name: "Discovery only · normal university login", supportsCredentials: false,
  validate() {},
  classify(url, profile) { return profile.identityOrigins.includes(url.origin) ? "identity" : null; },
  credentialsAllowed() { return false; },
  async login(ctx) { await ctx.phase("manual", `Sign in with ${ctx.profile.shortName} on this page.`); },
  async identity(ctx) { await this.login(ctx); }
});
