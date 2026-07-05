# Runner Challenger

Discord-first running challenge bot for the monthly group accountability MVP.

## What It Does

- Registers Discord slash commands for goal setting, screenshot-backed proof submissions, status, and leaderboard views.
- Tracks monthly goals, carryover penalties, leader assignments, admin run overrides, punishment notes, and month close summaries.
- Can read clear run screenshots with local Tesseract OCR when users do not type distance/date.
- Persists state to a JSON file so the bot survives restarts.
- Keeps the challenge core independent from Discord so a later web app can reuse the same service layer.

## Commands

| Command | Purpose |
| --- | --- |
| `/goal-set distance_km` | Set your own base monthly goal. Carryover is added automatically when applicable. |
| `/run-submit proof [distance_km] [run_date] [source] [note]` | Log a run with phone screenshot proof. If distance/date are omitted, the bot can privately read the screenshot and show Log Run / Cancel buttons before saving. |
| `/leaderboard` | Show current standings for the active month. |
| `/status` | Show your current month progress against your goal. |
| `/punishments [member]` | Show recorded punishments for yourself or another member. |
| `/leader-help` | Show the commands available to the assigned leader. |
| `/admin-start-month month` | Create a challenge month for goal setting and run logging. The bot also creates the current month on startup. |
| `/admin-close-month month` | Close the month and calculate missed-distance carryovers. |
| `/admin-assign-leader member` | Assign the current month's leader. |
| `/leader-record-punishment member note` | Record a punishment as the assigned leader or server admin. |
| `/leader-remove-punishment punishment_id` | Remove a punishment as the assigned leader. |
| `/admin-override-run submission_id action distance_km` | Correct or remove a submitted run. |
| `/admin-record-punishment member note` | Record a punishment note for a missed month. |

Admin commands require Discord's Manage Server permission.
The assigned leader can record and remove punishments for the active month. The group goal shown on `/leaderboard` is the sum of members' effective monthly goals.

## Local Verification

```bash
npm run test
npm run dry-run
```

`npm run dry-run` builds the app, creates an in-memory challenge, submits a proof-backed run, and prints the resulting leaderboard without needing Discord credentials.

## Live Discord Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Invite the bot to your test server with `applications.commands` and `bot` scopes.
3. Give the bot permission to read/send messages in the challenge channels.
4. Copy `.env.example` to `.env` or export the same variables in your shell.
5. Start the bot:

```bash
npm run build
DISCORD_TOKEN=... DISCORD_CLIENT_ID=... DISCORD_GUILD_ID=... npm run start
```

The app registers guild slash commands on startup unless `REGISTER_COMMANDS=false`.

## Proof Submission Flow

Users submit runs directly in Discord:

```text
/run-submit proof:<phone screenshot> distance_km:5.24 run_date:2026-07-05 source:Garmin
```

Typed `distance_km` and `run_date` log immediately. If those fields are omitted and OCR can read the screenshot, the bot privately asks the user to confirm the detected distance/date with a `Log Run` button. If OCR cannot read the screenshot clearly, rerun the command with the values typed manually.

The OCR boundary is provider-based so Tesseract can be replaced later with PaddleOCR, native mobile OCR, or a hosted vision model without changing challenge rules.

### Local OCR

Tesseract is the default local OCR provider. Install it on the host running the bot, or disable OCR and keep using typed distance/date:

```bash
OCR_PROVIDER=none
```

Optional Tesseract settings:

```bash
OCR_PROVIDER=tesseract
TESSERACT_BINARY=tesseract
TESSERACT_LANGUAGE=eng
```

## Data

Default storage is `.tmp/runner-challenger.json`. Set `DATA_FILE` to use a different location.

The JSON repository is intentionally simple for MVP testing. If the group keeps using the bot, the next durability step is swapping `ChallengeRepository` to SQLite or Postgres without changing the challenge service.

## Access Notes

The pasted Google Doc content is the working product plan for this implementation. The direct Google Doc URL requires authorization from this environment, so it was not readable unless the doc is made public or a Google Docs/Drive connector is authorized.

The Discord invite alone does not expose server contents to this environment. The bot can operate in that server after you create a Discord application, invite the bot, and provide `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
