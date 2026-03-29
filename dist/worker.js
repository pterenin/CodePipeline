import { AgentService } from "./services/agent.js";
import { GitService } from "./services/git.js";
import { GitHubService } from "./services/github.js";
import { JiraService } from "./services/jira.js";
import { ValidatorService } from "./services/validator.js";
import { Logger } from "./utils/logger.js";
import { hasStrongRequirements } from "./utils/text.js";
export class Worker {
    config;
    logger = new Logger("worker");
    jiraService;
    githubService;
    gitService;
    validatorService;
    agentService;
    isRunning = false;
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
    async runNext(monitor) {
        if (this.isRunning) {
            throw new Error("Worker is already running.");
        }
        this.isRunning = true;
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
        }
    }
    async processTickets(tickets, monitor) {
        let successfulTickets = 0;
        let failedTickets = 0;
        let lastResult;
        for (const ticket of tickets) {
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
        this.logger.info(`Processing ticket ${ticket.key}`, {
            summary: ticket.summary
        });
        monitor?.startStep("evaluate_guardrails", `Checking whether ${ticket.key} is safe to automate.`);
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
        this.logger.info("Preparing repository workspace", { ticketKey: ticket.key });
        monitor?.startStep("prepare_repository", "Creating isolated git worktree and branch.");
        const { repoPath, branchName, git, cleanup } = await this.gitService.prepareRepository(ticket.key, ticket.summary);
        this.logger.info("Repository worktree prepared", { repoPath, branchName });
        monitor?.completeStep("prepare_repository", `Worktree ready on branch ${branchName}.`, [repoPath]);
        try {
            this.logger.info("Running agent implementation pass", { ticketKey: ticket.key });
            monitor?.startStep("implement_changes", "Running the implementation agent.");
            const initialAgentRun = await this.agentService.implementTicket(ticket, repoPath, {
                onProgress: (message) => {
                    monitor?.setStepDetail("implement_changes", message);
                }
            });
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
            this.logger.info("Running validation after implementation", { ticketKey: ticket.key });
            monitor?.startStep("validation", "Running repository validation commands.");
            let validation = await this.runValidationWithMonitor(repoPath, monitor);
            for (let attempt = 1; !validation.success && attempt <= this.config.VALIDATION_REPAIR_ATTEMPTS; attempt += 1) {
                this.logger.warn("Validation failed; starting automated repair attempt", {
                    ticketKey: ticket.key,
                    attempt,
                    maxAttempts: this.config.VALIDATION_REPAIR_ATTEMPTS,
                    failedCommand: validation.steps[validation.steps.length - 1]?.command
                });
                monitor?.log(`Validation failed on ${validation.steps[validation.steps.length - 1]?.command ?? "unknown step"}. Starting repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS}.`, "validation");
                monitor?.startStep("validation", `Repair attempt ${attempt} of ${this.config.VALIDATION_REPAIR_ATTEMPTS} is running.`);
                const repairRun = await this.agentService.repairFromValidation(ticket, repoPath, validation);
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
            this.logger.info("Committing and pushing changes", {
                ticketKey: ticket.key,
                branchName
            });
            monitor?.startStep("commit_push", `Committing and pushing branch ${branchName}.`);
            const commitSha = await this.gitService.commitAndPush(git, branchName, `${ticket.key}: ${ticket.summary}`);
            monitor?.completeStep("commit_push", `Branch ${branchName} was pushed.`, [commitSha]);
            this.logger.info("Creating draft pull request", {
                ticketKey: ticket.key,
                branchName
            });
            monitor?.startStep("create_pull_request", "Creating a draft GitHub pull request.");
            const prTitle = await this.githubService.resolveUniquePullRequestTitle(ticket.key, ticket.summary);
            const pullRequest = await this.githubService.createDraftPullRequest({
                branchName,
                title: prTitle,
                ticketKey: ticket.key,
                ticketUrl: ticket.url,
                summaryOfChanges: initialAgentRun.summary,
                validation
            });
            monitor?.completeStep("create_pull_request", `Draft pull request #${pullRequest.number} created.`, [pullRequest.url]);
            this.logger.info("Posting success comment to Jira", {
                ticketKey: ticket.key,
                pullRequestUrl: pullRequest.url
            });
            monitor?.startStep("finalize_jira", "Posting PR details back to Jira and labeling the ticket.");
            await this.safeJiraComment(ticket.key, `Automation completed successfully.\n\nDraft PR: ${pullRequest.url}\nBranch: ${branchName}\nCommit: ${commitSha}`);
            await this.safeAddDoneLabel(ticket.key);
            await this.safeTransitionToDone(ticket.key);
            monitor?.completeStep("finalize_jira", "Jira ticket was updated with the PR, labeled ai-done, and marked done when possible.");
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
        }
        finally {
            await cleanup();
        }
    }
    evaluateGuardrails(ticket) {
        const combinedText = `${ticket.summary}\n${ticket.description}\n${ticket.acceptanceCriteria ?? ""}`;
        if (this.config.riskyKeywordPattern.test(combinedText)) {
            return "Ticket contains risky keywords and is outside automation scope.";
        }
        if (!hasStrongRequirements(combinedText, this.config.weakRequirementThreshold)) {
            return "Ticket requirements are too weak or incomplete for safe automation.";
        }
        return null;
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
    async safeTransitionToDone(ticketKey) {
        try {
            await this.jiraService.transitionToDone(ticketKey);
        }
        catch (error) {
            this.logger.warn(`Failed to transition ${ticketKey} to done`, error);
        }
    }
    async runValidationWithMonitor(repoPath, monitor) {
        return this.validatorService.run(repoPath, {
            onCommandStart: (command) => {
                monitor?.setStepCurrentCommand("validation", command);
                monitor?.startStep("validation", `Running validation command: ${command}`);
            }
        });
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
