import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
    VALIDATION_REPAIR_ATTEMPTS: z.coerce.number().int().positive().default(5),
    VISUAL_REVIEW_ENABLED: z.stringbool().default(true),
    VISUAL_REVIEW_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
    VISUAL_REVIEW_STARTUP_TIMEOUT_MS: z.coerce.number().int().positive().default(120000)
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

export const config = {
  ...parsed.data,
  jiraForceIncludeKeys: (parsed.data.JIRA_FORCE_INCLUDE_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  hardBlockedKeywordPattern:
    /\b(api[ -]?keys?|secrets?|private keys?|token rotation|database migrations?|schema migrations?|data backfills?|infrastructure migrations?|terraform|kubernetes|helm|deploy(?:ment|ments)?|ci\/cd|github actions|billing|payment)\b/i,
  weakRequirementThreshold: 20
};

export type AppConfig = typeof config;
