# TypeScript frontend shared contracts

## Requirements

### Requirement: Shared message contracts must be described by TypeScript

WebSocket and project read model shared messages must have TypeScript type constraints.

#### Scenario: projects update reducer uses typed messages

- **When** the frontend handles `projects_updated` WebSocket messages
- **Then** the reducer input must use TypeScript types
- **And** `pnpm run typecheck` must cover the reducer

#### Scenario: Node backend still boots

- **When** shared message tool migration is complete
- **Then** production imports used by `node server/index.js` must not point to `.ts` files that Node cannot directly execute
- **And** no new server TS runner must be introduced

### Requirement: API client must be migrated to TypeScript

The frontend API client must provide basic types to reduce caller guesswork about response shape.

#### Scenario: auth requests use typed fetch helper

- **When** the frontend calls auth APIs or regular APIs
- **Then** the API helper must be written in TypeScript
- **And** callers must still handle non-2xx, JSON parse failures, and network errors

### Requirement: Chat message dedup must be migrated to TypeScript

Chat message dedup logic must express input/output contracts under TS.

#### Scenario: duplicate realtime messages are not shown twice

- **When** co or Codex events arrive duplicated
- **Then** the frontend must deduplicate according to existing rules
- **And** dedup tools must be covered by TypeScript type checking

### Requirement: i18n and session activity helpers must be migrated to TypeScript

Lightweight helpers should be migrated first to avoid expanding the JS surface.

#### Scenario: language list stays compatible

- **When** the settings page reads available languages
- **Then** `languages` and `isLanguageSupported` behavior must remain unchanged
- **And** after file migration to TypeScript, related tests must still pass

#### Scenario: session activity state stays compatible

- **When** the project home page computes session activity state
- **Then** unread/running/idle display logic must remain unchanged
- **And** after helper migration to TypeScript, static tests must reference the new paths

### Requirement: Migration must not change server build process

This migration only changes frontend and shared contracts; it does not introduce server TS build.

#### Scenario: package scripts keep Node server running directly

- **When** a developer inspects `package.json`
- **Then** the `server` script must still be able to run the Node backend directly
- **And** no `tsx server/*`, `ts-node`, or server compilation step must be added
