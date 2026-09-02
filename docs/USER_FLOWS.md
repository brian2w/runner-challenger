# User Flows

This is the concise map of intentional user-visible behavior. Code and tests are authoritative; the command catalog is the canonical command inventory. The flow-coverage test keeps this file synchronized with registered slash commands.

## Participant flows

### `/goal-set`

Sets the participant's base monthly distance goal. Prior missed-distance carryover is added automatically to the effective target.

### `/run-submit`

Logs a proof-backed run in the active month. Typed distance and date save immediately; OCR-derived fields require the participant's private confirmation. A submission must have proof and a date inside the active month.

### `/sleep-submit`

Logs one Garmin proof-backed sleep record for its local wake date. Total sleep, wake date, and reliable stage values may be read from a screenshot with OCR; the bot shows a private confirmation before saving. After confirmation, the channel receives a compact receipt with the logged details. The bot retains proof submission, not the screenshot URL.

### `/sleep-leaderboard`

Shows the current Monday-Sunday sleep standings. Public ranking uses normalized duration and personal schedule consistency; four logged nights are required to qualify. Sleep stages never affect public ranking.

### `/sleep-status`

Shows the participant's current-week sleep average, logged nights, streak, and qualification status.

### `/sleep-insights`

Privately compares Garmin Deep, REM, and Awake estimates against the participant's own history. It is not medical advice and does not compare stages between participants.

### `/profile-set`

Sets a public custom image URL for Discord status thumbnails. A custom URL is retained instead of later platform-avatar refreshes.

### `/leaderboard`

Shows active-month running standings, ordered by percent of effective goal completed, then distance. The group total covers members with goals.

### `/status`

Shows the participant's active-month running progress. It may include their saved profile thumbnail in Discord.

### `/punishments`

Shows group punishment records for the active month. Recording attribution remains audit data and is not routine output.

### `/leader-help`

Explains leader and admin capabilities for the active month.

## Admin and leader flows

### `/admin-start-month`

Creates an open monthly running challenge and its deterministic notification intents. Starting an existing month repairs missing intents without duplicating them.

### `/admin-close-month`

Closes a monthly running challenge, calculates results and carryovers, and is retry-safe. A closed month does not absorb members registered later.

### `/admin-assign-leader`

Assigns one participant as the month's leader. A new assignment replaces the previous one.

### `/leader-record-punishment`

Lets the assigned leader or a server admin record a group punishment for the active month.

### `/leader-remove-punishment`

Lets only the assigned leader remove a numbered active-month punishment.

### `/admin-override-run`

Lets a server admin remove a run submission or replace its distance. The adjusted submission changes running totals and standings.

### `/admin-record-punishment`

Lets a server admin record a group punishment when no leader action is available.
