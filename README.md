# Runner Challenger

Discord-first running challenge bot for the monthly group accountability MVP.

For the architecture and agent-facing user-flow map, see [docs/CONTEXT.md](docs/CONTEXT.md) and [docs/USER_FLOWS.md](docs/USER_FLOWS.md).

## What It Does

- Registers Discord slash commands for goal setting, screenshot-backed proof submissions, status, and leaderboard views.
- Tracks monthly goals, carryover penalties, leader assignments, admin run overrides, punishment notes, and month close summaries.
- Can read clear run screenshots with local Tesseract OCR when users do not type distance/date.
- Runs a proof-backed weekly Garmin sleep challenge with public normalized scores and private stage insights.
- Persists state to a JSON file so the bot survives restarts.
- Keeps the challenge core independent from Discord so a later web app can reuse the same service layer.

## Commands

| Command | Purpose |
| --- | --- |
| `/goal-set distance_km` | Set your own base monthly goal. Carryover is added automatically when applicable. |
| `/run-submit proof [distance_km] [run_date] [source] [note]` | Log a run with phone screenshot proof. If distance/date are omitted, the bot can privately read the screenshot and show Log Run / Cancel buttons before saving. |
| `/sleep-submit proof total_sleep_minutes sleep_date [sleep_start] [sleep_end] [deep_sleep_minutes] [light_sleep_minutes] [rem_sleep_minutes] [awake_minutes]` | Log a Garmin sleep screenshot. The date is the local wake date; confirmed details are posted in a compact public receipt. |
| `/sleep-leaderboard` | Show qualifying standings for the current Monday-Sunday sleep week. |
| `/sleep-status` | Show your current average, logged nights, streak, and qualification status. |
| `/sleep-insights` | Privately compare Garmin stage estimates with your own history. |
| `/profile-set image_url` | Set a custom profile image URL for status thumbnails and future richer leaderboard cards. |
| `/leaderboard` | Show current standings for the active month. |
| `/status` | Show your current month progress against your goal. |
| `/punishments` | Show the month's group punishments. |
| `/leader-help` | Show the commands available to the assigned leader. |
| `/admin-start-month month` | Create a challenge month for goal setting and run logging. The bot also creates the current month on startup. |
| `/admin-close-month month` | Close the month and calculate missed-distance carryovers. |
| `/admin-assign-leader member` | Assign the current month's leader. |
| `/leader-record-punishment note` | Record a group punishment as the assigned leader or server admin. |
| `/leader-remove-punishment punishment_number` | Remove a numbered group punishment as the assigned leader. |
| `/admin-override-run submission_id action distance_km` | Correct or remove a submitted run. |
| `/admin-record-punishment note` | Record a group punishment for a missed month. |

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

## Sleep Challenge

Submit a Garmin sleep screenshot and the values shown on it:

```text
/sleep-submit proof:<Garmin screenshot> total_sleep_minutes:466 sleep_date:YYYY-MM-DD sleep_start:23:28 sleep_end:07:15 deep_sleep_minutes:200 light_sleep_minutes:247 rem_sleep_minutes:19 awake_minutes:1
```

The public leaderboard uses a transparent `Challenge Sleep Score`: 60 points for total sleep duration (full points from 7-9 hours, tapering outside that range) and 40 points for consistency with the member's own prior sleep midpoint. During the first three nights without enough midpoint history, the duration component is normalized to a provisional 0-100 score. Four logged nights are required to qualify for the weekly leaderboard.

When OCR reads the required total and wake date, `/sleep-submit` shows a private confirmation before saving. If either required field is missing, it returns rerun instructions instead. After confirmation, the public receipt includes the date, total, window, and any reliably recognized stage values; the screenshot URL is never posted or persisted. `/sleep-insights` remains private and, after seven earlier stage-bearing screenshots, compares Deep, REM, and Awake minutes with the member's own historical range. Garmin stage estimates are never compared between members, and the command is not medical advice.

If `total_sleep_minutes` or `sleep_date` is omitted, OCR reads Garmin's stable Total Sleep and Sleep Score Duration layouts and returns suggested values. Rerun the command with the confirmed values before the record is saved.

After a run is logged, the Discord reply includes a generated `Run Summary` PNG. The card uses `assets/run-summary/template.png`, fills the run date, run distance, remaining personal distance, remaining group distance, and rotates through bundled local incentive artwork.

## Profile Images

The bot saves each member's Discord avatar URL when they use a command. Users can override that with:

```text
/profile-set image_url:https://example.com/avatar.png
```

Custom image URLs must be public `http` or `https` URLs. `/status` uses the saved image as a Discord thumbnail. The text leaderboard keeps the compact row layout for now; the saved profile image data is ready for a future generated leaderboard card.

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
