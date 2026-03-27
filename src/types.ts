export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria?: string;
  url: string;
}

export interface ValidationStepResult {
  command: string;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface ValidationResult {
  success: boolean;
  steps: ValidationStepResult[];
}

export type AgentDecision = "applied" | "needs_human_review" | "no_changes";

export interface AgentRunResult {
  decision: AgentDecision;
  summary: string;
  reason?: string;
  changedFiles: string[];
}

export interface PullRequestInfo {
  number: number;
  url: string;
}

export type WorkerRunStatus =
  | "success"
  | "no_ticket"
  | "skipped"
  | "needs_human_review"
  | "validation_failed"
  | "failed";

export interface WorkerRunResult {
  ok: boolean;
  status: WorkerRunStatus;
  ticketKey?: string;
  branchName?: string;
  pullRequestUrl?: string;
  message: string;
  validation?: ValidationResult;
  commitSha?: string;
}

export interface RepositoryContextFile {
  path: string;
  content: string;
}

export interface RepositoryContext {
  topLevelEntries: string[];
  selectedFiles: RepositoryContextFile[];
}

export interface AgentPatchResponse {
  decision: "apply_patch" | "needs_human_review";
  summary: string;
  reason?: string;
  patch?: string;
}
