/* This code belongs to the institution pack, not the extension bundle. */
InstitutionPack.register(async (ctx) => {
  const portal = JSON.parse(ctx.resources['portal.json']);
  if (location.pathname === portal.entry) {
    await ctx.click('campus-account', document.querySelector('[data-action="campus-account"]'));
  } else if (location.pathname === portal.choice) {
    const realm = ctx.config.account?.realm || 'university';
    await ctx.click('campus-realm', [...document.querySelectorAll('[data-realm]')].find((element) => element.dataset.realm === realm));
  } else if (location.pathname === portal.ready) {
    // Protocol-specific API work stays on this institution's declared origin.
    if (ctx.local.checked) return;
    ctx.local.checked = true;
    // The institution may call its existing page JavaScript and keep its own state.
    const ready = await ctx.page.run(() => window.portalSessionReady === true);
    if (!ready || !ctx.current()) return;
    const reply = await ctx.request(portal.sessionApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ realm: ctx.config.account?.realm || 'university' }) });
    if (!ctx.current() || !reply.ok) return;
    const state = JSON.parse(reply.body);
    if (state.authenticated) {
      await ctx.storage.set({ completed: true, realm: ctx.config.account?.realm || 'university' });
      await ctx.complete({ returnUrl: portal.returnUrl });
    } else await ctx.notice('Complete the normal university account verification.');
  } else {
    await ctx.notice('Use your normal university sign-in, password manager and MFA.');
  }
});
