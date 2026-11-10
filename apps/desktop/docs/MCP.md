# Chrome DevTools MCP

The development command exposes the renderer debugging endpoint on port `9222`:

```sh
pnpm run start:dev:mcp
```

The repository `.vscode/mcp.json` connects Chrome DevTools MCP to `http://localhost:9222`. Use its page list to select the main or preferences window. This debugging port is development-only and must not be enabled in production artifacts.
