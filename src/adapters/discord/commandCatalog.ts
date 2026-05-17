export interface SlashCommandOption {
  name: string;
  description: string;
  type: "string" | "number" | "attachment" | "user";
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
    description: "Submit a screenshot-backed run for the active month.",
    options: [
      { name: "distance_km", description: "Run distance.", type: "number", required: true },
      { name: "run_date", description: "ISO date for the run.", type: "string", required: true },
      { name: "screenshot", description: "Screenshot attachment URL.", type: "attachment", required: true },
    ],
  },
  {
    name: "leaderboard",
    description: "Show current standings for the month.",
  },
  {
    name: "status",
    description: "Show your current progress against your goal.",
  },
  {
    name: "strava-connect",
    description: "Start Strava account linking.",
  },
  {
    name: "strava-sync",
    description: "Import new Strava activities for the month.",
  },
  {
    name: "admin-start-month",
    description: "Create the monthly challenge shell.",
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
    description: "Record a punishment note for a missed month.",
    adminOnly: true,
    options: [
      { name: "member", description: "Member receiving the punishment.", type: "user", required: true },
      { name: "note", description: "Punishment note.", type: "string", required: true },
    ],
  },
];
