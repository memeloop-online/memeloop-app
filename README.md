# memeloop-app

MemeLoop App — AI agent desktop (Electron) and mobile (Expo) applications.

## Structure

```
memeloop-app/
├── apps/
│   ├── desktop/    # Electron app; independent nested pnpm workspace + lockfile
│   └── mobile/     # Expo React Native mobile app (companion)
├── pnpm-workspace.yaml
└── package.json
```

## Dependencies

Desktop and mobile consume the published MemeLoop packages from npm:

| Package | Version |
|---------|---------|
| `memeloop` | `0.2.9` |
| `@memeloop/libp2p` | `0.2.5` |
| `memeloop-cli` | installed Desktop release (manifest-pinned) |
| `@memeloop/react-ui` | `0.1.7` |

Desktop SSH onboarding reads the installed CLI's `MEMELOOP_CLI_VERSION` and
passes that exact release to `memeloop remote bootstrap`. Strict host-key
checking is the default; accepting a new key is an explicit first-connection
choice in the onboarding window. The remote host must provide Node.js 24+ and
npm.

## Quick Start

The root pnpm workspace manages Mobile. Desktop remains an independent nested
workspace so Electron's native dependency graph and lockfile stay isolated
from Expo. Always install Desktop from `apps/desktop` so each lockfile has a
single, non-overlapping scope.

```bash
# Desktop
cd apps/desktop
pnpm install
pnpm start:dev          # Development
pnpm test:unit           # Unit tests
pnpm check               # TypeScript check

# Mobile
cd apps/mobile
npx expo install
npx expo start
```

## Architecture

- **Desktop**: Electron + Vite + React. Services use inversify DI. IPC via electron-ipc-cat.
- **Mobile**: Expo Router + React Native Paper. Connects through authenticated MemeLoop DeviceNetwork transports.
- **Shared**: `memeloop` (portable protocol/types) and `@memeloop/react-ui` (desktop UI components).
