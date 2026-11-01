// Reusable protocols. Institution libraries decide which helpers to use.
(() => {
  "use strict";
  function casPage(url, profile) {
    if (!profile.cas) return false;
    const login = new URL(profile.cas.loginUrl);
    return url.origin === login.origin && url.pathname.replace(/\/$/, "") === login.pathname.replace(/\/$/, "");
  }
  function casCredentials(url, profile, core) {
    if (!casPage(url, profile)) return false;
    const service = core.parseUrl(url.searchParams.get("service"));
    return !!service && profile.cas.servicePrefixes.some((prefix) => {
      const allowed = new URL(prefix);
      return service.origin === allowed.origin && service.pathname.startsWith(allowed.pathname);
    });
  }
  async function casLogin(ctx) {
    const { profile, core, state, all, setInput, send, phase, show, local, current } = ctx;
    await phase("credentials", `Continue at the ${profile.shortName} login page.`);
    if (!current() || !core.isCredentialPage(location.href, profile)) return;
    const username = all('input[name="username"], input#username')[0];
    const password = all('input[name="password"][type="password"], input#password[type="password"]')[0];
    if (!username || !password || local.filled) return;
    const form = password.form;
    if (!form || username.form !== form || form.method.toLowerCase() !== "post") return;
    const action = new URL(form.getAttribute("action") || location.href, location.href);
    if (action.origin !== location.origin || !casPage(action, profile)) return;
    if (password.value || all('.errors, #msg.errors, .alert-danger, [role="alert"]').some((item) => item.textContent.trim())) return;
    if (all('input[name*="captcha" i], input[name*="otp" i], input[autocomplete="one-time-code"]').length) return;
    const reply = await send({ type: "auth:credentials" });
    if (!current() || !reply.credentials) return;
    local.filled = true;
    setInput(username, reply.credentials.username);
    setInput(password, reply.credentials.password);
    reply.credentials.password = "";
    if (!state.settings.autoSubmit) { show("Credentials filled. Review and sign in when ready."); return; }
    const permission = await send({ type: "auth:submit" });
    if (!permission.allowed || !current()) return;
    const submitter = all('button[type="submit"], input[type="submit"]').find((button) => button.form === form);
    HTMLFormElement.prototype.requestSubmit.call(form, submitter);
  }
  async function shibbolethConsent(ctx) {
    await ctx.phase("consent", "Review the information your university will share.");
    if (!ctx.state.settings.autoConsent || !/\/profile\/SAML[^/]*\/.*\/SSO\/?$/.test(location.pathname)) return;
    await ctx.act("consent:proceed", ctx.all('input[type="submit"][name="_eventId_proceed"], button[name="_eventId_proceed"]')[0], "consent");
  }
  globalThis.InstitutionAuth = Object.freeze({ casPage, casCredentials, casLogin, shibbolethConsent });
})();
