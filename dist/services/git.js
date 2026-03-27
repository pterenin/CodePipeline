import { promises as fs } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { simpleGit } from "simple-git";
import { ensureCleanDirectory } from "../utils/files.js";
import { Logger } from "../utils/logger.js";
import { slugify } from "../utils/text.js";
export class GitService {
    config;
    logger = new Logger("git");
    constructor(config) {
        this.config = config;
    }
    async prepareRepository(ticketKey, summary) {
        const mirrorPath = path.resolve(this.config.WORK_ROOT, "repo-mirror");
        const worktreeRoot = path.resolve(this.config.WORK_ROOT, "worktrees");
        const branchName = await this.resolveUniqueBranchName(mirrorPath, ticketKey, summary);
        const repoPath = path.resolve(worktreeRoot, `${ticketKey}-${Date.now()}`);
        this.logger.info("Preparing repository from persistent local mirror", {
            mirrorPath,
            repoPath,
            branchName,
            remote: this.config.GIT_REMOTE_URL,
            baseBranch: this.config.GIT_BASE_BRANCH
        });
        await this.ensureMirror(mirrorPath);
        await fs.mkdir(worktreeRoot, { recursive: true });
        await this.removeExistingBranchWorktree(mirrorPath, branchName);
        await ensureCleanDirectory(repoPath);
        this.logger.info("Creating git worktree", {
            repoPath,
            branchName
        });
        await execa("git", ["worktree", "add", "-B", branchName, repoPath, `origin/${this.config.GIT_BASE_BRANCH}`], { cwd: mirrorPath });
        const git = simpleGit(repoPath);
        return {
            repoPath,
            branchName,
            git,
            cleanup: async () => {
                await this.cleanupWorktree(mirrorPath, repoPath);
            }
        };
    }
    async hasChanges(git) {
        const status = await git.status();
        this.logger.info("Checked repository status", {
            changedFiles: status.files.length
        });
        return status.files.length > 0;
    }
    async commitAndPush(git, branchName, message) {
        this.logger.info("Staging repository changes");
        await git.add(".");
        this.logger.info("Creating git commit", { message });
        const commitResult = await git.commit(message);
        this.logger.info("Pushing branch to origin", { branchName });
        await git.push("origin", branchName, { "--set-upstream": null });
        this.logger.info("Git push completed", { commitSha: commitResult.commit });
        return commitResult.commit;
    }
    async ensureMirror(mirrorPath) {
        if (!(await pathExists(path.join(mirrorPath, ".git")))) {
            this.logger.info("Creating persistent local repository mirror", {
                mirrorPath
            });
            await ensureCleanDirectory(mirrorPath);
            await simpleGit().clone(this.config.GIT_REMOTE_URL, mirrorPath, [
                "--branch",
                this.config.GIT_BASE_BRANCH,
                "--single-branch"
            ]);
            return;
        }
        this.logger.info("Refreshing persistent local repository mirror", {
            mirrorPath,
            baseBranch: this.config.GIT_BASE_BRANCH
        });
        const mirrorGit = simpleGit(mirrorPath);
        await mirrorGit.fetch("origin", this.config.GIT_BASE_BRANCH, { "--prune": null });
        await mirrorGit.checkout(this.config.GIT_BASE_BRANCH);
        await mirrorGit.reset(["--hard", `origin/${this.config.GIT_BASE_BRANCH}`]);
    }
    async resolveUniqueBranchName(mirrorPath, ticketKey, summary) {
        const baseBranchName = `ai/${ticketKey}-${slugify(summary)}`;
        const existingBranches = await this.listRemoteBranches(mirrorPath);
        if (!existingBranches.has(baseBranchName)) {
            return baseBranchName;
        }
        for (let version = 1; version < 1000; version += 1) {
            const candidate = `${baseBranchName}_v${version}`;
            if (!existingBranches.has(candidate)) {
                this.logger.warn("Base branch already exists remotely; using versioned branch name", {
                    baseBranchName,
                    candidate
                });
                return candidate;
            }
        }
        throw new Error(`Unable to find a unique branch name for ${baseBranchName}`);
    }
    async cleanupWorktree(mirrorPath, repoPath) {
        this.logger.info("Cleaning up git worktree", { repoPath });
        await execa("git", ["worktree", "remove", "--force", repoPath], {
            cwd: mirrorPath,
            reject: false
        });
    }
    async removeExistingBranchWorktree(mirrorPath, branchName) {
        await execa("git", ["worktree", "prune"], {
            cwd: mirrorPath,
            reject: false
        });
        const listResult = await execa("git", ["worktree", "list", "--porcelain"], {
            cwd: mirrorPath
        });
        const worktrees = parseWorktreeList(listResult.stdout);
        const existing = worktrees.find((worktree) => worktree.branch === `refs/heads/${branchName}`);
        if (!existing?.path) {
            return;
        }
        this.logger.warn("Removing existing worktree already using target branch", {
            branchName,
            existingPath: existing.path
        });
        await execa("git", ["worktree", "remove", "--force", existing.path], {
            cwd: mirrorPath,
            reject: false
        });
    }
    async listRemoteBranches(mirrorPath) {
        const branchResult = await execa("git", ["ls-remote", "--heads", "origin"], {
            cwd: mirrorPath
        });
        return new Set(branchResult.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => line.split("\t")[1] ?? "")
            .filter((line) => line.startsWith("refs/heads/"))
            .map((line) => line.replace(/^refs\/heads\//, "")));
    }
}
function parseWorktreeList(stdout) {
    const blocks = stdout.trim().split("\n\n").filter(Boolean);
    return blocks.map((block) => {
        const lines = block.split("\n");
        const parsed = {};
        for (const line of lines) {
            if (line.startsWith("worktree ")) {
                parsed.path = line.slice("worktree ".length).trim();
            }
            else if (line.startsWith("branch ")) {
                parsed.branch = line.slice("branch ".length).trim();
            }
        }
        return parsed;
    });
}
async function pathExists(targetPath) {
    try {
        await execa("test", ["-e", targetPath]);
        return true;
    }
    catch {
        return false;
    }
}
