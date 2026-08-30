# Runner Challenger Context

Read this before changing user-facing behavior. This is an orientation map, not a second source of truth: executable behavior lives in code and tests.

## Architecture

| Layer | Responsibility | Starting point |
| --- | --- | --- |
| Momentum core | Platform-neutral domain types, rules, services, and repository port | `src/momentum/index.ts` |
| Persistence | In-memory test repository and durable JSON implementation | `src/repositories/` |
| Discord adapter | Slash commands, permissions, attachments, OCR, buttons, and rendering | `src/adapters/discord/` |
| User flow map | Intentional user-visible behavior and non-negotiable rules | `docs/USER_FLOWS.md` |

The core must not import Discord. A future web app or Garmin sync adapter should call `ChallengeService` or `SleepService`, rather than duplicate their rules.

## Where to change behavior

| Change | Owner |
| --- | --- |
| New or changed slash command | `commandCatalog.ts`, Discord adapter, `USER_FLOWS.md` |
| Run goals, submissions, carryovers, or monthly standings | `ChallengeService` and `core/calculations.ts` |
| Sleep submission, score, standings, or insights | `SleepService` |
| Persisted data | `ChallengeRepository` plus both repository implementations |
| Discord copy or privacy | `DiscordPresenter` and the relevant Discord flow |

## Documentation contract

`USER_FLOWS.md` deliberately describes outcomes and rules, not every option or response string. `commandCatalog.ts` is the command inventory. `tests/userFlows.test.ts` requires one flow heading for every registered command and rejects stale headings.

When changing a user-visible command, permission, privacy boundary, scoring rule, or lifecycle rule, update its flow entry and focused tests in the same change.
