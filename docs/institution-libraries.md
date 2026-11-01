# Institution authentication libraries

The framework has three layers:

1. **Provider adapters** locate institutional login and discovery on research sites.
2. **Institution libraries** implement each university's authentication flow.
3. **Profiles** select a bundled library and supply declarative institution configuration.

[Executable institution packs](institution-packs.md) contain independent JavaScript and supporting resources. They implement new institutional flows without rebuilding the core; imported code uses a separate SDK and User Script context, not this privileged bundled-library contract. Legacy settings packs distribute configuration for existing bundled libraries.

`extension/content.js` orchestrates DOM changes and bounded actions, delegating authentication to the selected library. `extension/background.js` independently checks the library's credential policy before releasing credentials. `extension/institutions/auth.js` provides reusable CAS and Shibboleth helpers; a library can compose those helpers or implement different behavior.

## Direct protocol routes

`extension/routes.js` runs in the background worker and resolves supported provider transactions without DOM interaction. Its pure `plan(url, flow)` function returns a navigation plan or `null`; it does not request passwords or fetch publisher content. The worker checks the current document/journey before navigating and records only a route ID and step count. Transaction URLs and opaque callback state are not persisted or returned to content scripts.

- CNKI's entry pages use its verified `Shibboleth.sso/Login` endpoint with the selected profile's `entityId`. Article and search pages retain their normal flows.
- Springer and Nature preserve the research return URL. Verified entry plans also cover IEEE, Wiley, Elsevier, ACS and Taylor; RSC enters its native stateful broker. WOS retains native Clarivate federation and its legacy auto-POST gateway; only compatible CARSI discovery transactions have a direct response. See the [routing matrix](live-browser-checks.md). Existing protocol parameters and authentication-broker pages retain their original transactions. Institutions still need provider participation and independent live verification.
- CARSI requests with a supported policy and an exact provider callback at `/Shibboleth.sso/Login` can receive the selected IdP directly. Duplicate parameters, unknown hosts, other provider families, unsupported callback paths, and existing identity parameters fall back to page controls. The original callback query bytes are preserved.
- The profile must declare the entity ID's origin in `identityOrigins`. Each library validates its university's verified authentication configuration.
- Entity IDs are transmitted exactly as configured, including identifiers without a trailing slash. Native institution dropdowns prefer an exact entity-ID value over an abbreviated display name. Library-maintained aliases also apply to saved profiles.
- Direct attempts are bounded to once per route per journey. Unsupported routes or rejected browser navigation use the DOM fallback. Remote authentication failures can require restarting with **Use compatibility mode**, a per-profile preference that disables direct routing.

The discovery response follows the [OASIS IdP Discovery protocol, section 2.4](https://docs.oasis-open.org/security/saml/Post2.0/sstc-saml-idp-discovery.html). Add verified routes to the shared resolver and university-specific authentication to `institutions/<institution-id>/`; preserve browser ownership of SAML/OIDC transactions, CAPTCHA, and MFA. No local server, cookie transfer, or publisher background scraping is needed.

Broker continuation pages remain active after an IdP visit. The journey ends on a research page or a matching access indicator after authentication; this avoids stopping at Scopus's optional personalization step or repeating RSC login. Browser verification pauses assistance, and recognized publisher server errors stop it. Generic menu handling never submits a personal-account form.

## Included modules

- `institutions/registry.js`: validated library registration and lookup.
- `institutions/<institution-id>/index.js`: university routes, defaults, authentication, migration and consent.
- `institutions/catalog.js`: reviewed bundle composition; shared runtime consumers do not name a default university.
- `institutions/standard-cas.js`: explicit common-protocol implementation for configurable CAS routes.
- `institutions/manual.js`: institution discovery followed by normal university login.

## Library contract

Register a bundled module through `InstitutionLibraries.register(library)`:

| Member | Contract |
| --- | --- |
| `id`, `name` | Stable lowercase identifier and readable display name. |
| `supportsCredentials` | Whether the library implements optional credential handling. |
| `preset` | Optional profile defaults. |
| `validate(profile)` | Reject inconsistent or unsafe configuration. |
| `classify(url, profile, core)` | Return `login`, `identity`, or `null`. Match verified origins and paths. |
| `credentialsAllowed(url, profile, core)` | Explicit credential-release policy; false for libraries that do not handle passwords. |
| `login(ctx)` | Perform institution-specific login steps. |
| `identity(ctx)` | Handle subsequent IdP, consent, or interactive authentication pages. |
| `discoveryTerms(profile)` | Optional bounded search-name priorities, such as a university's historical publisher name; four distinct terms maximum are tried. |

The context supplies `profile`, `core`, current `state`, and document-local `local` state. Use `all(selector)` for visible controls, `findText(regex)` for labels, `setInput(input, value)` for normal input events, and `act(key, element, phase)` for bounded clicks. `phase(name, text)` and `show(text)` provide feedback. Supported phases are `discovering`, `institution`, `credentials`, `consent`, and `manual`.

Check `ctx.current()` after asynchronous work and before handling credentials or submitting a form; Stop or a new journey can invalidate an operation. Use `ctx.send({type: 'auth:credentials'})` only after your origin, form, and service checks. `auth:submit` enforces the profile's opt-in submission preference and at most one authorization per journey. The shared CAS helper also rejects external form actions, GET forms, existing passwords, errors, captcha, and OTP fields. A custom credential-capable library must implement equivalent safeguards for its own protocol.

The worker permits credentials only on origins declared by that journey's profile and approved by the chosen library. Declaring `supportsCredentials` alone does not authorize credential release. Authentication preferences and credentials remain keyed by profile and bound to its library, CAS configuration, and identity origins.

## Add a trusted bundled library

Institution developers normally create an independent executable pack; see [CONTRIBUTING.md](../CONTRIBUTING.md). The alternative below adds reviewed code to the core extension, including any approved credential handling.

```sh
npm run institution:new -- --id my-u --name "My University" --origin https://login.example.edu --bundled
```

Replace the placeholders with verified values; append `--dry-run` to preview changes. The command creates the library, starter tests and verification README, and registers all three composition points. It starts with manual authentication and credential release disabled.

1. Read the university's actual browser login sequence and verify its routes. Start with [the fictional campus-portal/OIDC example](../examples/example-university.js).
2. Implement its library in `extension/institutions/<institution-id>/index.js`. Keep university-specific routes and future protocol implementations in that directory. Shared helpers and generic libraries stay directly under `extension/institutions/`. Declare all required university origins in its profile; avoid all-domain matching.
3. The starter registers the module in `institutions/catalog.js`, manifest content scripts, and popup script tags before `core.js`; do these manually if creating the library without the command. The catalog supplies Node loading, worker imports and dynamic injection lists. Do not add university domains or logic to shared runtime files or manifest matches; exact login origins are granted through profile setup. The first bundled preset initializes a new installation; saved selections are preserved.
4. Add profile-validation, route, credential-denial, and browser-fixture tests. Verify that another institution's credentials cannot reach its pages.
5. Reload the extension, save the profile, and approve only its requested origins. Verify the full live flow separately with an authorized account before claiming live support.

JSON profiles can be shared through the popup. A profile referring to an unbundled library is rejected: users must install a reviewed extension build containing that library. JSON never downloads or executes JavaScript. Libraries do not need a Python service; an institution can supply its browser-side library independently of its other SSO tools.

## Example discovery-only profile

```json
{
  "id": "my-university",
  "library": "manual",
  "name": "My University",
  "shortName": "My U",
  "aliases": ["Local-language institution name"],
  "searchTerm": "My University",
  "federation": "",
  "identityOrigins": ["https://login.example.edu"],
  "discoveryOrigins": [],
  "cas": null
}
```

These example domains are placeholders. For a standard CAS institution, choose `standard-cas` and supply `cas.loginUrl` plus allowed `cas.servicePrefixes`; prefixes must end in `/`. For a bespoke library, keep the protocol-specific routes and behavior in that library.

Host grants and dynamic injection follow Chrome's [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting). Revoking a host grant removes its dynamic registration on synchronization; save the institution again to restore permission.
