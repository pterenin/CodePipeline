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
    this.logger.info("Worker run started");

    try {
      const ticket = await this.jiraService.getNextTicket();
      if (!ticket) {
        this.logger.info("No Jira ticket found to work on for the current JQL filter");
        this.logger.info("Worker run finished with no ticket");
        return {
          ok: true,
          status: "no_ticket",
          message: "No Jira ticket matched the configured JQL filter."
        };
      }

      this.logger.info("Jira ticket found for processing", {
        ticketKey: ticket.key,
        summary: ticket.summary,
        acceptanceCriteriaPresent: Boolean(ticket.acceptanceCriteria),
        recentHumanComments: ticket.recentHumanComments?.length ?? 0,
        url: ticket.url
      });

      return await this.processTicket(ticket);
    } finally {
      this.logger.info("Worker run finished");
      this.isRunning = false;
    }
  }

  private async processTicket(ticket: JiraTicket): Promise<WorkerRunResult> {
    this.logger.info(`Processing ticket ${ticket.key}`, {
      summary: ticket.summary
    });

    const guardrailFailure = this.evaluateGuardrails(ticket);
    if (guardrailFailure) {
      this.logger.warn("Ticket skipped by guardrails", {
        ticketKey: ticket.key,
        reason: guardrailFailure
      });
      await this.safeJiraComment(ticket.key, `Automation skipped: ${guardrailFailure}`);
      return {
        ok: true,
        status: "skipped",
        ticketKey: ticket.key,
        message: guardrailFailure
      };
    }

    this.logger.info("Posting start comment to Jira", { ticketKey: ticket.key });
    await this.safeJiraComment(ticket.key, "Automation started. Preparing isolated repository workspace.");

    this.logger.info("Preparing repository workspace", { ticketKey: ticket.key });
    const { repoPath, branchName, git, cleanup } = await this.gitService.prepareRepository(ticket.key, ticket.summary);
    this.logger.info("Repository worktree prepared", { repoPath, branchName });

    try {
      this.logger.info("Running agent implementation pass", { ticketKey: ticket.key });
      const initialAgentRun = await this.agentService.implementTicket(ticket, repoPath);
      if (initialAgentRun.decision === "needs_human_review") {
        const message = initialAgentRun.reason ?? initialAgentRun.summary;
        this.logger.warn("Implementation requires human review", {
          ticketKey: ticket.key,
          reason: message
        });
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
        this.logger.warn("Implementation produced no changes", {
          ticketKey: ticket.key,
          reason: message
        });
        await this.safeJiraComment(ticket.key, `Automation could not produce a safe change.\n\nReason: ${message}`);
        return {
          ok: false,
          status: "failed",
          ticketKey: ticket.key,
          branchName,
          message
        };
      }

      this.logger.info("Running validation after implementation", { ticketKey: ticket.key });
      let validation = await this.validatorService.run(repoPath);
      for (let attempt = 1; !validation.success && attempt <= this.config.VALIDATION_REPAIR_ATTEMPTS; attempt += 1) {
        this.logger.warn("Validation failed; starting automated repair attempt", {
          ticketKey: ticket.key,
          attempt,
          maxAttempts: this.config.VALIDATION_REPAIR_ATTEMPTS,
          failedCommand: validation.steps[validation.steps.length - 1]?.command
        });
        await this.safeJiraComment(
          ticket.key,
          `Validation failed. Attempting automated repair ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS}.`
        );

        const repairRun = await this.agentService.repairFromValidation(ticket, repoPath, validation);

        if (repairRun.decision === "applied") {
          this.logger.info("Repair attempt applied changes; rerunning validation", {
            ticketKey: ticket.key,
            attempt
          });
          validation = await this.validatorService.run(repoPath);
          continue;
        }

        if (repairRun.decision === "needs_human_review") {
          const message = repairRun.reason ?? "Repair attempt requires human review.";
          this.logger.warn("Repair attempt requires human review", {
            ticketKey: ticket.key,
            attempt,
            reason: message
          });
          await this.safeJiraComment(ticket.key, `Automation repair attempt stopped.\n\nReason: ${message}`);
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
        this.logger.warn("Validation failed after maximum repair attempts", {
          ticketKey: ticket.key,
          attempts: this.config.VALIDATION_REPAIR_ATTEMPTS,
          failedCommand: validation.steps[validation.steps.length - 1]?.command
        });
        await this.safeJiraComment(
          ticket.key,
          `Automation failed validation after ${this.config.VALIDATION_REPAIR_ATTEMPTS} repair attempt(s).\n\nLatest failed step: ${
            validation.steps[validation.steps.length - 1]?.command ?? "unknown"
          }`
        );
        return {
          ok: false,
          status: "validation_failed",
          ticketKey: ticket.key,
          branchName,
          message: `Validation failed after ${this.config.VALIDATION_REPAIR_ATTEMPTS} repair attempt(s).`,
          validation
        };
      }

      this.logger.info("Checking whether repository has changes to commit", {
        ticketKey: ticket.key
      });
      const hasChanges = await this.gitService.hasChanges(git);
      if (!hasChanges) {
        this.logger.warn("Validation passed but no file changes were present", {
          ticketKey: ticket.key
        });
        await this.safeJiraComment(ticket.key, "Automation completed without file changes, so no commit or PR was created.");
        return {
          ok: false,
          status: "failed",
          ticketKey: ticket.key,
          branchName,
          message: "Validation passed but repository has no file changes."
        };
      }

      this.logger.info("Committing and pushing changes", {
        ticketKey: ticket.key,
        branchName
      });
      const commitSha = await this.gitService.commitAndPush(
        git,
        branchName,
        `${ticket.key}: ${ticket.summary}`
      );

      this.logger.info("Creating draft pull request", {
        ticketKey: ticket.key,
        branchName
      });
      const pullRequest = await this.githubService.createDraftPullRequest({
        branchName,
        title: `${ticket.key}: ${ticket.summary}`,
        ticketKey: ticket.key,
        ticketUrl: ticket.url,
        summaryOfChanges: initialAgentRun.summary,
        validation
      });

      this.logger.info("Posting success comment to Jira", {
        ticketKey: ticket.key,
        pullRequestUrl: pullRequest.url
      });
      await this.safeJiraComment(
        ticket.key,
        `Automation completed successfully.\n\nDraft PR: ${pullRequest.url}\nBranch: ${branchName}\nCommit: ${commitSha}`
      );
      await this.safeAddDoneLabel(ticket.key);

      this.logger.info("Ticket processed successfully", {
        ticketKey: ticket.key,
        branchName,
        pullRequestUrl: pullRequest.url
      });

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
    } finally {
      await cleanup();
    }
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

  private async safeAddDoneLabel(ticketKey: string): Promise<void> {
    try {
      await this.jiraService.addLabel(ticketKey, "ai-done");
    } catch (error) {
      this.logger.warn(`Failed to add ai-done label for ${ticketKey}`, error);
    }
  }
}
