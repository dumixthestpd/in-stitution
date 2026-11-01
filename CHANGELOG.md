# Changelog

## 0.11.2

- Prepare independent public developer-preview repositories and download/support links. Remove workstation-specific setup paths and stale release claims from published guidance; preserve the original workspace's backup history locally.
- Exclude private environment, cookie/session and key files recursively from source exports, with a regression check before GitHub publication.

- Restore the earlier “in ↗” wordmark across browser icons, popup and pack manager.
- Allow pack background requests to stop at redirects with `redirect: "manual"`. Return an opaque redirect marker without exposing Location or following credential-bearing requests; keep `error` as the default.
- Verify redirect stopping, real HTTPS session-cookie storage and browser resumption with a public fake-account loopback fixture. Preserve institution-specific authentication implementations in their independent projects.

## 0.11.1

- Make Remove institution visible beside the saved-institution selector for executable packs and manual profiles, with confirmation bound to the selected institution. Allow removal from each manager card and show an empty state after the last removal.
- Add a doorway/arrow icon in native toolbar and extension-management sizes, with matching popup/manager branding and committed PNG assets.
- Keep the first-run Install institution action available on every tab. Add a clean setup bundle containing the core folder, separately built institution packs and a short setup note; include no saved browser state.
- Validate removal, reset-to-setup behavior, icon assets and clean distribution contents in browser/build checks.

## 0.11.0

- Publish institution-neutral core artifacts and independently versioned institution project/source archives. Remove university modules and presets from standard core composition and start with an unconfigured institution.
- Preserve unsupported legacy records without releasing their old credentials; install and configure the separately distributed pack to migrate.
- Add fingerprinted post-handoff return origins and pack journey/page-role context so independent packs can own publisher completion.
- Add an Institution Pack Developer Guide that starts with institutional resource discovery and credits sustech_survival’s login-stack contribution to the original integration. Document separate-project releases, compatibility, evidence and publishing boundaries.
- Add generic release isolation tests, portable institution source exports and independent institution test commands. Institution-specific implementation/version/history remains in its own project.

## 0.10.0

- Hand login ownership to API 2 institution packs. Let each pack decide its protocol, steps, timeout/retry policy and explicit completion; stop shared heuristics and discovery action/time limits after handoff. Preserve API 1 and bundled-library behavior.
- Host pack-provided setup HTML/JavaScript/styles with arbitrary private JSON configuration. Add Configure institution controls and a JSON fallback; hide generic authentication fields for these packs. Keep private configuration and persistent runtime state scoped to the pack and excluded from exports.
- Add background login/API requests, native page-world function calls, optional institution child-frame support and persistent pack state. Bind operations to active journeys, approved sites, source fingerprints and granted permissions; keep Stop responsive during asynchronous work.
- Extend the independent starter and fictional example to own their setup and login. Verify real Chromium install/configure/realm choice/page JavaScript/background POST/completion and framed login; retain native Zotero/EndNote capture.
- Follow Chrome’s documented User Scripts and sandbox-page APIs. Keep all university-specific implementation and evidence in its institution directory.

## 0.9.0

- Replace the settings-only limitation with executable `.instpack` archives carrying institution-owned JavaScript, supporting resources and a manifest. New institution flows need no core registration or rebuild. Retain v1 JSON settings compatibility.
- Execute imported code only through Chrome's User Scripts API in separate worlds, after a matching active journey/current-document check. Native registrations are inert on ordinary page visits. Bind SDK messages to per-pack capabilities and source fingerprints; do not expose the credential vault or settings interfaces to imported code.
- Add SDK helpers for bounded clicks, worker navigation, notices, completion and cooperative cancellation. Support institution-specific browser API handshakes and native account/MFA flows. Prevent mixing adapter owners/versions within a document, including restored documents; revoke capabilities on updates/removal.
- Add a bounded ZIP reader/writer, source fingerprints, an independent pack starter and builder. Exclude pack source folders from the extension ZIP. Keep the earlier bundled-library starter behind `--bundled`.
- Require Chrome 135+ and the userScripts permission; executable packs need the browser's Allow User Scripts toggle (Developer mode before Chrome 138). This uses the documented user-code API exemption, without promising store approval.
- Verify installation and a non-CAS portal/account-choice/session-API/publisher round trip using source absent from the core bundle. Add archive, capability, lifecycle, rollback and independent-scaffold tests. Reference-manager capture and existing trusted institution libraries remain separate.

## 0.8.0

- Add a persistent Institution packs page: drag/drop or choose a `.institution.json` file, review its institution and login sites, then install with exact browser host grants. Add a visible popup entry and extension Options page.
- Track pack versions and maintainers; support export, reviewed replacement, local-edit detection and removal. Public packs exclude credentials and automatic sign-in preferences. Changed authentication scope clears saved login data; stale reviews require another preview.
- Keep packs strictly declarative and reject scripts, executable rule programs, credentials, automation settings, unknown fields and unavailable engines. Custom engines remain bundled reviewed code; do not execute downloaded logic. Document the boundary against Chrome's Manifest V3 requirements.
- Reject wildcard hosts during URL validation so pack/profile origins cannot expand an exact login-host grant to multiple or all sites.
- Serialize configuration and host-registration changes across the popup, pack windows and permission events. Restrict the manager to pack operations; publisher pages cannot manage packs.
- Add a fictional settings pack, a bundled institution pack and a pack output in the custom-engine starter. Add parser, update, permission, concurrency and real Chromium drag/install/persistence/removal checks.

- Add an institution starter command that creates manual-only library hooks, origin/credential-boundary tests and a verification README, and updates bundle composition without overwriting existing libraries. Add contributor instructions so institution maintainers can implement and verify their own integrations independently.

- Mark v0.7.0 as a developer preview and document installation, institution setup choices, verified limits and remaining release work. Correct the library guide's stale WOS direct-entry claim; the verified native flow remains unchanged.

## 0.7.0

- Make institutional access a companion to native Zotero Connector and EndNote Click capture. Add a global manager preference and access-aware handoff guidance without installing, enabling or invoking another extension.
- Remove the duplicated article/PDF panel and its worker download command. Preserve the prior implementation at `backup/standalone-tools-v0.6.0`. Native reference managers retain translators, attachments and destination selection; authentication routes are unchanged.
- Add read-only personal-library search through Zotero Desktop's documented local API to MCP. Reuse Zotero's storage/search; return bounded reference metadata without attachment reads or library writes. No new browser permissions or dependencies.
- Keep automated capture unavailable. Any future agent-driven attachment retrieval must coordinate the requested 30-second article interval across every path; native manual saves are outside in-stitution's control.

- Documented Zotero Connector, Zotero local API and EndNote interoperability paths, local readiness and the limits of PDF pacing across independent extensions. No reference-library writes or integration settings were changed during the assessment.
- Recorded installation of the verified official Zotero Connector package as a local Chrome extension, successful Zotero Desktop connectivity and concurrent article recognition. Proxy settings and reference-library contents were preserved; the local installation requires manual updates.

## 0.6.0

- Expanded background routing to verified ACS, Taylor and RSC broker entries; preserve existing publisher transaction state and retain per-profile compatibility mode. WOS retains its verified native flow because a direct shortcut failed clean-session verification.
- Corrected Scopus's canonical-home handoff to return through its root authentication bridge; direct return to the app could leave Preview access. Error and access-check pages no longer count as research returns.
- Confined university defaults, canonical domains, legacy migrations, attribution and live account results to institution libraries. Shared consumers use a bundle catalog and discover presets generically; all university origins use exact optional grants. Added a runtime boundary check.
- Added dependency-free MCP stdio metadata search and DOI lookup through Crossref, with bounded, serialized requests, caching and rate-limit backoff. Protocol behavior follows MCP 2025-06-18; metadata access follows Crossref's public REST API.
- Added an article-page PDF handoff for visible native links matching the current article. A durable background reservation enforces at least 30 seconds between attempts across tabs, institutions and worker restarts, including agent-operated clicks. Automated cross-publisher full-text downloads are not exposed because their interfaces are not uniformly stable.
- Added protocol, metadata, article-boundary, cooldown-concurrency and real-extension PDF-control checks. Device proxy settings remain untouched.
- Shared worker and browser fixtures now use a fictional university; university-specific validation and migration checks live beside their library and are excluded from the extension ZIP.

## 0.5.1

- Open Clarivate's actual Material trigger rather than the inert outer element, and retry when it appears before its event handlers are ready. Limit opening attempts to three and leave an expanded menu open while its options load.
- Keep WOS's legacy auto-POST gateway active between CARSI discovery and the IdP instead of mistaking it for the final research page.
- Prefer institutional action buttons over persistent navigation links on RSC, wait for delayed controls instead of following self-links, and recognize Scopus's canonical `/pages/home` entry for direct routing.
- Added a delayed-initialization Chromium fixture, including asynchronous options and a bound on retries.
- Recorded off-campus provider round trips and remote-login availability with the institution library, without changing device proxy settings.

## 0.5.0

- Added direct SP-init plans for Springer, Nature, IEEE, Wiley and Elsevier entry pages. Springer and Nature preserve the research return URL; existing transactions remain intact. Source attribution is retained with the institution library.
- Preserve exact entity-ID strings and select native options by entity ID when publisher names are abbreviated. Libraries maintain historical names for saved profiles.
- Fixed ACS federation controls with uppercase identifiers, prioritized its actual continuation control, and kept institutional headers out of discovery results.
- Added library search priorities, bounded retries for unrelated JSTOR results and an explicit stop when the provider offers no remote-login method. Account-specific results are retained with the institution library.
- Keep broker pages active after SSO, skip Scopus's optional personalization, and recognize current ACS/RSC/JSTOR/Taylor access banners. Explicit institution-login pages can initiate authentication despite campus access; post-SSO access indicators prevent repeat loops.
- Pause for browser verification, stop on recognized publisher server errors, and avoid submitting personal-account forms. Added safe CDP navigation-event subscriptions for live diagnosis without cookie or assertion logging.
- Added protocol, worker-state and installed-Chromium checks. Live account evidence, limitations and upstream authentication attribution are retained with the institution library.

## 0.4.0

- Added worker-side CNKI entry routing and direct responses to compatible CARSI discovery transactions, following the OASIS IdP Discovery protocol. Upstream attribution is retained with the institution library.
- Preserve opaque provider callback queries, exact callback hosts, journey/profile isolation, Stop, time/action bounds, and one attempt per route. Direct routing does not fetch publisher content or move credentials/cookies into a separate server.
- Added per-institution compatibility mode to retain the existing browser flow. Unsupported routes and rejected browser navigation continue with page controls; remote failures may require a compatibility-mode restart.
- Verified the CNKI route with a university account and added worker/resolver boundary tests and installed-Chromium fixtures for CNKI, CARSI responses and compatibility mode.
- Added library-specific canonical entity-ID validation and included worker imports in syntax checks.

- Initialized local Git tracking and preserved the v0.3.0 browser implementation with a backup branch and annotated tag before further authentication changes.
- Organized university libraries under `extension/institutions/<institution-id>/` and updated runtime and test loaders. Institution-specific history and upstream attribution are retained with the library.

## 0.3.0

- Added per-institution opt-in automatic start on research sites; Stop pauses the current tab until a manual restart.
- Added local credentials-file import for `username:password` and JSON formats. Imports stay inside the browser and do not modify or continuously read the source file.
- Completed live off-campus checks on Springer Nature, IEEE Xplore, Wiley, ScienceDirect and CNKI with the selected institution library and saved credentials/session.
- Added current RSC and Elsevier authentication hosts, localized continuation labels, native federation suffix matching, configured-name retries, and remembered-institution controls.
- Fixed intermediate provider pages ending journeys prematurely, repeated institutional buttons blocking subsequent controls, and personal-menu fallbacks interrupting discovery.
- Added open shadow-root traversal, composed input events and custom-element value updates, keyboard-driven suggestions, local search submission, and optional-cookie rejection.
- Keep observed CNKI off-campus navigation in the same tab to avoid its scripted popup being blocked. Added CNKI's institutional menu and school-list handling and more existing-access indicators.
- Expanded regression coverage for automatic start, file parsing, continuation buttons, native selectors, multi-stage controls, shadow forms, localized fields, and bounded alias retries. Scripts now stop with a readable status on unexpected errors.

## 0.2.1

- Fixed popup detection and sign-in startup when Chrome withholds the tab URL, using the extension’s existing content script for page context.
- Stop assistance when Web of Science or Springer already displays the selected institution’s access banner.
- Release inherited journeys on unrelated provider tabs so their Start button is not locked.
- Avoid Springer’s personal-account header link; direct users to institutional access on content pages.
- Added a CDP connection helper for testing in an authorized live browser without opening or closing its profile.

## 0.2.0

- Separated institution authentication into registered libraries with classification, validation, credential, login and identity hooks. University-specific CAS/Shibboleth behavior lives in its own library.
- Added explicit standard-CAS and discovery-only libraries, plus a fictional campus-portal/OIDC library example and contributor API documentation.
- Added institution profiles, library selection, JSON import/export, exact optional host grants, and dynamic script registration.
- Isolated credentials and preferences by institution and authentication configuration; migrated legacy storage and captured profiles per journey.
- Added tests for different university paths, non-CAS handoffs, permission requirements, migration, and credential isolation.

## 0.1.0

- Added a standalone Chrome / Edge Manifest V3 institutional sign-in extension across ten research provider families.
- Added tab-scoped sign-in journeys, discovery controls, optional local CAS credentials, opt-in submission and attribute release, and Stop controls.
- Added dependency-free validation, worker tests, Chromium DOM fixtures, popup rendering, and reproducible ZIP packaging.
- Adopted shared discovery and consent patterns; original institution-specific provenance is retained in the bundled library's changelog. No parent-project runtime or credential dependency was introduced.
