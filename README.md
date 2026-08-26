# memeloop-app

MemeLoop App — AI agent desktop (Electron) and mobile (Expo) applications.

## Structure

```
memeloop-app/
├── apps/
│   ├── desktop/    # Electron desktop app (AI agent interface, node management)
│   └── mobile/     # Expo React Native mobile app (companion)
├── pnpm-workspace.yaml
└── package.json
```

## Dependencies

Desktop and mobile consume the published MemeLoop packages from npm:

| Package | Version |
|---------|---------|
| `memeloop` | `0.2.7` |
| `@memeloop/libp2p` | `0.2.4` |
| `memeloop-cli` | `0.2.6` (desktop) |
| `@memeloop/react-ui` | `0.1.5` (desktop) |

## Quick Start

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
