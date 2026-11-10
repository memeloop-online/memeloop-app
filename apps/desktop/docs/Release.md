# Release

Releases are produced from the canonical branch by the repository workflow. A release candidate must pass:

```sh
pnpm install --frozen-lockfile
pnpm run validate:push
pnpm run test:unit
pnpm run test:prepare-e2e
pnpm run test:e2e:calibrate
pnpm run test:e2e
pnpm run make
pnpm run test:package-runtime
```

The packaged-runtime verifier rejects inherited Wiki/workspace files, source-checkout package links, missing native binaries and absent UtilityProcess resources. Do not publish an artifact when that verifier fails.

Use Node 24 on every build platform. Windows signing and installer acceptance, macOS Intel/Apple Silicon startup, and Linux packaging remain separate release evidence; one platform does not substitute for another.
