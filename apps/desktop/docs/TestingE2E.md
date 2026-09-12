# E2E diagnostics

The E2E harness uses a scenario-specific `userData` directory and the packed application under `out/`. Rebuild after changing production source with `pnpm run test:prepare-e2e`.

Useful filters:

```sh
pnpm run test:e2e --tags="@smoke"
pnpm run test:e2e --name "Application launches"
```

Set `SHOW_E2E_WINDOW=1` only for local observation. CI evidence should come from the normal harness, logs and screenshots. If a run does not exit, inspect the Cucumber `After` hook for an owned resource that was not closed; do not force success with a longer timeout.
