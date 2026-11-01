# v0.11.2 release assessment

Assessed 2026-11-01: **suitable for a public experimental developer preview; not ready to advertise universal institutional support or a finished consumer/store release.** Core and institution integrations publish separately.

## Evidence

- Core and institution Node tests, manifest/boundary validation and independent packaging are checked. The latest browser verification passed 12 targeted installed-extension checks, including real loopback HTTPS cookie/redirect behavior. The full combined browser run passed its DOM/popup fixtures but stalled entering the extension stage; it is not an uninterrupted suite pass. An imported fictional non-CAS adapter exercises custom setup, account choices, background HTTP, persistent state, child frames and completion. Fixtures establish extensibility, not live support for another university.
- Packaging includes runtime files, the license and no institution implementation or preset. Independent source-pack folders, tests, documentation, MCP, local credentials and browser profiles are excluded. Institution developers build their own `.instpack` archives separately.
- Live university results remain with the institution project’s historical live report in the shared checkout. A second real university has not been verified.
- Zotero connectivity, article recognition and read-only library search were checked. Joint reference-plus-PDF capture remains unverified. EndNote Click's capture/export workflow is unverified; it is disabled in the development profile.

This is not an independent security audit, every-article entitlement check or verification of every supported browser version.

## Before a broad release

1. **Scope adapter support:** publish the contributor workflow and label support per institution. A second institution's developers can implement and verify their library themselves; central maintainers do not need every university's accounts. A second real non-CAS integration would strengthen evidence, but is not a prerequisite for releasing the extensible framework as a preview. Claim only the flows verified by each adapter's maintainers.
2. **Complete native-manager acceptance:** verify one explicitly chosen reference, destination and accessible attachment in Zotero; separately verify EndNote Click's native export before advertising it as tested.
3. **Verify first-run selection:** v0.8.0 adds a visible drag-to-install pack manager, so compatible packs require no profile editing. The standard core now starts without a selected university. Institution implementations and artifacts are released separately; install and configure a pack before starting. [Setup instructions](getting-started.md) explain pack installation and advanced configuration.
4. **Finish store distribution materials:** GitHub previews provide source, manual-install assets and issue tracking. An icon set is included. A future store release still needs a privacy-policy URL, permission/data disclosures and store-sized graphics; the tall popup preview is not a store screenshot. Follow Chrome's [listing requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) and [publication process](https://developer.chrome.com/docs/webstore/publish).

Unpacked installation is a development path with manual updates. Normal Chrome distribution uses the [Web Store or supported managed deployment](https://developer.chrome.com/docs/extensions/how-to/distribute). Store review is separate; a ZIP is not a reviewed listing.

## Reuse and current limits

Provider adapters, institution libraries and profiles are separate. A library can classify its own paths and handle account choices, OIDC/SAML transitions and consent without CAS. Real university rules require verification. Credentials and opt-ins remain institution-scoped.

- Executable packs install new JavaScript algorithms and resources without rebuilding. They use the documented User Scripts API and require Chrome 135+ and the browser's Allow User Scripts setting. Legacy settings packs still select existing engines. Imported code is trusted on its approved pages and cannot access the extension vault; API 2 packs own their private configuration, login lifecycle and completion; Stop controls SDK operations, not arbitrary uncooperative DOM code. Fresh documents are required after adapter changes.
- Shared publisher support is a reviewed set. An institution adapter can own additional declared portal/identity pages and implement its own completion, but new shared publisher coverage still needs provider recognition, permission/injection coverage and tests.
- The shared profile's entity-ID field and direct-routing model still require HTTPS. A custom executable pack can leave that field empty and carry a different protocol identifier, tenant model or flow in its own code/resources. Real SAML identifiers can be other URIs, including URNs ([Shibboleth entity naming](https://shibboleth.atlassian.net/wiki/spaces/CONCEPT/pages/928645134)); the core shortcuts have not become universal federation support.
- Unknown selectors, forms, proxy flows, MFA and university policies need manual steps or adapter work. Compatibility mode retains native controls; it cannot implement unknown protocols or create subscription access.

Accurate preview description: **institution-neutral sign-in framework with independently maintained institution packs and native reference-manager handoff.** The newly separated institution port needs fresh live verification; historical bundled-engine evidence is kept with that project.

Core and institution source/runtime artifacts are generated separately by `npm run release:projects`; see [release boundaries and publishing](releasing-projects.md). No public repositories or release destinations are configured by this command.
