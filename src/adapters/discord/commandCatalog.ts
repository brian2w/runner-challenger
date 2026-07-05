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
    name: "leaderboard",
    description: "Show current standings for the month.",
  },
  {
    name: "status",
    description: "Show your current month progress against your goal.",
  },
  {
    name: "punishments",
    description: "Show recorded punishments for yourself or another member.",
    options: [{ name: "member", description: "Discord member to inspect.", type: "user", required: false }],
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
    description: "Record a punishment as the assigned leader or server admin.",
    options: [
      { name: "member", description: "Member receiving the punishment.", type: "user", required: true },
      { name: "note", description: "Punishment note.", type: "string", required: true },
    ],
  },
  {
    name: "leader-remove-punishment",
    description: "Remove a punishment as the assigned leader.",
    options: [{ name: "punishment_id", description: "Punishment id to remove.", type: "string", required: true }],
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
