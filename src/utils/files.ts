import { promises as fs } from "node:fs";
import path from "node:path";

import { execa } from "execa";

import type { RepositoryContext, RepositoryContextFile, RepositorySearchResult } from "../types.js";

const DEFAULT_CANDIDATE_FILES = ["package.json", "tsconfig.json", "README.md"];

export async function ensureCleanDirectory(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.mkdir(targetPath, { recursive: true });
}

export async function collectRepositoryContext(
  repoPath: string,
  maxFiles: number,
  maxBytesPerFile: number,
  maxSearchResults: number,
  ticketText: string
): Promise<RepositoryContext> {
  const topLevelEntries = (await fs.readdir(repoPath)).sort();
  const fileCatalog = await listRepositoryFiles(repoPath);
  const discoveryQueries = buildDiscoveryQueries(ticketText);
  const searchResults = await searchRepository(repoPath, discoveryQueries, maxSearchResults);
  const selectedFiles = await loadRelevantFiles(
    repoPath,
    fileCatalog,
    searchResults,
    maxFiles,
    maxBytesPerFile
  );

  return {
    topLevelEntries,
    fileCatalog: fileCatalog.slice(0, 300),
    discoveryQueries,
    searchResults,
    selectedFiles
  };
}

export async function loadFilesByPath(
  repoPath: string,
  filePaths: string[],
  maxFiles: number,
  maxBytesPerFile: number
): Promise<RepositoryContextFile[]> {
  const uniquePaths = Array.from(
    new Set(filePaths.map(normalizeRelativePath).filter(Boolean))
  ).slice(0, maxFiles);
  const loaded: RepositoryContextFile[] = [];

  for (const relativePath of uniquePaths) {
    if (
      shouldSkipFile(relativePath) ||
      shouldSkipDirectory(relativePath) ||
      relativePath.startsWith(".git/")
    ) {
      continue;
    }

    const fullPath = path.join(repoPath, relativePath);
    if (!(await fileExists(fullPath))) {
      continue;
    }

    const stats = await fs.stat(fullPath);
    if (!stats.isFile()) {
      continue;
    }

    loaded.push({
      path: relativePath,
      content: await readFileSlice(fullPath, maxBytesPerFile)
    });
  }

  return loaded;
}

async function loadRelevantFiles(
  repoPath: string,
  fileCatalog: string[],
  searchResults: RepositorySearchResult[],
  maxFiles: number,
  maxBytesPerFile: number
): Promise<RepositoryContextFile[]> {
  const selectedPaths: string[] = [];

  for (const candidate of DEFAULT_CANDIDATE_FILES) {
    if (fileCatalog.includes(candidate)) {
      selectedPaths.push(candidate);
    }
  }

  for (const result of searchResults) {
    for (const match of result.matches) {
      selectedPaths.push(match);
      if (selectedPaths.length >= maxFiles) {
        break;
      }
    }
    if (selectedPaths.length >= maxFiles) {
      break;
    }
  }

  if (selectedPaths.length < maxFiles) {
    for (const filePath of prioritizeRepositoryFiles(fileCatalog)) {
      selectedPaths.push(filePath);
      if (selectedPaths.length >= maxFiles) {
        break;
      }
    }
  }

  return loadFilesByPath(repoPath, selectedPaths, maxFiles, maxBytesPerFile);
}

async function listRepositoryFiles(repoPath: string): Promise<string[]> {
  const rgResult = await execa("rg", ["--files", "--hidden", "-g", "!.git"], {
    cwd: repoPath,
    reject: false
  });

  if (rgResult.exitCode === 0) {
    return rgResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !shouldSkipFile(line) && !shouldSkipDirectory(line));
  }

  return walkRepositoryFiles(repoPath, "");
}

async function walkRepositoryFiles(
  repoPath: string,
  currentRelativePath: string
): Promise<string[]> {
  const currentPath = path.join(repoPath, currentRelativePath);
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = currentRelativePath
      ? path.join(currentRelativePath, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(relativePath)) {
        continue;
      }

      files.push(...(await walkRepositoryFiles(repoPath, relativePath)));
      continue;
    }

    if (!shouldSkipFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files;
}

async function searchRepository(
  repoPath: string,
  queries: string[],
  maxSearchResults: number
): Promise<RepositorySearchResult[]> {
  const results: RepositorySearchResult[] = [];

  for (const query of queries) {
    if (!query.trim()) {
      continue;
    }

    const pathMatches = await runRg(repoPath, [
      "--files",
      "--hidden",
      "-g",
      "!.git",
      "-g",
      `*${query}*`
    ]);
    const contentMatches = await runRg(repoPath, [
      "-l",
      "--hidden",
      "-g",
      "!.git",
      "--glob",
      "!node_modules",
      "--glob",
      "!dist",
      query
    ]);

    const merged = Array.from(new Set([...pathMatches, ...contentMatches]))
      .filter((match) => !shouldSkipFile(match) && !shouldSkipDirectory(match))
      .slice(0, maxSearchResults);

    if (merged.length > 0) {
      results.push({
        query,
        matches: merged
      });
    }
  }

  return results;
}

async function runRg(repoPath: string, args: string[]): Promise<string[]> {
  const result = await execa("rg", args, {
    cwd: repoPath,
    reject: false
  });

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildDiscoveryQueries(ticketText: string): string[] {
  const tokens = ticketText
    .toLowerCase()
    .split(/[^a-z0-9/_-]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);

  return Array.from(new Set(tokens)).slice(0, 8);
}

function normalizeRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!normalized || normalized.includes("..")) {
    return "";
  }

  return normalized;
}

async function readFileSlice(filePath: string, maxBytes: number): Promise<string> {
  const content = await fs.readFile(filePath, "utf8");
  return content.slice(0, maxBytes);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldSkipDirectory(relativePath: string): boolean {
  const rootSegment = relativePath.split(path.sep)[0]?.split("/")[0] ?? "";

  return ["node_modules", "dist", "build", "coverage", ".next", ".turbo"].includes(rootSegment);
}

function shouldSkipFile(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const baseName = path.basename(normalizedPath);

  if (
    baseName === ".DS_Store" ||
    normalizedPath.startsWith(".git/") ||
    normalizedPath.startsWith(".expo/") ||
    normalizedPath.startsWith(".claude/") ||
    normalizedPath === ".env" ||
    normalizedPath.endsWith(".log")
  ) {
    return true;
  }

  if (
    baseName.startsWith(".") &&
    !DEFAULT_CANDIDATE_FILES.includes(normalizedPath) &&
    normalizedPath !== ".env.example"
  ) {
    return true;
  }

  return /\.(png|jpg|jpeg|gif|svg|ico|lock|snap|min\.js|min\.css)$/i.test(normalizedPath);
}

function prioritizeRepositoryFiles(filePaths: string[]): string[] {
  return [...filePaths].sort((left, right) => scoreFilePath(right) - scoreFilePath(left));
}

function scoreFilePath(filePath: string): number {
  let score = 0;

  if (filePath.startsWith("src/")) {
    score += 100;
  }
  if (
    filePath.includes("/components/") ||
    filePath.includes("/app/") ||
    filePath.includes("/pages/")
  ) {
    score += 40;
  }
  if (filePath.includes("__tests__") || /test|spec/i.test(filePath)) {
    score += 30;
  }
  if (/proposal|form|preview|field/i.test(filePath)) {
    score += 25;
  }
  if (/\.(ts|tsx|js|jsx|json|md)$/i.test(filePath)) {
    score += 10;
  }

  return score;
}
