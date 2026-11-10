# Testing

## Fast feedback

```sh
pnpm run check
pnpm run lint --max-warnings 0
pnpm run test:unit
```

Run a focused unit file by appending its path:

```sh
pnpm run test:unit src/__tests__/network/appRuntimeGraph.test.ts
```

## Packaged E2E

E2E runs the packaged Electron application rather than substituting a browser mock:

```sh
pnpm run test:prepare-e2e
pnpm run test:e2e:calibrate
pnpm run test:e2e --tags="@smoke"
```

Arguments are passed directly to the repository runner. Use combined `--tags=...` form or `--name "Scenario title"`; do not insert an extra `--`.

Timeout calibration is mandatory. A timeout is treated as a product or cleanup defect, not solved by silently increasing constants. Tests must close Electron windows, UtilityProcesses, workers, servers and database handles they own.

For manual observation of a prepared E2E artifact:

```sh
pnpm run test:manual-e2e
```
