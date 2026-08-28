# Unit-test conventions

- Assert user-visible behavior with Testing Library semantic queries.
- Wrap observable emissions, timers and asynchronous UI transitions in `act` or await their visible result.
- Give each test fresh subjects and mocks; never reuse mutable state across cases.
- Test IPC descriptors as allowlists. A main-process method is not renderer-safe merely because it exists on a service class.
- Keep large-conversation tests bounded by both message count and bytes, and assert cursor/window behavior rather than loading an entire transcript.
- Treat warnings as failures in CI.

Tests that need native `better-sqlite3` run through Electron with `ELECTRON_RUN_AS_NODE=1`, as encoded in the package scripts. Use the scripts rather than invoking Vitest directly.
