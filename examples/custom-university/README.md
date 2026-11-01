# Fictional institution-owned login pack

This example demonstrates an independent API 2 pack. It has no live university verification.

The pack supplies its own realm/account/password setup screen and nested private configuration. Its adapter chooses the configured realm, calls existing page JavaScript through `ctx.page.run`, checks a session through a background API POST, saves pack-specific state and explicitly completes the login with a publisher return. The account/password fields demonstrate private configuration; this fictional flow does not submit them.

Build with `npm run institution:build -- examples/custom-university`, then drag the `.instpack` into Institution packs. All hosts are fictional. The Chromium fixtures intercept them and use fake data. A real institution must replace the code, setup controls, APIs, hosts and validation with its verified flow. See [the pack guide](../../docs/institution-packs.md).
