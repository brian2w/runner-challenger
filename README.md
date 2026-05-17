# Runner Challenger

Discord-first running challenge bot for the monthly group accountability MVP.

## What It Does

- Registers Discord slash commands for goal setting, screenshot-backed runs, Strava sync, status, and leaderboard views.
- Tracks monthly goals, carryover penalties, leader assignments, admin run overrides, punishment notes, and month close summaries.
- Imports Strava runs through OAuth and `/strava-sync`.
- Persists state to a JSON file so the bot survives restarts.
- Keeps the challenge core independent from Discord so a later web app can reuse the same service layer.

## Commands

- `/goal-set distance_km`
- `/run-submit distance_km run_date screenshot`
- `/leaderboard`
- `/status`
- `/strava-connect`
- `/strava-sync`
- `/admin-start-month month`
- `/admin-close-month month`
- `/admin-assign-leader member`
- `/admin-override-run submission_id action distance_km`
- `/admin-record-punishment member note`

Admin commands require Discord's Manage Server permission.

## Local Verification

```bash
npm run test
npm run dry-run
```

`npm run dry-run` builds the app, creates an in-memory challenge, imports fake Strava runs, and prints the resulting leaderboard without needing Discord credentials.

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

## Strava Setup

1. Create a Strava API app.
2. Set the authorization callback domain to match `STRAVA_REDIRECT_URI`.
3. Configure:

```bash
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_REDIRECT_URI=http://localhost:3000/strava/callback
STRAVA_STATE_SECRET=some-long-random-secret
```

Users run `/strava-connect`, open the private OAuth link, authorize Strava, then return to Discord and run `/strava-sync`.

For local development, Strava allows `localhost` and `127.0.0.1` callback URLs. For a hosted bot, point `STRAVA_REDIRECT_URI` at the public HTTPS callback URL.

## Data

Default storage is `.tmp/runner-challenger.json`. Set `DATA_FILE` to use a different location.

The JSON repository is intentionally simple for MVP testing. If the group keeps using the bot, the next durability step is swapping `ChallengeRepository` to SQLite or Postgres without changing the challenge service.

## Access Notes

The pasted Google Doc content is the working product plan for this implementation. The direct Google Doc URL requires authorization from this environment, so it was not readable unless the doc is made public or a Google Docs/Drive connector is authorized.

The Discord invite alone does not expose server contents to this environment. The bot can operate in that server after you create a Discord application, invite the bot, and provide `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
