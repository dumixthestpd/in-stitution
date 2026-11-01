# Zotero and EndNote companions

## Use the existing capture tools

in-stitution supplies institutional access. Reference managers supply article recognition, metadata, attachments and library organization. Select **Save articles with** in the popup; this preference is global across institution profiles and changes handoff guidance only.

| Manager | Workflow after sign-in |
| --- | --- |
| Zotero Connector | Use its browser toolbar button; Zotero supplies translators and saves to its selected library/collection. Accessible PDFs may accompany the reference. |
| EndNote Click | Use its native viewer and export controls to send references to EndNote or another supported manager. |
| Other / sign-in only | Save through your existing reference-manager workflow. |

Sources: [Zotero browser saving](https://www.zotero.org/support/adding_items_to_zotero) and [EndNote Click integrations](https://click.endnote.com/).

No custom citation exporter, PDF collector or library index is needed. The old article PDF panel is removed; its backup remains in the original development workspace. Reload article tabs after upgrading. The preference does not install or enable a companion, invoke another extension's private controls, or change its settings.

## Local setup and verified limits

Zotero Connector **5.0.217** is installed and pinned in the authorized debugging Chrome profile. Its official Google package was checked against publisher and Web Store signatures, with the official extension ID retained. Only public-key identity metadata was added to the local manifest. Runtime code was unchanged.

This development check used a local unpacked installation with manual updates. Users should install the official Connector through [Zotero's download page](https://www.zotero.org/download/). The development copy and its local browser profile are not distributed with this project.

Zotero Desktop **10.0.6** responded through both its local API and Connector service. Connector recognized a Nature article using its Nature Publishing Group, Embedded Metadata and DOI translators with in-stitution enabled. This verifies connectivity and article recognition; no reference or attachment was saved. Joint library-and-PDF capture remains unverified.

EndNote Click **3.5.0** is installed but disabled in that profile. Its native export workflow has not been exercised. The manager preference does not enable it.

The v0.7.0 live check confirmed the installed popup's Zotero selection and handoff guidance, absence of the retired PDF panel, continued Connector article recognition, and a successful bounded local-library search. No library writes or downloads were performed. Automated validation passed 51 Node tests and 37 Chromium checks; fixtures exercise manager selection and leave native capture controls untouched.

## Thin backend integration

The MCP `search_zotero_library` tool delegates read-only searches to [Zotero's existing local API](https://www.zotero.org/support/dev/web_api/v3/local_api). It searches the personal library's reference metadata without reading attachment files, building an index, or adding records. See [agent setup](agents.md). Other library operations should use existing Zotero integrations; EndNote capture stays with Click's supported native exports.

Zotero's [institutional proxy redirection](https://www.zotero.org/support/connector/preferences/proxies) can overlap with institutional access routing. Use the appropriate existing routing setup; no proxy settings are changed by this integration.

There is no unattended capture automation. Any future agent-controlled PDF retrieval requires a coordinated minimum **30-second article interval** covering all paths. Native saves run independently; in-stitution does not enforce pacing on other extensions.
