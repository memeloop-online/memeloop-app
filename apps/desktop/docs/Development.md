# Development

MemeLoop Desktop is the standalone Electron host for the shared MemeLoop agent runtime and UI. It does not include TidGi workspace, Wiki, Git, FRP, PIN, or secondary-identity services.

## Requirements

- Node.js 24
- pnpm 11
- platform build tools required by `better-sqlite3`

## Local workflow

```sh
pnpm install --frozen-lockfile
pnpm run start:init
```

After the first start, `pnpm run start:dev` is sufficient. Before pushing:

```sh
pnpm run check
pnpm run lint --max-warnings 0
pnpm run test:unit
```

The main process, preload and renderer are isolated by Electron security boundaries. Add renderer capabilities only through an explicit IPC descriptor and keep privileged helpers main-process-only.

Device networking reuses the single host identity managed by `DeviceNetworkService`. The isolated UtilityProcess must receive that identity from the host and must never create an independent one.

On a restricted network, set `MEMELOOP_ELECTRON_ZIP_DIR` to a directory containing Electron Packager's exact `electron-v<version>-<platform>-<arch>.zip` artifact.
