import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const DEFAULT_VALIDATION_COMMANDS = [
  "npm ci",
  "npm run lint",
  "npm run build",
  "npm run test"
] as const;

const DEFAULT_HARD_BLOCKED_KEYWORDS = [
  "api key",
  "secret",
  "private key",
  "token rotation",
  "database migration",
  "schema migration",
  "data backfill",
  "infrastructure migration",
  "terraform",
  "kubernetes",
  "helm"
] as const;

const configSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.string().default("info"),
    JIRA_BASE_URL: z.url(),
    JIRA_EMAIL: z.email(),
    JIRA_API_TOKEN: z.string().min(1),
    JIRA_JQL: z.string().trim().optional(),
    JIRA_FORCE_INCLUDE_KEYS: z.string().trim().optional(),
    JIRA_PROJECT_KEY: z.string().trim().optional(),
    JIRA_QUEUE_LABEL: z.string().trim().default("ai-ready"),
    JIRA_QUEUE_STATUS: z.string().trim().optional(),
    JIRA_DONE_LABEL: z.string().trim().min(1).default("ai-done"),
    JIRA_REVIEW_TRANSITION_NAME: z.string().trim().min(1).default("In Review"),
    JIRA_COMMENT_PREFIX: z.string().trim().min(1).default("AI Agent:"),
    GITHUB_API_BASE_URL: z.url().default("https://api.github.com"),
    GITHUB_TOKEN: z.string().min(1),
    GITHUB_OWNER: z.string().min(1),
    GITHUB_REPO: z.string().min(1),
    GIT_REMOTE_URL: z.string().min(1),
    GIT_BASE_BRANCH: z.string().min(1).default("main"),
    GIT_DIRECT_COMMITS: z.stringbool().default(false),
    WORK_ROOT: z.string().min(1).default("./workdir"),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().min(1).default("gpt-5.4"),
    CODEX_CLI_PATH: z.string().min(1).default("codex"),
    CODEX_PROFILE: z.string().trim().optional(),
    CODEX_USE_ATLASSIAN_MCP: z.stringbool().default(true),
    GUARDRAIL_HARD_BLOCKED_KEYWORDS: z.string().trim().optional(),
    GUARDRAIL_SCAN_HUMAN_COMMENTS: z.stringbool().default(false),
    GUARDRAIL_WEAK_REQUIREMENT_THRESHOLD: z.coerce.number().int().positive().default(20),
    BYPASS_CONFIRMATION_REVIEW_FOLLOW_UP: z.stringbool().default(false),
    VALIDATION_COMMANDS: z.string().trim().optional(),
    VALIDATION_REPAIR_ATTEMPTS: z.coerce.number().int().positive().default(5),
    DRY_RUN_BY_DEFAULT: z.stringbool().default(false),
    PREVENT_SLEEP_DURING_RUNS: z.stringbool().default(false),
    VISUAL_REVIEW_ENABLED: z.stringbool().default(true),
    VISUAL_REVIEW_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    VISUAL_REVIEW_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    VISUAL_REVIEW_STORAGE_STATE: z.string().trim().optional()
  })
  .superRefine((value, context) => {
    if (!value.JIRA_JQL && !value.JIRA_PROJECT_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JIRA_JQL"],
        message: "Set either JIRA_JQL or JIRA_PROJECT_KEY."
      });
    }
  });

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

let validationCommands: string[];
let hardBlockedKeywords: string[];

try {
  validationCommands = parseValidationCommands(parsed.data.VALIDATION_COMMANDS);
} catch (error) {
  console.error("Invalid environment configuration", {
    VALIDATION_COMMANDS: [error instanceof Error ? error.message : String(error)]
  });
  process.exit(1);
}

try {
  hardBlockedKeywords = parseKeywordList(parsed.data.GUARDRAIL_HARD_BLOCKED_KEYWORDS);
} catch (error) {
  console.error("Invalid environment configuration", {
    GUARDRAIL_HARD_BLOCKED_KEYWORDS: [error instanceof Error ? error.message : String(error)]
  });
  process.exit(1);
}

export const config = {
  ...parsed.data,
  validationCommands,
  jiraForceIncludeKeys: (parsed.data.JIRA_FORCE_INCLUDE_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  hardBlockedKeywords,
  scanHumanCommentsInGuardrails: parsed.data.GUARDRAIL_SCAN_HUMAN_COMMENTS,
  bypassConfirmationReviewFollowUp: parsed.data.BYPASS_CONFIRMATION_REVIEW_FOLLOW_UP,
  weakRequirementThreshold: parsed.data.GUARDRAIL_WEAK_REQUIREMENT_THRESHOLD
};

export type AppConfig = typeof config;

function parseValidationCommands(value?: string): string[] {
  if (!value?.trim()) {
    return [...DEFAULT_VALIDATION_COMMANDS];
  }

  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    const parsedJson = JSON.parse(trimmed);
    if (!Array.isArray(parsedJson)) {
      throw new Error("VALIDATION_COMMANDS must be a JSON array of command strings.");
    }

    const commands = parsedJson
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);

    if (commands.length === 0) {
      throw new Error("VALIDATION_COMMANDS must contain at least one non-empty command.");
    }

    return commands;
  }

  const commands = trimmed
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (commands.length === 0) {
    throw new Error("VALIDATION_COMMANDS must contain at least one non-empty command.");
  }

  return commands;
}

function parseKeywordList(value?: string): string[] {
  if (value === undefined) {
    return [...DEFAULT_HARD_BLOCKED_KEYWORDS];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsedJson = JSON.parse(trimmed);
    if (!Array.isArray(parsedJson)) {
      throw new Error("GUARDRAIL_HARD_BLOCKED_KEYWORDS must be a JSON array of strings.");
    }

    return parsedJson
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  return trimmed
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
