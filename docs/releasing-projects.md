# Separate project releases

Release **in-stitution** and each institution integration as independent projects. Each has its own version, source archive, changelog, license, tests and publishing destination. An institution release does not require a new framework release unless it needs a new SDK capability.

## Build the outputs

```sh
npm test
npm run check
npm run test:browser
npm run test:institutions
npm run release:projects
```

The release command produces:

```text
dist/releases/
  in-stitution-0.11.2/
    in-stitution-0.11.2.zip
    in-stitution-0.11.2-source.zip
  sustech-in-1.1.0/
    sustech-in-1.1.0.instpack
    sustech-in-1.1.0-source.zip
  projects.json
```

The core ZIP is the browser extension. It excludes independently packaged institution directories, their implementation, defaults, credentials UI and evidence. Its source archive also excludes those project directories. A clean installation starts with **Choose your institution**.

An institution `.instpack` contains only its declared adapter/resources and optional README/LICENSE. Its source ZIP is an independent repository root: `package.json`, README, changelog, license, tests, scripts and `pack/`. Build outputs, private credentials, session data and traces are excluded. Private browser configuration never enters either archive.

## Publish as separate projects

Public preview destinations are [in-stitution](https://github.com/dumixthestpd/in-stitution) and [sustech-in](https://github.com/dumixthestpd/sustech-in). Each repository publishes only its own source and release assets; use prerelease tags until its acceptance checks are complete.

Create a repository/release destination for the framework and a separate one for the institution project. Extract each `-source.zip` into its own repository root. Tag the framework with its framework version and the institution project with its own version. Upload only that project's corresponding runtime artifact and source archive to its release.

The current checkout has no configured remote/public release destination. Generating archives does not publish them or create a hosted repository. Configure the actual repository URLs, maintainer contacts and update channels before public distribution; do not invent links or imply an official university endorsement.

The institution source project uses the framework checkout as its build/test SDK. For an extracted project, set `INSTITUTION_FRAMEWORK` to the framework source directory, then use its own `npm test` and `npm run package`. The installed browser pack has no Node/Python build-tool dependency.

## Upgrade existing installations

Install/update the core first, then install the separate institution pack. Existing unsupported library records fall back to manual login without releasing their old stored credentials. Stored records are preserved until explicitly changed; they are not silently transferred to executable pack code. Configure the institution pack through its own screen and choose a local credentials file only if you want to import one.

A newly packaged institution adapter must distinguish the old integration's live evidence from its own fixture/live results. Check one authorized fresh off-campus flow before enabling automatic sign-in. Keep the previous working version available as a rollback while testing the migration.
