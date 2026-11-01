/* Fictional example: replace these routes with verified university behavior.
 * Bundle reviewed library code with the extension; JSON imports cannot add code.
 */
InstitutionLibraries.register({
  id: "example-university", name: "Example University · campus portal + OIDC", supportsCredentials: false,
  preset: {
    id: "example-university", library: "example-university", name: "Example University", shortName: "Example U",
    aliases: [], searchTerm: "Example University", carsiSearchTerm: "Example University", federation: "",
    entityId: "", identityOrigins: ["https://login.example.edu"], discoveryOrigins: [], cas: null
  },
  validate(profile) {
    if (!profile.identityOrigins.includes("https://login.example.edu")) throw new Error("Example library needs its campus login origin.");
  },
  classify(url) {
    if (url.origin !== "https://login.example.edu") return null;
    if (url.pathname === "/portal/start") return "login";
    if (url.pathname.startsWith("/oidc/")) return "identity";
    return null;
  },
  credentialsAllowed() { return false; },
  async login(ctx) {
    await ctx.phase("credentials", "Choose your campus account to continue.");
    await ctx.act("example:campus", ctx.all('button[data-action="campus-sso"]')[0], "credentials");
  },
  async identity(ctx) {
    await ctx.phase("manual", "Complete Example University’s account sign-in and MFA on this page.");
  }
});
