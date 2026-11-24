# Translation

Supported locales are listed in `localization/supportedLanguages.json`. Each locale has:

- `translation.json` for application and preference strings;
- `agent.json` for reusable agent/chat UI strings.

Add the same key to every supported locale, then run:

```sh
pnpm run lint --max-warnings 0
pnpm run test:unit src/services/preferences/definitions/__tests__/schemaValidation.test.ts
```

Do not introduce user-visible fallback literals for new flows. Narrow-screen and error/action states must use the same translated keys as the full-width UI.
