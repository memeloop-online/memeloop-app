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

Desktop and mobile depend on `memeloop` monorepo packages via `link:`:

| Package | Source |
|---------|--------|
| `memeloop` | `../memeloop/packages/memeloop` |
| `memeloop-node` | `../memeloop/packages/memeloop-node` |
| `@memeloop/protocol` | `../memeloop/packages/memeloop-protocol` |
| `@memeloop/ui` | `../memeloop/packages/memeloop-ui` |
| `@memeloop/prompt-editor` | `../memeloop/packages/memeloop-prompt-editor` |

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
- **Mobile**: Expo Router + React Native Paper. Connects to memeloop-node via WebSocket.
- **Shared**: `@memeloop/protocol` (types), `@memeloop/ui` (UI components), `@memeloop/prompt-editor` (form widgets).
