# Institution-owned login packs

The core opens publisher institutional access and selects the institution. Once its login page is reached, an API 2 pack takes ownership. The pack decides its protocol, steps, account handling, configuration, retries, timeouts, MFA pauses and completion. No CAS-shaped configuration or login state machine is required.

Read the [developer guide](institution-pack-development.md) for resource discovery, implementation and verification. Release institution packs as [independent projects](releasing-projects.md).

## Install and configure

1. Open **Install institution pack** and drop a `.instpack` archive.
2. Review its source, maintainer and exact login/API sites, then install and grant access.
3. Enable **Allow User Scripts** in the extension’s browser Details if requested (Developer mode on Chrome 135–137).
4. Complete the institution’s own setup screen. **Configure institution** reopens it later.
5. Start from a publisher, or enable **Start automatically on research sites**.

Install trusted packs: they execute code on their approved login pages and receive any private settings entered in their own setup. The existing credential vault and other institutions’ settings are separate. Export contains source and public resources; private configuration and runtime storage stay in this browser, without extension-level encryption. Removing a pack clears its private data.

## Create an independent pack

```sh
npm run institution:new -- --id my-u --name "My University" --origin https://login.example.edu
npm run institution:build -- extension/institutions/my-u/pack
```

This creates a starter with adapter code, a replaceable setup screen and an institution-local test. Implement and verify your institution’s flow; build produces `dist/institutions/my-u-1.0.0.instpack`. No core catalog registration, extension rebuild or pull request is needed to install it. Keep each institution’s code, rules, tests and evidence under `extension/institutions/<id>/`. The builder includes only declared files and optional README/LICENSE.

The [fictional custom-university example](../examples/custom-university/) demonstrates a pack-defined realm/account form, branch selection, page JavaScript, a background API POST, persistent state and explicit completion. It is a framework fixture, not a verified university integration.

## Manifest

```json
{
  "format": "in-stitution/institution-pack",
  "formatVersion": 2,
  "id": "my-u",
  "version": "1.0.0",
  "maintainer": "Your maintainer name",
  "institution": {
    "id": "my-u",
    "library": "executable-pack",
    "name": "My University",
    "identityOrigins": ["https://login.example.edu"],
    "cas": null
  },
  "adapter": {
    "apiVersion": 2,
    "scripts": ["adapter.js"],
    "resources": ["settings.html", "settings.js", "settings.css", "portal.json"],
    "settings": {
      "html": "settings.html",
      "scripts": ["settings.js"],
      "styles": ["settings.css"]
    },
    "networkOrigins": ["https://api.example.edu"],
    "frames": "all"
  }
}
```

`identityOrigins` identifies pages where this pack owns login; include external identity providers used by the flow. `networkOrigins` adds approved API hosts without treating them as login pages. Both require exact HTTPS origins and browser grants. `returnOrigins` optionally lists approved post-login pages: the pack runs there only after institution ownership, with `ctx.pageRole === "return"`. These origins also require grants and are fingerprinted. `ctx.researchPage` is the shared page-type hint; the pack decides completion. `frames: "all"` enables approved institution child frames; the default is `"top"`. Publisher entry selection remains shared until handoff. A pack can also declare a broker as its own login origin when it needs to own that stage.

List up to eight JavaScript files in execution order and eight supporting HTML/JS/CSS/JSON/text files. Bundle dependencies locally. The archive allows 20 files including its manifest, 2 MB compressed input, 1 MB unpacked and 256 KB per file. The builder generates the fingerprint, including code, UI and permissions; rebuild after changes. Accounts, passwords and authentication traces belong outside distributable sources.

## Pack-defined setup

The core hosts the supplied HTML, scripts and styles in an opaque-origin frame. It does not generate institution fields or interpret the returned configuration. Use any controls, validation, conditional screens or local-file import your pack needs. The dedicated script registers:

```js
InstitutionPackSettings.register({
  load(config) {
    document.querySelector('#tenant').value = config.tenant || '';
  },
  save() {
    const tenant = document.querySelector('#tenant').value.trim();
    if (!tenant) throw new Error('Choose a tenant.');
    return { tenant, custom: { anyJsonStructure: true } };
  }
});
```

`load` and `save` may be asynchronous. The host calls `save` only when the user presses **Save institution settings**. A rejected save keeps the form open. Configuration can be any JSON value up to 64 KB; there is no required username/password/tenant schema. Without `adapter.settings`, a generic JSON editor is available. Setup code has no extension APIs or network access; login-time requests belong in the adapter. HTML scripts should be declared in `settings.scripts`, styles in `settings.styles`; source is provided locally rather than fetched remotely.

## Login runtime

```js
InstitutionPack.register(async (ctx) => {
  // Inspect the current institution page, implement your protocol and use ctx.config.
  // Perform required browser/API work; pause for user interaction where needed.
  if (await institutionSessionIsReady(ctx)) {
    await ctx.complete({ returnUrl: ctx.entryUrl });
  }
});
```

The callback runs initially and after DOM changes. Pack JavaScript can use browser DOM, forms, crypto, fetch, timers and its own libraries; SDK helpers are conveniences, not a prescribed login algorithm.

| API | Purpose |
| --- | --- |
| `ctx.config` | Private JSON returned by this pack’s setup screen |
| `ctx.profile`, `ctx.resources[name]` | Public discovery profile and declared file text |
| `ctx.entryUrl` | Original research origin/path, or null; query and fragment are omitted |
| `ctx.flowId`, `ctx.pageRole`, `ctx.researchPage` | Journey identifier, identity/return role and shared research-page hint (core 0.11+) |
| `ctx.local` | Per-document scratch state |
| `await ctx.storage.get()` / `.set(value)` | This pack’s persistent JSON state, up to 64 KB |
| `await ctx.request(url, options)` | Background HTTP on declared login/API origins |
| `await ctx.page.run(fn, ...args)` | Run a self-contained function against the actual page’s JavaScript globals |
| `await ctx.click(key, element)` | Deduplicated visible-control click |
| `await ctx.navigate(key, absoluteUrl)` | Approved navigation in the current frame/tab; pass `{ target: "tab" }` as the third argument to leave a child frame |
| `await ctx.notice(text)` | Non-persisted user guidance |
| `await ctx.complete({ returnUrl })` | End ownership and optionally return the parent tab to an approved URL |
| `ctx.current()`, `ctx.signal` | Cooperative cancellation and checks after awaits |

`ctx.request` accepts `method`, `headers`, a string `body`, `credentials` (`include` by default, or `omit`), `timeoutMs` (default 30000; 0 disables the timeout) and `redirect` (`error` by default, or `manual` since 0.11.2). It returns `{ ok, status, headers, body }`. Responses are bounded to 1 MB. Automatic redirect following is unavailable: `manual` stops at a redirect and returns `{ ok: false, status: 0, opaqueRedirect: true, headers: {}, body: "" }`. Fetch hides the target; this marker is not proof of successful authentication. Resume through a known browser URL rather than guessing Location or forwarding a password POST. Browser cookie policies still apply. The core does not persist request/response content. Avoid repeating submissions after every DOM mutation or automatically retrying an uncertain POST.

`ctx.page.run` receives serialized arguments and returns JSON up to 64 KB. It cannot capture the adapter’s lexical variables: pass values as arguments. Code executes in the authenticated document through Chrome’s native MAIN-world API, never worker eval. Page code can observe values deliberately passed into its own world. Background calls and asynchronous page code do not hold the journey queue; Stop remains responsive.

## Ownership and compatibility

The shared discovery phase retains its ten-minute/thirty-action guard. After API 2 handoff those guards no longer govern the institution flow, and the core stops its publisher/discovery heuristics. The pack decides completion and its own timeout/retry policy. Returning to a publisher alone does not report success. Stop aborts SDK contexts and denies further host operations; arbitrary pack JavaScript must cooperate with cancellation. Updating/removing a pack revokes capabilities; already executing arbitrary JavaScript cannot be forcibly removed from a loaded document. Use a fresh login page after changes.

Imported code runs through Chrome’s [User Scripts API](https://developer.chrome.com/docs/extensions/reference/api/userScripts); custom setup uses Chrome’s [sandbox pages](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox). Approved hosts, browser permissions, CORS for page-side fetch, cookie policy and OS access remain browser boundaries. A pack is not a native executable. Separate worlds isolate globals, not the shared DOM; trust the maintainer. Pack IDs and fingerprints do not verify publisher identity.

API 1 source packs keep their earlier bounded behavior. Legacy settings-only `.institution.json` packs and bundled libraries remain supported. Native reference capture stays with Zotero Connector/EndNote Click. No downloader or library-write API is exposed; any future agent-driven attachment retrieval must coordinate a minimum 30-second article interval.
