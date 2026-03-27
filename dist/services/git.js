import path from "node:path";
import { simpleGit } from "simple-git";
import { ensureCleanDirectory } from "../utils/files.js";
import { slugify } from "../utils/text.js";
export class GitService {
    config;
    constructor(config) {
        this.config = config;
    }
    async prepareRepository(ticketKey, summary) {
        const branchName = `ai/${ticketKey}-${slugify(summary)}`;
        const repoPath = path.resolve(this.config.WORK_ROOT, `${ticketKey}-${Date.now()}`);
        await ensureCleanDirectory(repoPath);
        await simpleGit().clone(this.config.GIT_REMOTE_URL, repoPath, [
            "--branch",
            this.config.GIT_BASE_BRANCH,
            "--single-branch"
        ]);
        const git = simpleGit(repoPath);
        await git.checkoutLocalBranch(branchName);
        return { repoPath, branchName, git };
    }
    async hasChanges(git) {
        const status = await git.status();
        return status.files.length > 0;
    }
    async commitAndPush(git, branchName, message) {
        await git.add(".");
        const commitResult = await git.commit(message);
        await git.push("origin", branchName, { "--set-upstream": null });
        return commitResult.commit;
    }
}
