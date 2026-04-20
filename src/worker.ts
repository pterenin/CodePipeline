import type { AppConfig } from "./config.js";
import type { ImplementationReviewResult, JiraTicket, VisualReviewResult, WorkerRunResult } from "./types.js";
import type { RunMonitor } from "./run-monitor.js";
import { AgentService } from "./services/agent.js";
import { GitService } from "./services/git.js";
import { GitHubService } from "./services/github.js";
import { JiraService } from "./services/jira.js";
import { ValidatorService } from "./services/validator.js";
import { VisualReviewService } from "./services/visual-review.js";
import { Logger } from "./utils/logger.js";
import { evaluateTicketGuardrails } from "./utils/guardrails.js";

interface WorkerRunOptions {
  dryRun?: boolean;
}

export class Worker {
  private readonly logger = new Logger("worker");
  private readonly jiraService: JiraService;
  private readonly githubService: GitHubService;
  private readonly gitService: GitService;
  private readonly validatorService: ValidatorService;
  private readonly agentService: AgentService;
  private readonly visualReviewService: VisualReviewService;
  private isRunning = false;
  private stopRequested = false;
  private abortController: AbortController | undefined;

  constructor(private readonly config: AppConfig) {
    this.jiraService = new JiraService(config);
    this.githubService = new GitHubService(config);
    this.gitService = new GitService(config);
    this.validatorService = new ValidatorService(config.validationCommands);
    this.agentService = new AgentService(config);
    this.visualReviewService = new VisualReviewService(config);
  }

  get running(): boolean {
    return this.isRunning;
  }

  requestStop(monitor?: RunMonitor): boolean {
    if (!this.isRunning) {
      return false;
    }

    if (this.stopRequested) {
      return true;
    }

    this.stopRequested = true;
    this.abortController?.abort(new WorkerStoppedError());
    this.logger.warn("Stop requested for active worker run");
    monitor?.markStopRequested("Stop requested. Halting the pipeline as soon as the current work is interrupted safely.");
    return true;
  }

  async runNext(monitor?: RunMonitor, options?: WorkerRunOptions): Promise<WorkerRunResult> {
    if (this.isRunning) {
      throw new Error("Worker is already running.");
    }

    const dryRun = options?.dryRun ?? this.config.DRY_RUN_BY_DEFAULT;
    this.isRunning = true;
    this.stopRequested = false;
    this.abortController = new AbortController();
    this.logger.info("Worker run started", { dryRun });
    monitor?.startRun();
    monitor?.log("Worker run started.");
    if (dryRun) {
      monitor?.log("Dry run mode is enabled. Publish, PR creation, and Jira mutation steps will be skipped.");
    }

    try {
      monitor?.startStep("fetch_ticket", "Loading Jira tickets that match the queue filter.");
      const tickets = await this.jiraService.getQueuedTickets();
      if (tickets.length === 0) {
        this.logger.info("No Jira tickets found to work on for the current JQL filter");
        this.logger.info("Worker run finished with no ticket");
        const result: WorkerRunResult = {
          ok: true,
          status: "no_ticket",
          ...(dryRun ? { dryRun: true } : {}),
          message: "No Jira ticket matched the configured JQL filter."
        };
        monitor?.completeStep("fetch_ticket", result.message);
        monitor?.log(result.message, "fetch_ticket");
        monitor?.finishRun(result);
        return result;
      }

      this.logger.info("Jira tickets found for processing", {
        count: tickets.length,
        ticketKeys: tickets.map((ticket) => ticket.key)
      });
      monitor?.setTickets(tickets);
      monitor?.completeStep(
        "fetch_ticket",
        `Loaded ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} from Jira.`,
        tickets.map((ticket) => `${ticket.key}: ${ticket.summary}`)
      );
      monitor?.log(
        `Loaded Jira queue: ${tickets.map((ticket) => ticket.key).join(", ")}.`,
        "fetch_ticket"
      );

      const result = await this.processTickets(tickets, monitor, { dryRun });
      monitor?.finishRun(result);
      return result;
    } catch (error) {
      if (isWorkerStoppedError(error)) {
        const result: WorkerRunResult = {
          ok: true,
          status: "stopped",
          ...(dryRun ? { dryRun: true } : {}),
          message: "Pipeline stopped by user request."
        };
        monitor?.failCurrentStep(result.message);
        monitor?.log(result.message);
        monitor?.finishRun(result);
        return result;
      }

      const message = error instanceof Error ? error.message : "Unknown worker error";
      monitor?.failCurrentStep(message);
      monitor?.log(`Worker run failed: ${message}`);
      monitor?.finishRun({
        ok: false,
        status: "failed",
        ...(dryRun ? { dryRun: true } : {}),
        message
      });
      throw error;
    } finally {
      this.logger.info("Worker run finished");
      this.isRunning = false;
      this.stopRequested = false;
      this.abortController = undefined;
    }
  }

  private async processTickets(
    tickets: JiraTicket[],
    monitor?: RunMonitor,
    options?: WorkerRunOptions
  ): Promise<WorkerRunResult> {
    let successfulTickets = 0;
    let failedTickets = 0;
    let lastResult: WorkerRunResult | undefined;

    for (const ticket of tickets) {
      this.throwIfStopped();
      monitor?.startTicket(ticket.key, `Processing ${ticket.key}: ${ticket.summary}`);
      monitor?.log(`Starting ticket ${ticket.key}.`);

      const ticketResult = await this.processTicket(ticket, monitor, options);
      lastResult = ticketResult;

      if (ticketResult.status === "success") {
        successfulTickets += 1;
        monitor?.finishTicket(ticket.key, "done", ticketResult.message);
      } else {
        failedTickets += 1;
        monitor?.finishTicket(ticket.key, "failed", ticketResult.message);
      }

      monitor?.log(
        `Finished ticket ${ticket.key} with status ${ticketResult.status}.`,
      );
    }

    const processedTickets = tickets.length;
    const resultStatus: WorkerRunResult["status"] =
      processedTickets === 0
        ? "no_ticket"
        : failedTickets > 0
          ? "failed"
          : "success";

    return {
      ok: failedTickets === 0,
      status: resultStatus,
      ...(options?.dryRun ? { dryRun: true } : {}),
      ...(lastResult?.ticketKey ? { ticketKey: lastResult.ticketKey } : {}),
      ...(lastResult?.branchName ? { branchName: lastResult.branchName } : {}),
      ...(lastResult?.pullRequestUrl ? { pullRequestUrl: lastResult.pullRequestUrl } : {}),
      ...(lastResult?.commitSha ? { commitSha: lastResult.commitSha } : {}),
      ...(lastResult?.validation ? { validation: lastResult.validation } : {}),
      processedTickets,
      successfulTickets,
      failedTickets,
      message:
        failedTickets > 0
          ? `Processed ${processedTickets} tickets. ${successfulTickets} succeeded and ${failedTickets} failed.`
          : options?.dryRun
            ? `Dry run processed ${processedTickets} tickets successfully.`
            : `Processed ${processedTickets} tickets successfully.`
    };
  }

  private async processTicket(
    ticket: JiraTicket,
    monitor?: RunMonitor,
    options?: WorkerRunOptions
  ): Promise<WorkerRunResult> {
    this.throwIfStopped();
    this.logger.info(`Processing ticket ${ticket.key}`, {
      summary: ticket.summary
    });
    const dryRun = options?.dryRun ?? false;
    const useDirectCommits = this.shouldUseDirectCommits();

    if (this.config.GIT_DIRECT_COMMITS && !useDirectCommits) {
      this.logger.warn("Direct commits were requested but base branch is main; using PR flow instead", {
        ticketKey: ticket.key,
        baseBranch: this.config.GIT_BASE_BRANCH
      });
      monitor?.log(
        `Direct commits requested, but GIT_BASE_BRANCH=${this.config.GIT_BASE_BRANCH} is protected by policy. Using regular PR flow.`,
        "evaluate_guardrails"
      );
    }

    monitor?.startStep("evaluate_guardrails", `Checking whether ${ticket.key} is safe to automate.`);
    this.throwIfStopped();
    const guardrailFailure = this.evaluateGuardrails(ticket);
    if (guardrailFailure) {
      this.logger.warn("Ticket skipped by guardrails", {
        ticketKey: ticket.key,
        reason: guardrailFailure
      });
      monitor?.skipStep("evaluate_guardrails", guardrailFailure);
      monitor?.log(`Ticket ${ticket.key} was skipped by guardrails.`, "evaluate_guardrails");
      monitor?.skipStep("comment_start", "Jira comments are only posted after a draft PR is created.");
      monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
      return {
        ok: true,
        status: "skipped",
        ...(dryRun ? { dryRun: true } : {}),
        ticketKey: ticket.key,
        message: guardrailFailure
      };
    }
    monitor?.completeStep("evaluate_guardrails", "Ticket passed automation guardrails.");

    monitor?.skipStep("comment_start", "Jira comments are only posted after a draft PR is created.");

    this.throwIfStopped();
    this.logger.info("Preparing repository workspace", { ticketKey: ticket.key });
    monitor?.startStep("prepare_repository", "Creating isolated git worktree and branch.");
    const { repoPath, branchName, git, cleanup } = await this.gitService.prepareRepository(ticket.key, ticket.summary);
    this.logger.info("Repository worktree prepared", { repoPath, branchName });
    monitor?.completeStep("prepare_repository", `Worktree ready on branch ${branchName}.`, [repoPath]);

    try {
      this.throwIfStopped();
      this.logger.info("Running agent ticket-context pass", { ticketKey: ticket.key });
      monitor?.startStep("document_context", "Analyzing the ticket and refreshing the ticket context markdown.");
      const contextRun = await this.agentService.documentTicketContext(ticket, repoPath, {
        onProgress: (message) => {
          monitor?.setStepDetail("document_context", message);
        },
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
      });
      this.throwIfStopped();
      if (contextRun.decision === "needs_human_review") {
        const message = contextRun.reason ?? contextRun.summary;
        this.logger.warn("Ticket context documentation requires human review", {
          ticketKey: ticket.key,
          reason: message
        });
        monitor?.failStep("document_context", message, contextRun.changedFiles);
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: true,
          status: "needs_human_review",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message
        };
      }

      if (contextRun.decision === "no_changes") {
        const message = contextRun.reason ?? "Agent did not refresh the ticket context markdown.";
        this.logger.warn("Ticket context documentation produced no changes", {
          ticketKey: ticket.key,
          reason: message
        });
        monitor?.failStep("document_context", message);
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: false,
          status: "failed",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message
        };
      }
      monitor?.completeStep(
        "document_context",
        contextRun.summary,
        contextRun.changedFiles.length > 0 ? contextRun.changedFiles : undefined
      );

      this.logger.info("Running agent implementation pass", { ticketKey: ticket.key });
      monitor?.startStep("implement_changes", "Running the implementation agent from the documented ticket context.");
      const initialAgentRun = await this.agentService.implementTicket(ticket, repoPath, {
        onProgress: (message) => {
          monitor?.setStepDetail("implement_changes", message);
        },
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
      });
      this.throwIfStopped();
      if (initialAgentRun.decision === "needs_human_review") {
        const message = initialAgentRun.reason ?? initialAgentRun.summary;
        this.logger.warn("Implementation requires human review", {
          ticketKey: ticket.key,
          reason: message
        });
        monitor?.failStep("implement_changes", message, initialAgentRun.changedFiles);
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: true,
          status: "needs_human_review",
          ...(dryRun ? { dryRun: true } : {}),
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
        monitor?.failStep("implement_changes", message);
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: false,
          status: "failed",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message
        };
      }
      monitor?.completeStep(
        "implement_changes",
        initialAgentRun.summary,
        initialAgentRun.changedFiles.length > 0 ? initialAgentRun.changedFiles : undefined
      );
      let implementationSummary = initialAgentRun.summary;

      let visualReviewRun = await this.runVisualReview(ticket, repoPath, monitor, "Running isolated browser comparison against the HTML example.");
      if (visualReviewRun.decision === "needs_human_review") {
        const message = visualReviewRun.reason ?? visualReviewRun.summary;
        this.logger.warn("Visual review requires human review", {
          ticketKey: ticket.key,
          reason: message
        });
        monitor?.failStep("visual_review", message, summarizeVisualReview(visualReviewRun));
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: true,
          status: "needs_human_review",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message
        };
      }

      this.logger.info("Running fresh post-implementation review", { ticketKey: ticket.key });
      monitor?.startStep("review_implementation", "Running a fresh review pass against the implemented ticket.");
      let reviewRun = await this.agentService.reviewTicketImplementation(ticket, repoPath, {
        onProgress: (message) => {
          monitor?.setStepDetail("review_implementation", message);
        },
        ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
      });
      this.throwIfStopped();

      if (reviewRun.decision === "needs_human_review") {
        const message = reviewRun.reason ?? reviewRun.summary;
        this.logger.warn("Implementation review requires human review", {
          ticketKey: ticket.key,
          reason: message
        });
        monitor?.failStep("review_implementation", message, reviewRun.changedFiles);
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: true,
          status: "needs_human_review",
          ticketKey: ticket.key,
          branchName,
          message
        };
      }

      monitor?.completeStep(
        "review_implementation",
        reviewRun.summary,
        summarizeReview(reviewRun)
      );

      if (reviewRun.decision === "needs_follow_up") {
        const reviewMessage = `${reviewRun.summary} Addressing ${reviewRun.findings.length} review finding(s).`;
        this.logger.info("Fresh review requested follow-up implementation work", {
          ticketKey: ticket.key,
          findings: reviewRun.findings
        });
        monitor?.log(reviewMessage, "review_implementation");

        monitor?.startStep("implement_changes", "Addressing post-implementation review findings.");
        const followUpRun = await this.agentService.implementTicket(ticket, repoPath, {
          onProgress: (message) => {
            monitor?.setStepDetail("implement_changes", message);
          },
          reviewFindingsPath: reviewRun.reviewPath,
          ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
        });
        this.throwIfStopped();

        if (followUpRun.decision === "needs_human_review") {
          const message = followUpRun.reason ?? followUpRun.summary;
          this.logger.warn("Follow-up implementation requires human review", {
            ticketKey: ticket.key,
            reason: message
          });
          monitor?.failStep("implement_changes", message, followUpRun.changedFiles);
          monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
          return {
            ok: true,
            status: "needs_human_review",
            ...(dryRun ? { dryRun: true } : {}),
            ticketKey: ticket.key,
            branchName,
            message
          };
        }

        if (followUpRun.decision === "no_changes") {
          const message = followUpRun.reason ?? "Follow-up implementation produced no changes.";
          this.logger.warn("Follow-up implementation produced no changes", {
            ticketKey: ticket.key,
            reason: message
          });
          monitor?.failStep("implement_changes", message);
          monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
          return {
            ok: false,
            status: "failed",
            ...(dryRun ? { dryRun: true } : {}),
            ticketKey: ticket.key,
            branchName,
            message
          };
        }

        monitor?.completeStep(
          "implement_changes",
          followUpRun.summary,
          followUpRun.changedFiles.length > 0 ? followUpRun.changedFiles : undefined
        );
        implementationSummary = `${implementationSummary}\nFollow-up: ${followUpRun.summary}`;

        if (visualReviewRun.decision !== "skipped") {
          visualReviewRun = await this.runVisualReview(ticket, repoPath, monitor, "Re-running isolated browser comparison after follow-up changes.");
          if (visualReviewRun.decision === "needs_human_review") {
            const message = visualReviewRun.reason ?? visualReviewRun.summary;
            this.logger.warn("Visual review after follow-up requires human review", {
              ticketKey: ticket.key,
              reason: message
            });
            monitor?.failStep("visual_review", message, summarizeVisualReview(visualReviewRun));
            monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
            return {
              ok: true,
              status: "needs_human_review",
              ...(dryRun ? { dryRun: true } : {}),
              ticketKey: ticket.key,
              branchName,
              message
            };
          }
        }

        monitor?.startStep("review_implementation", "Confirming the follow-up changes against the ticket.");
        reviewRun = await this.agentService.reviewTicketImplementation(ticket, repoPath, {
          onProgress: (message) => {
            monitor?.setStepDetail("review_implementation", message);
          },
          ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
        });
        this.throwIfStopped();

        if (reviewRun.decision === "needs_human_review") {
          const message = reviewRun.reason ?? reviewRun.summary;
          this.logger.warn("Confirmation review requires human review", {
            ticketKey: ticket.key,
            reason: message
          });
          monitor?.failStep("review_implementation", message, reviewRun.changedFiles);
          monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
          return {
            ok: true,
            status: "needs_human_review",
            ...(dryRun ? { dryRun: true } : {}),
            ticketKey: ticket.key,
            branchName,
            message
          };
        }

        monitor?.completeStep(
          "review_implementation",
          reviewRun.summary,
          summarizeReview(reviewRun)
        );

        if (reviewRun.decision === "needs_follow_up") {
          const message = `Post-implementation review still found unresolved ticket gaps after automated follow-up. See ${reviewRun.reviewPath}.`;

          if (this.config.bypassConfirmationReviewFollowUp) {
            this.logger.warn("Confirmation review found unresolved findings, but bypass is enabled", {
              ticketKey: ticket.key,
              findings: reviewRun.findings,
              dryRun
            });
            monitor?.log(
              dryRun
                ? `Confirmation review still found unresolved follow-up items, but BYPASS_CONFIRMATION_REVIEW_FOLLOW_UP is enabled. Dry run mode would post a Jira warning comment and continue.`
                : `Confirmation review still found unresolved follow-up items, but BYPASS_CONFIRMATION_REVIEW_FOLLOW_UP is enabled. Posting a Jira warning comment and continuing.`,
              "review_implementation"
            );

            if (!dryRun) {
              await this.safeJiraComment(
                ticket.key,
                buildBypassedConfirmationReviewComment(reviewRun)
              );
            }
          } else {
            this.logger.warn("Confirmation review still found unresolved findings", {
              ticketKey: ticket.key,
              findings: reviewRun.findings
            });
            monitor?.failStep("review_implementation", message, summarizeReview(reviewRun));
            monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
            return {
              ok: true,
              status: "needs_human_review",
              ...(dryRun ? { dryRun: true } : {}),
              ticketKey: ticket.key,
              branchName,
              message
            };
          }
        }
      }

      this.logger.info("Running validation after implementation", { ticketKey: ticket.key });
      monitor?.startStep("validation", "Running repository validation commands.");
      let validation = await this.runValidationWithMonitor(repoPath, monitor);
      for (let attempt = 1; !validation.success && attempt <= this.config.VALIDATION_REPAIR_ATTEMPTS; attempt += 1) {
        this.throwIfStopped();
        this.logger.warn("Validation failed; starting automated repair attempt", {
          ticketKey: ticket.key,
          attempt,
          maxAttempts: this.config.VALIDATION_REPAIR_ATTEMPTS,
          failedCommand: validation.steps[validation.steps.length - 1]?.command
        });
        monitor?.log(
          `Validation failed on ${validation.steps[validation.steps.length - 1]?.command ?? "unknown step"}. Starting repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS}.`,
          "validation"
        );
        monitor?.startStep("validation", `Repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS} is running.`);

        const repairRun = await this.agentService.repairFromValidation(
          ticket,
          repoPath,
          validation,
          this.abortController?.signal
        );
        this.throwIfStopped();

        if (repairRun.decision === "applied") {
          this.logger.info("Repair attempt applied changes; rerunning validation", {
            ticketKey: ticket.key,
            attempt
          });
          monitor?.log(`Repair attempt ${attempt} applied changes. Rerunning validation.`, "validation");
          validation = await this.runValidationWithMonitor(repoPath, monitor);
          continue;
        }

        if (repairRun.decision === "needs_human_review") {
          const message = repairRun.reason ?? "Repair attempt requires human review.";
          this.logger.warn("Repair attempt requires human review", {
            ticketKey: ticket.key,
            attempt,
            reason: message
          });
          monitor?.failStep("validation", message, summarizeValidation(validation));
          monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
          return {
            ok: false,
            status: "validation_failed",
            ...(dryRun ? { dryRun: true } : {}),
            ticketKey: ticket.key,
            branchName,
            message,
            validation
          };
        }
      }

      this.throwIfStopped();
      if (!validation.success) {
        this.logger.warn("Validation failed after maximum repair attempts", {
          ticketKey: ticket.key,
          attempts: this.config.VALIDATION_REPAIR_ATTEMPTS,
          failedCommand: validation.steps[validation.steps.length - 1]?.command
        });
        monitor?.failStep(
          "validation",
          `Validation failed after ${this.config.VALIDATION_REPAIR_ATTEMPTS} repair attempt(s).`,
          summarizeValidation(validation)
        );
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: false,
          status: "validation_failed",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message: `Validation failed after ${this.config.VALIDATION_REPAIR_ATTEMPTS} repair attempt(s).`,
          validation
        };
      }
      monitor?.completeStep("validation", "Validation passed successfully.", summarizeValidation(validation));

      this.throwIfStopped();
      this.logger.info("Checking whether repository has changes to commit", {
        ticketKey: ticket.key
      });
      const hasChanges = await this.gitService.hasChanges(git);
      if (!hasChanges) {
        this.logger.warn("Validation passed but no file changes were present", {
          ticketKey: ticket.key
        });
        monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
        return {
          ok: false,
          status: "failed",
          ...(dryRun ? { dryRun: true } : {}),
          ticketKey: ticket.key,
          branchName,
          message: "Validation passed but repository has no file changes."
        };
      }

      if (dryRun) {
        this.logger.info("Dry run completed before publish steps", {
          ticketKey: ticket.key,
          branchName,
          publishMode: useDirectCommits ? "direct_commit" : "pull_request"
        });
        monitor?.skipStep(
          "commit_push",
          useDirectCommits
            ? `Dry run mode: skipped committing and pushing to ${this.config.GIT_BASE_BRANCH}.`
            : `Dry run mode: skipped committing and pushing branch ${branchName}.`
        );
        monitor?.skipStep(
          "create_pull_request",
          useDirectCommits
            ? "Dry run mode: no pull request would be created in direct-commit mode."
            : "Dry run mode: skipped draft pull request creation."
        );
        monitor?.skipStep(
          "finalize_jira",
          "Dry run mode: skipped Jira comment, label, and transition updates."
        );

        return {
          ok: true,
          status: "success",
          dryRun: true,
          ticketKey: ticket.key,
          branchName,
          validation,
          message:
            "Dry run completed successfully. Changes were validated locally and publish steps were skipped."
        };
      }

      this.logger.info("Publishing validated changes", {
        ticketKey: ticket.key,
        branchName,
        mode: useDirectCommits ? "direct_commit" : "pull_request"
      });
      const commitMessage = `${ticket.key}: ${ticket.summary}`;
      monitor?.startStep(
        "commit_push",
        useDirectCommits
          ? `Committing and pushing directly to ${this.config.GIT_BASE_BRANCH}.`
          : `Committing and pushing branch ${branchName}.`
      );
      this.throwIfStopped();
      const commitSha = useDirectCommits
        ? await this.gitService.commitAndPushToBaseBranch(git, commitMessage)
        : await this.gitService.commitAndPush(git, branchName, commitMessage);
      monitor?.completeStep(
        "commit_push",
        useDirectCommits
          ? `Commit was pushed directly to ${this.config.GIT_BASE_BRANCH}.`
          : `Branch ${branchName} was pushed.`,
        [commitSha]
      );

      let pullRequestUrl: string | undefined;
      let successMessage: string;

      if (useDirectCommits) {
        this.throwIfStopped();
        monitor?.skipStep(
          "create_pull_request",
          `Direct commit mode is enabled; no pull request was created for ${this.config.GIT_BASE_BRANCH}.`
        );
        this.logger.info("Posting success comment to Jira after direct commit", {
          ticketKey: ticket.key,
          baseBranch: this.config.GIT_BASE_BRANCH,
          commitSha
        });
        monitor?.startStep("finalize_jira", "Posting direct commit details back to Jira and labeling the ticket.");
        await this.safeJiraComment(
          ticket.key,
          buildSuccessJiraComment({
            implementationSummary,
            review: reviewRun,
            visualReview: visualReviewRun,
            validation,
            bypassedConfirmationReview: this.config.bypassConfirmationReviewFollowUp && reviewRun.decision === "needs_follow_up",
            directCommitBranch: this.config.GIT_BASE_BRANCH,
            commitSha
          })
        );
        successMessage = `Validated changes were committed directly to ${this.config.GIT_BASE_BRANCH}.`;
      } else {
        this.logger.info("Creating draft pull request", {
          ticketKey: ticket.key,
          branchName
        });
        monitor?.startStep("create_pull_request", "Creating a draft GitHub pull request.");
        this.throwIfStopped();
        const prTitle = await this.githubService.resolveUniquePullRequestTitle(ticket.key, ticket.summary);
        const pullRequest = await this.githubService.createDraftPullRequest({
          branchName,
          title: prTitle,
          ticketKey: ticket.key,
          ticketUrl: ticket.url,
          summaryOfChanges: implementationSummary,
          validation
        });
        pullRequestUrl = pullRequest.url;
        monitor?.completeStep("create_pull_request", `Draft pull request #${pullRequest.number} created.`, [pullRequest.url]);

        this.logger.info("Posting success comment to Jira", {
          ticketKey: ticket.key,
          pullRequestUrl: pullRequest.url
        });
        monitor?.startStep("finalize_jira", "Posting PR details back to Jira and labeling the ticket.");
        await this.safeJiraComment(
          ticket.key,
          buildSuccessJiraComment({
            implementationSummary,
            review: reviewRun,
            visualReview: visualReviewRun,
            validation,
            bypassedConfirmationReview: this.config.bypassConfirmationReviewFollowUp && reviewRun.decision === "needs_follow_up",
            pullRequestUrl: pullRequest.url,
            branchName,
            commitSha
          })
        );
        successMessage = "Draft pull request created successfully.";
      }

      this.throwIfStopped();
      await this.safeAddDoneLabel(ticket.key);
      await this.safeTransitionToInReview(ticket.key);
      monitor?.completeStep(
        "finalize_jira",
        useDirectCommits
          ? `Jira ticket was updated with the direct commit, labeled ${this.config.JIRA_DONE_LABEL}, and moved to ${this.config.JIRA_REVIEW_TRANSITION_NAME} when possible.`
          : `Jira ticket was updated with the PR, labeled ${this.config.JIRA_DONE_LABEL}, and moved to ${this.config.JIRA_REVIEW_TRANSITION_NAME} when possible.`
      );

      this.logger.info("Ticket processed successfully", {
        ticketKey: ticket.key,
        branchName,
        pullRequestUrl,
        publishTarget: useDirectCommits ? this.config.GIT_BASE_BRANCH : branchName
      });

      return {
        ok: true,
        status: "success",
        ...(dryRun ? { dryRun: true } : {}),
        ticketKey: ticket.key,
        branchName: useDirectCommits ? this.config.GIT_BASE_BRANCH : branchName,
        ...(pullRequestUrl ? { pullRequestUrl } : {}),
        commitSha,
        validation,
        message: successMessage
      };
    } finally {
      await cleanup();
    }
  }

  private shouldUseDirectCommits(): boolean {
    if (!this.config.GIT_DIRECT_COMMITS) {
      return false;
    }

    return this.config.GIT_BASE_BRANCH.trim().toLowerCase() !== "main";
  }

  private evaluateGuardrails(ticket: JiraTicket): string | null {
    return evaluateTicketGuardrails(ticket, this.config);
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
      await this.jiraService.addLabel(ticketKey, this.config.JIRA_DONE_LABEL);
    } catch (error) {
      this.logger.warn(`Failed to add ${this.config.JIRA_DONE_LABEL} label for ${ticketKey}`, error);
    }
  }

  private async safeTransitionToInReview(ticketKey: string): Promise<void> {
    try {
      await this.jiraService.transitionToReviewStatus(ticketKey);
    } catch (error) {
      this.logger.warn(`Failed to transition ${ticketKey} to ${this.config.JIRA_REVIEW_TRANSITION_NAME}`, error);
    }
  }

  private async runValidationWithMonitor(repoPath: string, monitor?: RunMonitor) {
    return this.validatorService.run(repoPath, {
      onCommandStart: (command) => {
        monitor?.setStepCurrentCommand("validation", command);
        monitor?.startStep("validation", `Running validation command: ${command}`);
      },
      ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
    });
  }

  private throwIfStopped(): void {
    if (this.stopRequested || this.abortController?.signal.aborted) {
      throw this.abortController?.signal.reason instanceof Error
        ? this.abortController.signal.reason
        : new WorkerStoppedError();
    }
  }

  private async runVisualReview(ticket: JiraTicket, repoPath: string, monitor?: RunMonitor, detail?: string) {
    this.logger.info("Running visual review", { ticketKey: ticket.key });
    monitor?.startStep("visual_review", detail ?? "Running isolated browser comparison.");
    const result = await this.visualReviewService.run(ticket, repoPath, {
      onProgress: (message) => {
        monitor?.setStepDetail("visual_review", message);
      },
      ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
    });
    this.throwIfStopped();

    if (result.decision === "skipped") {
      monitor?.skipStep("visual_review", result.summary, summarizeVisualReview(result));
      return result;
    }

    monitor?.completeStep("visual_review", result.summary, summarizeVisualReview(result));
    return result;
  }
}

function summarizeValidation(validation: WorkerRunResult["validation"]): string[] {
  if (!validation) {
    return [];
  }

  return validation.steps.map((step) => {
    const suffix = step.success ? "passed" : `failed (exit ${step.exitCode ?? "unknown"})`;
    return `${step.command}: ${suffix}`;
  });
}

function summarizeReview(review: ImplementationReviewResult): string[] {
  const findingLines =
    review.findings.length > 0 ? review.findings.map((finding) => `Finding: ${finding}`) : ["Finding: none"];

  return [`Review doc: ${review.reviewPath}`, ...findingLines];
}

function summarizeVisualReview(review: VisualReviewResult): string[] {
  const findingLines =
    review.findings.length > 0 ? review.findings.map((finding) => `Finding: ${finding}`) : ["Finding: none"];
  const artifactLines =
    review.artifactPaths.length > 0 ? review.artifactPaths.map((artifactPath) => `Artifact: ${artifactPath}`) : ["Artifact: none"];

  return [`Visual report: ${review.reportPath}`, ...findingLines, ...artifactLines];
}

function buildSuccessJiraComment(input: {
  implementationSummary: string;
  review: ImplementationReviewResult;
  visualReview: VisualReviewResult;
  validation: NonNullable<WorkerRunResult["validation"]>;
  bypassedConfirmationReview?: boolean;
  pullRequestUrl?: string;
  branchName?: string;
  directCommitBranch?: string;
  commitSha: string;
}): string {
  const deliveryLines = input.pullRequestUrl
    ? [
        `Draft PR: ${input.pullRequestUrl}`,
        `Branch: ${input.branchName ?? "(unknown)"}`,
        `Commit: ${input.commitSha}`
      ]
    : [
        `Direct commit branch: ${input.directCommitBranch ?? "(unknown)"}`,
        `Commit: ${input.commitSha}`
      ];

  const qualityLines = [
    formatImplementationReviewLine(input.review, input.bypassedConfirmationReview ?? false),
    formatVisualReviewLine(input.visualReview),
    ...buildValidationSummaryLines(input.validation)
  ];

  return [
    "Automation completed successfully.",
    "",
    "Summary of changes:",
    input.implementationSummary,
    "",
    "Quality checks:",
    ...qualityLines.map((line) => `- ${line}`),
    "",
    "Delivery:",
    ...deliveryLines.map((line) => `- ${line}`)
  ].join("\n");
}

function formatVisualReviewLine(review: VisualReviewResult): string {
  if (review.decision === "approved") {
    return `Visual review: passed. ${review.summary}`;
  }

  if (review.decision === "skipped") {
    return `Visual review: skipped. ${review.summary}`;
  }

  return `Visual review: ${review.decision}. ${review.summary}`;
}

function formatImplementationReviewLine(
  review: ImplementationReviewResult,
  bypassedConfirmationReview: boolean
): string {
  if (review.decision === "approved") {
    return `Automated review agents: passed. ${review.summary}`;
  }

  if (bypassedConfirmationReview && review.decision === "needs_follow_up") {
    return `Automated review agents: unresolved follow-up findings were bypassed by configuration. ${review.summary}`;
  }

  return `Automated review agents: ${review.decision}. ${review.summary}`;
}

function buildBypassedConfirmationReviewComment(review: ImplementationReviewResult): string {
  const findings =
    review.findings.length > 0
      ? review.findings.map((finding) => `- ${finding}`)
      : ["- Review requested follow-up changes but did not return explicit findings."];

  return [
    "Automation notice: the confirmation review still found unresolved follow-up items after the automated implementation retry.",
    "BYPASS_CONFIRMATION_REVIEW_FOLLOW_UP is enabled, so the pipeline is continuing instead of stopping for manual intervention.",
    "",
    `Review summary: ${review.summary}`,
    `Review document: ${review.reviewPath}`,
    "",
    "Outstanding findings:",
    ...findings
  ].join("\n");
}

function buildValidationSummaryLines(validation: NonNullable<WorkerRunResult["validation"]>): string[] {
  const passedSteps = validation.steps.filter((step) => step.success);
  if (passedSteps.length === 0) {
    return ["Validation: passed."];
  }

  return passedSteps.map((step) => `Validation command passed: \`${step.command}\`.`);
}

class WorkerStoppedError extends Error {
  constructor() {
    super("Pipeline stopped by user request.");
    this.name = "WorkerStoppedError";
  }
}

function isWorkerStoppedError(error: unknown): boolean {
  return error instanceof WorkerStoppedError || (error instanceof Error && error.name === "AbortError");
}
