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
| `memeloop-cli` | `0.2.7` (desktop) |
| `@memeloop/react-ui` | `0.1.7` |

Desktop SSH onboarding always installs the reviewed, exact
`memeloop-cli@0.2.7` release. The dependency range remains compatible with
patch releases, but changing the bootstrap version requires an explicit code,
test and packaging-gate update.

## Quick Start

The root pnpm workspace manages Mobile. Desktop remains an independent nested
workspace because it also owns `packages/tidgi-shared`; always install Desktop
from `apps/desktop` so each lockfile has a single, non-overlapping scope.

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
