/* User-installed adapters run only through Chrome's isolated User Scripts API. */
/* global InstitutionLibraries */
InstitutionLibraries.register({
  id: "executable-pack", name: "Institution pack adapter", supportsCredentials: false,
  validate(profile) {
    if (!/^[a-f0-9]{64}$/.test(profile.adapterDigest || "") || !profile.identityOrigins.length) throw new Error("Install a complete executable institution pack to use this login method.");
  },
  classify(url, profile) { return profile.identityOrigins.includes(url.origin) ? "identity" : null; },
  credentialsAllowed() { return false; },
  async login(ctx) { await this.identity(ctx); },
  async identity(ctx) {
    if (ctx.local.adapterRequested) return;
    const reply = await ctx.send({ type: "adapter:wake" });
    if (reply.available) { ctx.local.adapterRequested = true; await ctx.phase("institution", "Your institution adapter is handling this sign-in."); }
    else await ctx.phase("manual", reply.message || "Open a fresh sign-in from the publisher after installing or updating this adapter.");
  }
});
