# Contribute an institution pack

Start with the [Institution Pack Developer Guide](docs/institution-pack-development.md). Look for a maintained SSO/login stack, campus developer project and library access documentation for your institution before implementing authentication. Our SUSTech integration depended on sustech_survival’s existing login-flow knowledge; seek the equivalent resource and preserve attribution for your own institution.

Release the core and each institution integration as [separate projects](docs/releasing-projects.md), with independent versions and artifacts.

Institution developers own their authentication code, protocol configuration, rules and live verification. Shared core code handles publisher discovery, journey limits and reference-manager handoff. A new institution's executable adapter can be installed without registering a library in the core.

## Create and build

Use Node.js 22 or later from the repository root, replacing these example values:

```sh
npm run institution:new -- --id my-u --name "My University" --origin https://login.example.edu
```

The starter creates this independent source pack and leaves the core catalog, manifest and popup unchanged:

```text
extension/institutions/my-u/
  pack.test.cjs
  pack/
    manifest.json
    adapter.js
    README.md
```

Append `--dry-run` to preview files. Existing institution IDs are never overwritten. Implement the verified flow in `adapter.js`, then build:

```sh
npm run institution:build -- extension/institutions/my-u/pack
```

Users drag `dist/institutions/my-u-1.0.0.instpack` into **Install institution pack**. They review its source/sites and enable the browser's **Allow User Scripts** setting once. No core rebuild or institution-specific extension fork is needed.

## Implement the institution's own flow

Use `InstitutionPack.register(async (ctx) => { ... })` and the [adapter SDK](docs/institution-packs.md). The [fictional custom portal](examples/custom-university/) demonstrates account choices and a session API call. CAS is optional. Keep protocol-specific configuration in declared resource files and include local helper JavaScript in manifest execution order.

Declare exact sites, respect institution rules, user preferences, agreements and MFA, and cooperate with `ctx.current()`/`ctx.signal`. API 2 adapters supply their own setup HTML/JavaScript/styles and arbitrary private JSON configuration. The pack owns authentication steps and completion; the core hosts its UI and routes approved operations. Use `ctx.request` for background APIs, `ctx.page.run` for site JavaScript, and `ctx.storage` for pack state. The existing extension vault remains separate. Never package credentials, cookies or authentication traces. Code can read the DOM on its approved sites, so maintainers must earn users' trust.

## Verify and distribute

Run `npm test`, `npm run check` and `npm run test:browser`. The Node runner discovers institution-owned `*.test.cjs` files. Add fake-account browser fixtures for your actual flow; shared tests do not establish live support for your university.

Record a maintainer, protocol, tested providers/dates, required manual steps and limitations in the pack README. Distinguish starter, fixture-tested and live-verified status, and on-campus versus off-campus results. Publish the `.instpack` through your institution's maintained release channel, or contribute its source here. Central maintainers need no account at your university.

Keep institution-specific source/tests/evidence in that institution's directory. `pack/` source directories are excluded from the core ZIP. Shared publisher fixes remain shared. Trusted bundled-library contributions are also possible with `institution:new ... --bundled`; that separate path can use the reviewed [library API](docs/institution-libraries.md) and its credential policy.
