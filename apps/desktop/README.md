# MemeLoop Desktop

MemeLoop Desktop is the dedicated Electron host for the decentralized MemeLoop
Agent network. It provides local and remote Agent conversations, Device/PeerId
discovery, signed pairing, Cloud relay coordination, model/provider settings,
long-conversation navigation, tool approval, and SSH onboarding for remote
compute nodes.

This application deliberately does not include TidGi's Wiki/workspace, Git
backup, BrowserView, FRP/PIN node, or second-identity runtimes. TiddlyWiki host
integration belongs to TidGi Desktop and the reusable `@memeloop/react-ui`
plugin surface; it is not implemented by this standalone application.

## Requirements

- Node.js 24
- pnpm 11.17.0

Desktop is an independent nested pnpm workspace with its own lockfile so its
Electron native dependency graph remains isolated from the Expo application.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run start:dev
```

Use the following gates before pushing:

```bash
pnpm run check
pnpm run lint --max-warnings 0
pnpm run test:unit
pnpm run test:prepare-e2e
pnpm run test:package-runtime
pnpm run test:package-startup
```

Production installers are created with `pnpm run make`. Packaging targets
Windows x64/arm64, macOS Intel/Apple Silicon, and Linux x64/arm64 through the
repository release workflow.

## Runtime boundaries

- `memeloop` supplies the portable Agent, storage, synchronization, framing,
  orchestration, and DeviceNetwork contracts.
- `@memeloop/libp2p` supplies the authenticated libp2p transport.
- `@memeloop/react-ui` supplies the shared responsive Agent UI.
- The Electron main process owns one DeviceNetwork identity and passes that
  identity into the isolated UtilityProcess Agent runtime.
- Renderer code uses context-isolated IPC and never receives provider secrets
  or private identity material.

See [Development.md](docs/Development.md), [Testing.md](docs/Testing.md), and
[MCP.md](docs/MCP.md) for focused workflows.
