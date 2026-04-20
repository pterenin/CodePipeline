export interface JiraTicket {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria?: string;
  imageAttachments?: JiraImageAttachment[];
  htmlAttachments?: JiraHtmlAttachment[];
  comments?: JiraComment[];
  humanComments?: string[];
  url: string;
}

export interface JiraComment {
  id?: string;
  authorName?: string;
  createdAt?: string;
  updatedAt?: string;
  bodyText: string;
}

export interface JiraImageAttachment {
  filename: string;
  mimeType: string;
  contentUrl: string;
  thumbnailUrl?: string;
}

export interface JiraHtmlAttachment {
  filename: string;
  mimeType: string;
  contentUrl: string;
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

export interface ImplementationReviewResult {
  decision: "approved" | "needs_follow_up" | "needs_human_review";
  summary: string;
  findings: string[];
  reviewPath: string;
  changedFiles: string[];
  reason?: string;
}

export interface VisualReviewResult {
  decision: "approved" | "needs_follow_up" | "skipped" | "needs_human_review";
  summary: string;
  findings: string[];
  reportPath: string;
  artifactPaths: string[];
  reason?: string;
}

export interface AgentFileEdit {
  path: string;
  content: string;
}

export interface PullRequestInfo {
  number: number;
  url: string;
}

export type WorkerRunStatus =
  | "success"
  | "no_ticket"
  | "skipped"
  | "stopped"
  | "needs_human_review"
  | "validation_failed"
  | "failed";

export interface WorkerRunResult {
  ok: boolean;
  status: WorkerRunStatus;
  dryRun?: boolean;
  ticketKey?: string;
  branchName?: string;
  pullRequestUrl?: string;
  message: string;
  validation?: ValidationResult;
  commitSha?: string;
  processedTickets?: number;
  successfulTickets?: number;
  failedTickets?: number;
}

export const WORKFLOW_STEP_DEFINITIONS = [
  { id: "fetch_ticket", label: "Fetch Tickets" },
  { id: "evaluate_guardrails", label: "Guardrails" },
  { id: "comment_start", label: "Start Comment" },
  { id: "prepare_repository", label: "Prepare Repo" },
  { id: "implement_changes", label: "Implement" },
  { id: "visual_review", label: "Visual Review" },
  { id: "review_implementation", label: "Review" },
  { id: "validation", label: "Validate" },
  { id: "commit_push", label: "Commit & Push" },
  { id: "create_pull_request", label: "Create PR" },
  { id: "finalize_jira", label: "Finalize Jira" }
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEP_DEFINITIONS)[number]["id"];

export type WorkflowStepStatus = "idle" | "running" | "completed" | "failed" | "skipped";

export type WorkflowRunStatus = "idle" | "running" | "stopping" | "completed" | "failed";

export interface WorkflowStepState {
  id: WorkflowStepId;
  label: string;
  status: WorkflowStepStatus;
  detail?: string | undefined;
  currentCommand?: string | undefined;
  output: string[];
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
}

export interface WorkflowLogEntry {
  timestamp: string;
  message: string;
  stepId?: WorkflowStepId | undefined;
}

export type TicketRunState = "queued" | "running" | "done" | "failed";

export interface TicketQueueItem {
  key: string;
  summary: string;
  url: string;
  status: TicketRunState;
  detail?: string | undefined;
}

export interface WorkerRunSnapshot {
  runId: number;
  status: WorkflowRunStatus;
  stopRequested?: boolean | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  currentStepId?: WorkflowStepId | undefined;
  currentTicketKey?: string | undefined;
  result?: WorkerRunResult | undefined;
  tickets: TicketQueueItem[];
  steps: WorkflowStepState[];
  logs: WorkflowLogEntry[];
}

export interface RepositoryContextFile {
  path: string;
  content: string;
}

export interface RepositorySearchResult {
  query: string;
  matches: string[];
}

export interface RepositoryContext {
  topLevelEntries: string[];
  fileCatalog: string[];
  discoveryQueries: string[];
  searchResults: RepositorySearchResult[];
  selectedFiles: RepositoryContextFile[];
}

export interface AgentChangeResponse {
  decision: "apply_changes" | "needs_human_review";
  summary: string;
  reason?: string;
  files?: AgentFileEdit[];
}

export interface AgentContextRequestResponse {
  decision: "request_more_context" | "apply_changes" | "needs_human_review";
  summary: string;
  reason?: string;
  files?: AgentFileEdit[] | string[];
  queries?: string[];
}
