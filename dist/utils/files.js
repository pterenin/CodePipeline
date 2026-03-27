import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_CANDIDATE_FILES = [
    "package.json",
    "tsconfig.json",
    "README.md"
];
export async function ensureCleanDirectory(targetPath) {
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.mkdir(targetPath, { recursive: true });
}
export async function collectRepositoryContext(repoPath, maxFiles, maxBytesPerFile) {
    const topLevelEntries = (await fs.readdir(repoPath)).sort();
    const selectedFiles = [];
    const visited = new Set();
    for (const candidate of DEFAULT_CANDIDATE_FILES) {
        const fullPath = path.join(repoPath, candidate);
        if (await fileExists(fullPath)) {
            selectedFiles.push({
                path: candidate,
                content: await readFileSlice(fullPath, maxBytesPerFile)
            });
            visited.add(candidate);
        }
    }
    const walkQueue = topLevelEntries
        .filter((entry) => !entry.startsWith(".git"))
        .map((entry) => path.join(repoPath, entry));
    while (walkQueue.length > 0 && selectedFiles.length < maxFiles) {
        const currentPath = walkQueue.shift();
        if (!currentPath) {
            continue;
        }
        const stats = await fs.stat(currentPath);
        const relativePath = path.relative(repoPath, currentPath);
        if (stats.isDirectory()) {
            if (shouldSkipDirectory(relativePath)) {
                continue;
            }
            const children = (await fs.readdir(currentPath)).sort();
            for (const child of children) {
                walkQueue.push(path.join(currentPath, child));
            }
            continue;
        }
        if (shouldSkipFile(relativePath) || visited.has(relativePath)) {
            continue;
        }
        selectedFiles.push({
            path: relativePath,
            content: await readFileSlice(currentPath, maxBytesPerFile)
        });
        visited.add(relativePath);
    }
    return {
        topLevelEntries,
        selectedFiles
    };
}
async function readFileSlice(filePath, maxBytes) {
    const content = await fs.readFile(filePath, "utf8");
    return content.slice(0, maxBytes);
}
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function shouldSkipDirectory(relativePath) {
    return [
        "node_modules",
        "dist",
        "build",
        "coverage",
        ".next",
        ".turbo"
    ].includes(relativePath.split(path.sep)[0] ?? "");
}
function shouldSkipFile(relativePath) {
    return /\.(png|jpg|jpeg|gif|svg|ico|lock|snap|min\.js|min\.css)$/i.test(relativePath);
}
