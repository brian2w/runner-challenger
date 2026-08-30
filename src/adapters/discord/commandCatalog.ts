export interface SlashCommandOption {
  name: string;
  description: string;
  type: "string" | "number" | "integer" | "attachment" | "user";
  required: boolean;
}

export interface SlashCommandDefinition {
  name: string;
  description: string;
  adminOnly?: boolean;
  options?: SlashCommandOption[];
}

export const slashCommands: SlashCommandDefinition[] = [
  {
    name: "goal-set",
    description: "Set your base monthly distance goal in kilometers.",
    options: [{ name: "distance_km", description: "Base goal distance.", type: "number", required: true }],
  },
  {
    name: "run-submit",
    description: "Log a run with screenshot proof. Distance/date can be typed or OCR-assisted.",
    options: [
      { name: "proof", description: "Phone screenshot showing the run details.", type: "attachment", required: true },
      { name: "distance_km", description: "Run distance in km, if not using OCR.", type: "number", required: false },
      { name: "run_date", description: "Run date in YYYY-MM-DD, if not using OCR.", type: "string", required: false },
      { name: "source", description: "Proof source, for example Garmin or Apple Fitness.", type: "string", required: false },
      { name: "note", description: "Optional context for the leader/admin.", type: "string", required: false },
    ],
  },
  {
    name: "sleep-submit",
    description: "Log Garmin sleep with screenshot proof and total sleep in minutes.",
    options: [
      { name: "proof", description: "Garmin sleep screenshot.", type: "attachment", required: true },
      { name: "total_sleep_minutes", description: "Total sleep shown by Garmin, in minutes.", type: "integer", required: true },
      { name: "sleep_date", description: "Wake date in YYYY-MM-DD.", type: "string", required: true },
      { name: "sleep_start", description: "Optional start time in 24-hour HH:MM.", type: "string", required: false },
      { name: "sleep_end", description: "Optional end time in 24-hour HH:MM.", type: "string", required: false },
      { name: "deep_sleep_minutes", description: "Optional Deep sleep minutes.", type: "integer", required: false },
      { name: "light_sleep_minutes", description: "Optional Light sleep minutes.", type: "integer", required: false },
      { name: "rem_sleep_minutes", description: "Optional REM sleep minutes.", type: "integer", required: false },
      { name: "awake_minutes", description: "Optional Awake minutes.", type: "integer", required: false },
    ],
  },
  {
    name: "sleep-leaderboard",
    description: "Show this week's qualifying sleep challenge standings.",
  },
  {
    name: "sleep-status",
    description: "Show your current sleep challenge score and streak.",
  },
  {
    name: "sleep-insights",
    description: "Privately compare your Garmin stage estimates with your own history.",
  },
  {
    name: "profile-set",
    description: "Set a custom profile image URL for status and future leaderboard cards.",
    options: [{ name: "image_url", description: "Public http or https image URL.", type: "string", required: true }],
  },
  {
    name: "leaderboard",
    description: "Show current standings for the month.",
  },
  {
    name: "status",
    description: "Show your current month progress against your goal.",
  },
  {
    name: "punishments",
    description: "Show the month's group punishments.",
  },
  {
    name: "leader-help",
    description: "Show commands available to the assigned leader.",
  },
  {
    name: "admin-start-month",
    description: "Create a challenge month for goal setting and run logging.",
    adminOnly: true,
    options: [{ name: "month", description: "Target month in YYYY-MM.", type: "string", required: true }],
  },
  {
    name: "admin-close-month",
    description: "Close the month and calculate carryovers.",
    adminOnly: true,
    options: [{ name: "month", description: "Target month in YYYY-MM.", type: "string", required: true }],
  },
  {
    name: "admin-assign-leader",
    description: "Assign the current month's leader.",
    adminOnly: true,
    options: [{ name: "member", description: "Discord member.", type: "user", required: true }],
  },
  {
    name: "leader-record-punishment",
    description: "Record a group punishment as the assigned leader or server admin.",
    options: [{ name: "note", description: "Punishment for everyone who missed the month.", type: "string", required: true }],
  },
  {
    name: "leader-remove-punishment",
    description: "Remove a punishment as the assigned leader.",
    options: [{ name: "punishment_number", description: "Number shown by /punishments.", type: "integer", required: true }],
  },
  {
    name: "admin-override-run",
    description: "Correct or remove a submitted run.",
    adminOnly: true,
    options: [
      { name: "submission_id", description: "Submission to override.", type: "string", required: true },
      { name: "action", description: "remove or replace_distance.", type: "string", required: true },
      { name: "distance_km", description: "Replacement distance when correcting.", type: "number", required: false },
    ],
  },
  {
    name: "admin-record-punishment",
    description: "Record a group punishment for a missed month.",
    adminOnly: true,
    options: [{ name: "note", description: "Punishment for everyone who missed the month.", type: "string", required: true }],
  },
];
