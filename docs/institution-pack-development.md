# Institution Pack Developer Guide

An institution pack is a separate integration project. in-stitution finds institutional access on research providers and hands the login to your pack. Your pack owns its authentication algorithm, setup screen, private configuration, institution rules and completion. Start with the [SDK reference](institution-packs.md) when implementing; this guide covers the development process.

## Start by finding existing institutional knowledge

**Look for a maintained login stack before writing authentication code.** Our original SUSTech integration was only possible with help from `sustech_survival` and its existing login-flow stack. Its knowledge of CAS, CARSI, Shibboleth and provider handoffs gave us a working starting point. University developers should seek the equivalent resource for their institution instead of rediscovering every redirect, token and session rule.

Search your institution's student/developer communities, campus CLI projects, SSO client libraries, browser extensions, library access guides, identity-team documentation and maintained endpoint catalogs. Useful searches include `"University Name" SSO library`, `"University Name" off-campus access`, `"University Name" CAS Shibboleth OIDC`, and the institution's actual login hostname. Ask maintainers whether they have verified research-provider flows or off-campus test notes.

Before adopting a resource, record its maintainer, source/version, license, supported services and recent verification. Read the session-management and authentication modules, not just a successful script. Check its institution boundaries: an account library for teaching systems may not support library SSO. Contact maintainers when reuse rights or intended behavior are unclear. Attribute adopted code and approaches in your own README and changelog; retain required copyright/license notices.

Use an existing session/authorizer API when your runtime supports it. A Python login stack cannot be imported directly into a browser pack: reuse its protocol knowledge or a documented compatible service, and implement browser-specific parts deliberately. Copying cached cookies, users' credentials or session files is not a portable integration. The separately released [SUSTech project's README](https://github.com/dumixthestpd/sustech-in) contains its attribution and verification notes; other institutions can have entirely different systems.

## Map the actual flow before coding

Write down the research-page entry, discovery service, institution/tenant selection, identity-provider hosts, protocol transitions, API calls, browser-only interactions and publisher return. Identify which component owns each step. Distinguish public configuration from per-user private settings and temporary authentication state.

Use an account you are authorized to test and document:

- on-campus versus off-campus behavior, including automatic IP access;
- an existing SSO session versus a fresh account login;
- required consent, CAPTCHA, MFA and first-time agreements;
- redirect/form state, CSRF tokens and required JavaScript helpers;
- success, rejected credentials, expired sessions, retries and logout behavior.

A publisher displaying institutional access on campus does not prove that your off-campus login works. Use a genuinely appropriate test connection; do not change someone else's device proxy configuration to manufacture one. Keep traces local and redact passwords, cookies, authorization headers, tickets and user identifiers before sharing evidence.

## Create your project

Use Node.js 22 or later and a source checkout of in-stitution:

```sh
npm run institution:new -- --id my-u --name "My University" --origin https://login.example.edu
```

The starter lives under `extension/institutions/my-u/`. Keep its login code, setup UI, tests, policies and verification notes together. It can also live in a separate repository: the pack builder accepts an external source directory. Follow the release layout in [separate project releases](releasing-projects.md).

```text
my-institution/
  README.md
  CHANGELOG.md
  LICENSE
  pack.test.cjs
  pack/
    manifest.json
    adapter.js
    settings.html
    settings.js
```

Use a stable pack ID; version your institution project independently of the framework. Declare verified exact HTTPS login/API origins and any post-login return origins. Bundle dependencies locally and keep private settings outside the source archive. Add documented framework/API compatibility to your README or project metadata.

## Implement your own login and setup

Register `InstitutionPack.register(async (ctx) => { ... })`. Your pack may implement CAS, SAML, OIDC, tenant routing, a bespoke portal or another browser-compatible flow. No CAS fields, password scheme or prescribed series of steps is required.

Prefer `ctx.request` for stable institution API work that belongs in the background. Use DOM/browser navigation for redirects, browser-bound session state and interactive verification; use `ctx.page.run` when the institution's existing JavaScript must participate. Keep the browser responsible for challenges that need a person. Validate every institution-specific credential destination in your pack, and check cancellation after asynchronous work. Keep retries and timeouts explicit in your own flow policy.

Your setup screen registers `InstitutionPackSettings.register({ load(config), save() })`. Define your own controls, conditional fields, validation and local-file import. The returned JSON becomes private `ctx.config`; the core hosts and stores it without interpreting a university-specific schema. Use `ctx.local` for document state and `ctx.storage` for pack-specific state across pages. Scope submission attempts to `ctx.flowId` and avoid repeated API calls on every DOM update.

Use `returnOrigins` when your pack needs to continue on approved publisher pages after institution handoff. Those pages receive `ctx.pageRole === "return"` only after ownership begins; an ordinary publisher visit still uses shared discovery. Inspect the actual result and call `ctx.complete()` or `ctx.complete({ returnUrl })` when your flow has finished. The core's research-page hint is a signal, not proof of entitlement.

## Verify the pack separately

Test with fake accounts first. Cover exact credential destinations, unrelated services, hostile lookalike origins, consent defaults, challenges, failed login, cancellation, session expiry, repeated callbacks and publisher return. Run the framework checks for shared changes; keep institution-specific test cases in your project.

Then install the built archive into a browser and exercise the whole chain. Record the pack/framework/browser versions, provider, network environment, entry/return path, expected result and remaining manual steps. Label evidence clearly as starter, fixture-tested or live-verified. A port from an older integration inherits useful knowledge; it needs its own verification after changing runtime or storage.

```sh
npm run institution:build -- extension/institutions/my-u/pack
```

Drop `dist/institutions/my-u-1.0.0.instpack` into **Institution packs**, review its source and sites, enable Chrome's **Allow User Scripts** setting if required, and complete its setup screen. Installation must work without editing the core catalog or rebuilding the browser extension.

## Release and maintain independently

Publish the institution pack from its own project/release channel, with its own version, changelog, license, compatibility requirements, maintainer contact and verification matrix. Publish the core extension from the in-stitution project. Never bundle institution accounts or authentication traces in either release.

The core release and `sustech-in` release are separate artifacts/projects, even while their sources share this development checkout. Core fixes should remain provider/framework changes; institutional hostnames, rules, credential formats and live-account evidence belong to the institution project. See [release commands and migration](releasing-projects.md).

Keep article capture with Zotero Connector or EndNote Click. This framework exposes no downloader. Any future agent-driven attachment retrieval must coordinate at least 30 seconds per article across its automated paths.
