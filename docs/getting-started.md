# Set up in-stitution

Version 0.11.2 is a developer preview for Chrome 135+. Verify institutional access on one publisher page before enabling automatic sign-in. An installed pack does not establish that a university or subscription has been tested.

## Install

1. Extract `in-stitution-0.11.2.zip` into a permanent folder with `manifest.json` directly inside it. Alternatively, use this repository's `extension/` folder.
2. Open `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. Keep it in place; unpacked updates are manual.
3. Install Zotero Connector or EndNote Click separately from its official source. Start Zotero Desktop if using Zotero. Neither manager is bundled with in-stitution.
4. Open a supported research page and the in-stitution popup. Choose **Save articles with**. This changes guidance; it does not remotely save an article.

Browser-only use needs no Node.js, MCP server, credentials file or remote-debugging port. [Agent tools](agents.md) are an optional separate setup.

## Choose your institution

A fresh core installation starts with **Choose your institution**. Install your institution pack separately and complete its own setup screen before starting.

The easiest setup is **Install institution pack** in the popup: drop your maintainer's `.instpack` archive and review its code and sites. Enable **Allow User Scripts** in the extension's browser Details once, return and **Check again**, then install. The pack supplies the institution's own login code, resources and setup screen; no profile editing, developer command or core rebuild is needed. Old settings-only JSON packs still work. See [installation and updates](institution-packs.md).

| Institution setup | What to do |
| --- | --- |
| Institution pack | Install the separate institution project’s `.instpack`, then use **Configure institution**. University code is not bundled in the core. |
| Unlisted or non-CAS login | **Change institution** → **Add institution** → **Discovery only · normal university login**. Enter the university name/aliases and verified login origins, such as `https://login.example.edu`. Leave CAS/entity-ID fields blank unless known. Save; use the normal account and MFA flow. |
| Verified standard CAS + Shibboleth | Choose that library. Supply its exact CAS login URL, allowed IdP service prefixes ending in `/`, and login origins from a maintainer or verified configuration. Do not guess these values. |
| Bespoke automatic login | Install the institution maintainer's executable `.instpack`. It supplies its own setup screen, configuration and complete login flow. Use **Configure institution** to change its settings. |

Approve only recognized login hosts. Discovery assistance covers supported providers and selectors; an unfamiliar federation directory may still need manual selection. University policies and subscription entitlements continue to apply.

## Sign in and save

Click **Continue with your institution** and complete university verification. Once the publisher shows access, save through Zotero Connector's toolbar button or EndNote Click's native viewer/export controls.

Keep automatic options off initially. Optional saved credentials work only with credential-capable libraries; the project adds no encryption to browser extension storage. Normal password-manager/MFA login remains available. Automatic start, submission and attribute release are separate opt-ins, subject to university rules.

If direct routing fails, stop, enable **Use compatibility mode**, and start again. New publisher/proxy hostnames and unfamiliar portals can require adapter work. Device proxy changes are not part of setup.

Core and institution packs update independently. Download the core extension from the framework project and the matching pack from its institution project. After updating core files, reload the extension and research tabs. Read the [release assessment](release-readiness.md) before sharing with others.

## Remove an institution

Open the popup, choose **Change institution**, select the institution and click **Remove institution**. Click again to confirm. The manager also offers removal on every saved-institution card. Removing the last institution returns to setup; it does not sign out existing university/publisher website sessions.

For a completely fresh browser test, use a separate Chrome profile. Fresh extension files alone do not clear website SSO sessions.
