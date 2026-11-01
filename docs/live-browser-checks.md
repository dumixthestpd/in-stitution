# Provider routing and live verification

The background worker owns shared provider routing and discovery limits. Content scripts identify visible access indicators, interactive controls and verification challenges. API 2 institution packs own authentication after handoff, including whether their submission uses background HTTP or a native page. Authentication sessions stay in the browser. Native reference managers handle article capture.

## 0.11.2 automated verification

81 core tests, nine independent institution tests, manifest/boundary checks and setup packaging passed. The isolated Chromium pack run passed four checks and the separate installed-extension run passed twelve, including a real loopback HTTPS POST that stops at a redirect, stores a secure HttpOnly SameSite=Lax cookie and resumes that session in a browser tab. These are fake-account tests, not live university authentication. The single full browser run passed its DOM/popup fixtures but timed out entering the extension stage; the first attempt also reported a Chrome GPU context failure. A complete uninterrupted suite pass is not claimed.

## Routing matrix

| Provider | Background path | Page work retained |
| --- | --- | --- |
| Web of Science | Journey policy and supported CARSI discovery responses | Native Clarivate federation, discovery and university authentication; a direct entry shortcut failed clean-session verification and is excluded |
| Springer / Nature | SP-init with original research return URL | University authentication and access detection |
| IEEE | SP-init on entry pages | University authentication and access detection |
| Wiley | SP-init on entry pages | Browser verification, agreements and university authentication |
| ScienceDirect / Scopus | Elsevier SP-init on entry pages; Scopus always returns through its root authentication bridge | Optional personalization, university authentication and access detection |
| ACS | Shibboleth entry | Browser verification, university authentication and access detection |
| RSC | Native federated broker entry | Publisher OIDC state, institution selection and university authentication |
| CNKI | Direct SP-init on entry pages | University authentication; content pages retain their normal flow |
| Taylor & Francis | SP-init on entry pages | Browser verification, university authentication and access detection |
| JSTOR | Shared institution-discovery assistance | Native directory and remote-access availability; there is no universal endpoint for all institutions |

Supported CARSI discovery transactions can return the configured IdP directly while preserving the publisher callback's opaque query bytes. Existing SAML/OIDC transactions, unknown content routes, challenges and unsupported callbacks keep the browser flow. Compatibility mode retains the complete page sequence.

University-specific account results and limitations belong with their integrations: [the separately maintained institution report](https://github.com/dumixthestpd/sustech-in/blob/main/live-browser-checks.md). A successful round trip for one university does not establish another university's subscriptions or remote-login availability. Chromium fixture checks and live account checks are reported separately.

Agent metadata search and the native reference-manager workflow are described in [agent tools](agents.md). The earlier PDF helper was retired in v0.7.0. Automated full-text retrieval is absent because a stable coordinated interface across publishers and native managers has not been established.
