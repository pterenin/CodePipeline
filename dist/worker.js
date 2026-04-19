import { AgentService } from "./services/agent.js";
import { GitService } from "./services/git.js";
import { GitHubService } from "./services/github.js";
import { JiraService } from "./services/jira.js";
import { ValidatorService } from "./services/validator.js";
import { Logger } from "./utils/logger.js";
import { evaluateTicketGuardrails } from "./utils/guardrails.js";
export class Worker {
    config;
    logger = new Logger("worker");
    jiraService;
    githubService;
    gitService;
    validatorService;
    agentService;
    isRunning = false;
    stopRequested = false;
    abortController;
    constructor(config) {
        this.config = config;
        this.jiraService = new JiraService(config);
        this.githubService = new GitHubService(config);
        this.gitService = new GitService(config);
        this.validatorService = new ValidatorService();
        this.agentService = new AgentService(config);
    }
    get running() {
        return this.isRunning;
    }
    requestStop(monitor) {
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
    async runNext(monitor) {
        if (this.isRunning) {
            throw new Error("Worker is already running.");
        }
        this.isRunning = true;
        this.stopRequested = false;
        this.abortController = new AbortController();
        this.logger.info("Worker run started");
        monitor?.startRun();
        monitor?.log("Worker run started.");
        try {
            monitor?.startStep("fetch_ticket", "Loading Jira tickets that match the queue filter.");
            const tickets = await this.jiraService.getQueuedTickets();
            if (tickets.length === 0) {
                this.logger.info("No Jira tickets found to work on for the current JQL filter");
                this.logger.info("Worker run finished with no ticket");
                const result = {
                    ok: true,
                    status: "no_ticket",
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
            monitor?.completeStep("fetch_ticket", `Loaded ${tickets.length} ticket${tickets.length === 1 ? "" : "s"} from Jira.`, tickets.map((ticket) => `${ticket.key}: ${ticket.summary}`));
            monitor?.log(`Loaded Jira queue: ${tickets.map((ticket) => ticket.key).join(", ")}.`, "fetch_ticket");
            const result = await this.processTickets(tickets, monitor);
            monitor?.finishRun(result);
            return result;
        }
        catch (error) {
            if (isWorkerStoppedError(error)) {
                const result = {
                    ok: true,
                    status: "stopped",
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
                message
            });
            throw error;
        }
        finally {
            this.logger.info("Worker run finished");
            this.isRunning = false;
            this.stopRequested = false;
            this.abortController = undefined;
        }
    }
    async processTickets(tickets, monitor) {
        let successfulTickets = 0;
        let failedTickets = 0;
        let lastResult;
        for (const ticket of tickets) {
            this.throwIfStopped();
            monitor?.startTicket(ticket.key, `Processing ${ticket.key}: ${ticket.summary}`);
            monitor?.log(`Starting ticket ${ticket.key}.`);
            const ticketResult = await this.processTicket(ticket, monitor);
            lastResult = ticketResult;
            if (ticketResult.status === "success") {
                successfulTickets += 1;
                monitor?.finishTicket(ticket.key, "done", ticketResult.message);
            }
            else {
                failedTickets += 1;
                monitor?.finishTicket(ticket.key, "failed", ticketResult.message);
            }
            monitor?.log(`Finished ticket ${ticket.key} with status ${ticketResult.status}.`);
        }
        const processedTickets = tickets.length;
        const resultStatus = processedTickets === 0
            ? "no_ticket"
            : failedTickets > 0
                ? "failed"
                : "success";
        return {
            ok: failedTickets === 0,
            status: resultStatus,
            ...(lastResult?.ticketKey ? { ticketKey: lastResult.ticketKey } : {}),
            ...(lastResult?.branchName ? { branchName: lastResult.branchName } : {}),
            ...(lastResult?.pullRequestUrl ? { pullRequestUrl: lastResult.pullRequestUrl } : {}),
            ...(lastResult?.commitSha ? { commitSha: lastResult.commitSha } : {}),
            ...(lastResult?.validation ? { validation: lastResult.validation } : {}),
            processedTickets,
            successfulTickets,
            failedTickets,
            message: failedTickets > 0
                ? `Processed ${processedTickets} tickets. ${successfulTickets} succeeded and ${failedTickets} failed.`
                : `Processed ${processedTickets} tickets successfully.`
        };
    }
    async processTicket(ticket, monitor) {
        this.throwIfStopped();
        this.logger.info(`Processing ticket ${ticket.key}`, {
            summary: ticket.summary
        });
        const useDirectCommits = this.shouldUseDirectCommits();
        if (this.config.GIT_DIRECT_COMMITS && !useDirectCommits) {
            this.logger.warn("Direct commits were requested but base branch is main; using PR flow instead", {
                ticketKey: ticket.key,
                baseBranch: this.config.GIT_BASE_BRANCH
            });
            monitor?.log(`Direct commits requested, but GIT_BASE_BRANCH=${this.config.GIT_BASE_BRANCH} is protected by policy. Using regular PR flow.`, "evaluate_guardrails");
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
                    ticketKey: ticket.key,
                    branchName,
                    message
                };
            }
            monitor?.completeStep("document_context", contextRun.summary, contextRun.changedFiles.length > 0 ? contextRun.changedFiles : undefined);
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
                    ticketKey: ticket.key,
                    branchName,
                    message
                };
            }
            monitor?.completeStep("implement_changes", initialAgentRun.summary, initialAgentRun.changedFiles.length > 0 ? initialAgentRun.changedFiles : undefined);
            let implementationSummary = initialAgentRun.summary;
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
            monitor?.completeStep("review_implementation", reviewRun.summary, summarizeReview(reviewRun));
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
                        ticketKey: ticket.key,
                        branchName,
                        message
                    };
                }
                monitor?.completeStep("implement_changes", followUpRun.summary, followUpRun.changedFiles.length > 0 ? followUpRun.changedFiles : undefined);
                implementationSummary = `${implementationSummary}\nFollow-up: ${followUpRun.summary}`;
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
                        ticketKey: ticket.key,
                        branchName,
                        message
                    };
                }
                monitor?.completeStep("review_implementation", reviewRun.summary, summarizeReview(reviewRun));
                if (reviewRun.decision === "needs_follow_up") {
                    const message = `Post-implementation review still found unresolved ticket gaps after automated follow-up. See ${reviewRun.reviewPath}.`;
                    this.logger.warn("Confirmation review still found unresolved findings", {
                        ticketKey: ticket.key,
                        findings: reviewRun.findings
                    });
                    monitor?.failStep("review_implementation", message, summarizeReview(reviewRun));
                    monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
                    return {
                        ok: true,
                        status: "needs_human_review",
                        ticketKey: ticket.key,
                        branchName,
                        message
                    };
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
                monitor?.log(`Validation failed on ${validation.steps[validation.steps.length - 1]?.command ?? "unknown step"}. Starting repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS}.`, "validation");
                monitor?.startStep("validation", `Repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS} is running.`);
                const repairRun = await this.agentService.repairFromValidation(ticket, repoPath, validation, this.abortController?.signal);
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
                monitor?.failStep("validation", `Validation failed after ${this.config.VALIDATION_REPAIR_ATTEMPTS} repair attempt(s).`, summarizeValidation(validation));
                monitor?.skipStep("finalize_jira", "No Jira comment posted because no draft PR was created.");
                return {
                    ok: false,
                    status: "validation_failed",
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
                    ticketKey: ticket.key,
                    branchName,
                    message: "Validation passed but repository has no file changes."
                };
            }
            this.logger.info("Publishing validated changes", {
                ticketKey: ticket.key,
                branchName,
                mode: useDirectCommits ? "direct_commit" : "pull_request"
            });
            const commitMessage = `${ticket.key}: ${ticket.summary}`;
            monitor?.startStep("commit_push", useDirectCommits
                ? `Committing and pushing directly to ${this.config.GIT_BASE_BRANCH}.`
                : `Committing and pushing branch ${branchName}.`);
            this.throwIfStopped();
            const commitSha = useDirectCommits
                ? await this.gitService.commitAndPushToBaseBranch(git, commitMessage)
                : await this.gitService.commitAndPush(git, branchName, commitMessage);
            monitor?.completeStep("commit_push", useDirectCommits
                ? `Commit was pushed directly to ${this.config.GIT_BASE_BRANCH}.`
                : `Branch ${branchName} was pushed.`, [commitSha]);
            let pullRequestUrl;
            let successMessage;
            if (useDirectCommits) {
                this.throwIfStopped();
                monitor?.skipStep("create_pull_request", `Direct commit mode is enabled; no pull request was created for ${this.config.GIT_BASE_BRANCH}.`);
                this.logger.info("Posting success comment to Jira after direct commit", {
                    ticketKey: ticket.key,
                    baseBranch: this.config.GIT_BASE_BRANCH,
                    commitSha
                });
                monitor?.startStep("finalize_jira", "Posting direct commit details back to Jira and labeling the ticket.");
                await this.safeJiraComment(ticket.key, `Automation completed successfully.\n\nDirect commit branch: ${this.config.GIT_BASE_BRANCH}\nCommit: ${commitSha}`);
                successMessage = `Validated changes were committed directly to ${this.config.GIT_BASE_BRANCH}.`;
            }
            else {
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
                await this.safeJiraComment(ticket.key, `Automation completed successfully.\n\nDraft PR: ${pullRequest.url}\nBranch: ${branchName}\nCommit: ${commitSha}`);
                successMessage = "Draft pull request created successfully.";
            }
            this.throwIfStopped();
            await this.safeAddDoneLabel(ticket.key);
            await this.safeTransitionToInReview(ticket.key);
            monitor?.completeStep("finalize_jira", useDirectCommits
                ? `Jira ticket was updated with the direct commit, labeled ai-done, and moved to In Review when possible.`
                : "Jira ticket was updated with the PR, labeled ai-done, and moved to In Review when possible.");
            this.logger.info("Ticket processed successfully", {
                ticketKey: ticket.key,
                branchName,
                pullRequestUrl,
                publishTarget: useDirectCommits ? this.config.GIT_BASE_BRANCH : branchName
            });
            return {
                ok: true,
                status: "success",
                ticketKey: ticket.key,
                branchName: useDirectCommits ? this.config.GIT_BASE_BRANCH : branchName,
                ...(pullRequestUrl ? { pullRequestUrl } : {}),
                commitSha,
                validation,
                message: successMessage
            };
        }
        finally {
            await cleanup();
        }
    }
    shouldUseDirectCommits() {
        if (!this.config.GIT_DIRECT_COMMITS) {
            return false;
        }
        return this.config.GIT_BASE_BRANCH.trim().toLowerCase() !== "main";
    }
    evaluateGuardrails(ticket) {
        return evaluateTicketGuardrails(ticket, this.config);
    }
    async safeJiraComment(ticketKey, body) {
        try {
            await this.jiraService.addComment(ticketKey, body);
        }
        catch (error) {
            this.logger.warn(`Failed to add Jira comment for ${ticketKey}`, error);
        }
    }
    async safeAddDoneLabel(ticketKey) {
        try {
            await this.jiraService.addLabel(ticketKey, "ai-done");
        }
        catch (error) {
            this.logger.warn(`Failed to add ai-done label for ${ticketKey}`, error);
        }
    }
    async safeTransitionToInReview(ticketKey) {
        try {
            await this.jiraService.transitionToInReview(ticketKey);
        }
        catch (error) {
            this.logger.warn(`Failed to transition ${ticketKey} to In Review`, error);
        }
    }
    async runValidationWithMonitor(repoPath, monitor) {
        return this.validatorService.run(repoPath, {
            onCommandStart: (command) => {
                monitor?.setStepCurrentCommand("validation", command);
                monitor?.startStep("validation", `Running validation command: ${command}`);
            },
            ...(this.abortController?.signal ? { signal: this.abortController.signal } : {})
        });
    }
    throwIfStopped() {
        if (this.stopRequested || this.abortController?.signal.aborted) {
            throw this.abortController?.signal.reason instanceof Error
                ? this.abortController.signal.reason
                : new WorkerStoppedError();
        }
    }
}
function summarizeValidation(validation) {
    if (!validation) {
        return [];
    }
    return validation.steps.map((step) => {
        const suffix = step.success ? "passed" : `failed (exit ${step.exitCode ?? "unknown"})`;
        return `${step.command}: ${suffix}`;
    });
}
function summarizeReview(review) {
    const findingLines = review.findings.length > 0 ? review.findings.map((finding) => `Finding: ${finding}`) : ["Finding: none"];
    return [`Review doc: ${review.reviewPath}`, ...findingLines];
}
class WorkerStoppedError extends Error {
    constructor() {
        super("Pipeline stopped by user request.");
        this.name = "WorkerStoppedError";
    }
}
function isWorkerStoppedError(error) {
    return error instanceof WorkerStoppedError || (error instanceof Error && error.name === "AbortError");
}
