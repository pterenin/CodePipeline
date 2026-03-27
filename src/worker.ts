import type { AppConfig } from "./config.js";
import type { JiraTicket, WorkerRunResult } from "./types.js";
import { AgentService } from "./services/agent.js";
import { GitService } from "./services/git.js";
import { GitHubService } from "./services/github.js";
import { JiraService } from "./services/jira.js";
import { ValidatorService } from "./services/validator.js";
import { Logger } from "./utils/logger.js";
import { hasStrongRequirements } from "./utils/text.js";

export class Worker {
  private readonly logger = new Logger("worker");
  private readonly jiraService: JiraService;
  private readonly githubService: GitHubService;
  private readonly gitService: GitService;
  private readonly validatorService: ValidatorService;
  private readonly agentService: AgentService;
  private isRunning = false;

  constructor(private readonly config: AppConfig) {
    this.jiraService = new JiraService(config);
    this.githubService = new GitHubService(config);
    this.gitService = new GitService(config);
    this.validatorService = new ValidatorService();
    this.agentService = new AgentService(config);
  }

  get running(): boolean {
    return this.isRunning;
  }

  async runNext(): Promise<WorkerRunResult> {
    if (this.isRunning) {
      throw new Error("Worker is already running.");
    }

    this.isRunning = true;

    try {
      const ticket = await this.jiraService.getNextTicket();
      if (!ticket) {
        return {
          ok: true,
          status: "no_ticket",
          message: "No Jira ticket matched the configured JQL filter."
        };
      }

      return await this.processTicket(ticket);
    } finally {
      this.isRunning = false;
    }
  }

  private async processTicket(ticket: JiraTicket): Promise<WorkerRunResult> {
    this.logger.info(`Processing ticket ${ticket.key}`);

    const guardrailFailure = this.evaluateGuardrails(ticket);
    if (guardrailFailure) {
      await this.safeJiraComment(ticket.key, `Automation skipped: ${guardrailFailure}`);
      return {
        ok: true,
        status: "skipped",
        ticketKey: ticket.key,
        message: guardrailFailure
      };
    }

    await this.safeJiraComment(ticket.key, "Automation started. Preparing isolated repository workspace.");

    const { repoPath, branchName, git } = await this.gitService.prepareRepository(ticket.key, ticket.summary);

    const initialAgentRun = await this.agentService.implementTicket(ticket, repoPath);
    if (initialAgentRun.decision === "needs_human_review") {
      const message = initialAgentRun.reason ?? initialAgentRun.summary;
      await this.safeJiraComment(ticket.key, `Automation stopped and needs human review.\n\nReason: ${message}`);
      return {
        ok: true,
        status: "needs_human_review",
        ticketKey: ticket.key,
        branchName,
        message
      };
    }

    if (initialAgentRun.decision === "no_changes") {
      const message = initialAgentRun.reason ?? "Agent produced no code changes.";
      await this.safeJiraComment(ticket.key, `Automation could not produce a safe change.\n\nReason: ${message}`);
      return {
        ok: false,
        status: "failed",
        ticketKey: ticket.key,
        branchName,
        message
      };
    }

    let validation = await this.validatorService.run(repoPath);
    if (!validation.success) {
      await this.safeJiraComment(ticket.key, "Initial validation failed. Attempting one automated repair pass.");
      const repairRun = await this.agentService.repairFromValidation(ticket, repoPath, validation);

      if (repairRun.decision === "applied") {
        validation = await this.validatorService.run(repoPath);
      } else if (repairRun.decision === "needs_human_review") {
        const message = repairRun.reason ?? "Repair pass requires human review.";
        await this.safeJiraComment(ticket.key, `Automation repair pass stopped.\n\nReason: ${message}`);
        return {
          ok: false,
          status: "validation_failed",
          ticketKey: ticket.key,
          branchName,
          message,
          validation
        };
      }
    }

    if (!validation.success) {
      await this.safeJiraComment(
        ticket.key,
        `Automation failed validation after one repair attempt.\n\nLatest failed step: ${
          validation.steps[validation.steps.length - 1]?.command ?? "unknown"
        }`
      );
      return {
        ok: false,
        status: "validation_failed",
        ticketKey: ticket.key,
        branchName,
        message: "Validation failed after one repair attempt.",
        validation
      };
    }

    const hasChanges = await this.gitService.hasChanges(git);
    if (!hasChanges) {
      await this.safeJiraComment(ticket.key, "Automation completed without file changes, so no commit or PR was created.");
      return {
        ok: false,
        status: "failed",
        ticketKey: ticket.key,
        branchName,
        message: "Validation passed but repository has no file changes."
      };
    }

    const commitSha = await this.gitService.commitAndPush(
      git,
      branchName,
      `${ticket.key}: ${ticket.summary}`
    );

    const pullRequest = await this.githubService.createDraftPullRequest({
      branchName,
      title: `${ticket.key}: ${ticket.summary}`,
      ticketKey: ticket.key,
      ticketUrl: ticket.url,
      summaryOfChanges: initialAgentRun.summary,
      validation
    });

    await this.safeJiraComment(
      ticket.key,
      `Automation completed successfully.\n\nDraft PR: ${pullRequest.url}\nBranch: ${branchName}\nCommit: ${commitSha}`
    );

    return {
      ok: true,
      status: "success",
      ticketKey: ticket.key,
      branchName,
      pullRequestUrl: pullRequest.url,
      commitSha,
      validation,
      message: "Draft pull request created successfully."
    };
  }

  private evaluateGuardrails(ticket: JiraTicket): string | null {
    const combinedText = `${ticket.summary}\n${ticket.description}\n${ticket.acceptanceCriteria ?? ""}`;
    if (this.config.riskyKeywordPattern.test(combinedText)) {
      return "Ticket contains risky keywords and is outside automation scope.";
    }

    if (!hasStrongRequirements(combinedText, this.config.weakRequirementThreshold)) {
      return "Ticket requirements are too weak or incomplete for safe automation.";
    }

    return null;
  }

  private async safeJiraComment(ticketKey: string, body: string): Promise<void> {
    try {
      await this.jiraService.addComment(ticketKey, body);
    } catch (error) {
      this.logger.warn(`Failed to add Jira comment for ${ticketKey}`, error);
    }
  }
}
