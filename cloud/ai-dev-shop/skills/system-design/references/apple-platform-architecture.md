# Apple Platform Architecture

Use this reference only when the target is an iOS or macOS application. This material is adapted from the Apple-specific `architecture-spec` source package.

## Good Defaults

- **UI**: SwiftUI by default for modern targets
- **State**: `@State`, `@Binding`, `@Environment`, and `@Observable` depending on scope
- **Persistence**: SwiftData when the deployment target and maturity profile support it
- **Networking**: `URLSession` with `async/await`
- **Security**: Keychain for tokens and sensitive credentials
- **Concurrency**: `async/await`, actors, and `@MainActor` for UI updates

Do not force these choices if the existing app or platform constraints justify UIKit, Core Data, TCA, or another established pattern.

## Architecture Patterns

Reasonable Apple-client options:

- MVVM with SwiftUI for simple to medium complexity
- Clean Architecture when boundaries and provider swappability matter
- TCA when explicit state/event modeling complexity is justified

## Module Shape

Typical structure:

```text
App/
Features/
Core/
Models/
Services/
Resources/
Tests/
```

Organize features vertically when possible. Keep reusable cross-feature code in `Core/`.

## State and Data Flow

Useful state layers:

1. **View state** for local transient UI
2. **ViewModel or observable state** for shared presentation/business coordination
3. **Persistent state** for local data and syncable records

Example flow:

```text
User action
-> view invokes view model
-> view model invokes service or API client
-> response updates observable state
-> UI re-renders
-> optional persistence or sync
```

## Security and Privacy

- store secrets in Keychain
- use HTTPS everywhere
- avoid hardcoded secrets
- document privacy-sensitive data collection
- support deletion and consent requirements where applicable

## Performance and Testing

Watch:

- cold and warm launch time
- memory pressure
- image and background-task behavior
- ViewModel and service test coverage

Useful verification layers:

- unit tests for logic
- integration tests for persistence/network seams
- UI tests for high-value user journeys

## Deployment and Ops

- define environment separation clearly
- document debug vs release behavior
- keep CI simple at first: build, lint, unit tests
- add crash/perf monitoring intentionally, not by default clutter
