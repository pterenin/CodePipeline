import type { JiraComment, JiraTicket } from "../types.js";

const PATH_REFERENCE_PATTERN =
  /(?:^|[\s("'`])((?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.[A-Za-z0-9._-]{1,15})(?=$|[\s)"'`.,:;!?])/g;

export function collectTicketTextSources(
  ticket: Pick<
    JiraTicket,
    "summary" | "description" | "acceptanceCriteria" | "comments" | "humanComments"
  >
): string[] {
  return [
    ticket.summary,
    ticket.description,
    ticket.acceptanceCriteria ?? "",
    ...(ticket.comments ?? []).map((comment) => comment.bodyText),
    ...(ticket.humanComments ?? [])
  ]
    .map((value) => value.trim())
    .filter(Boolean);
}

export function extractLikelyRepoFileReferences(sources: string[], repoName?: string): string[] {
  const matches = new Set<string>();

  for (const source of sources) {
    for (const match of source.matchAll(PATH_REFERENCE_PATTERN)) {
      const rawReference = match[1]?.trim();
      if (!rawReference) {
        continue;
      }

      for (const candidate of buildRepoFileReferenceCandidates(rawReference, repoName)) {
        matches.add(candidate);
      }
    }
  }

  return Array.from(matches);
}

export function formatJiraCommentsForPrompt(
  comments?: JiraComment[],
  fallbackComments?: string[]
): string {
  if (comments && comments.length > 0) {
    return comments
      .map((comment, index) =>
        [
          `Comment ${index + 1}${comment.id ? ` (${comment.id})` : ""}`,
          comment.authorName ? `Author: ${comment.authorName}` : undefined,
          comment.createdAt ? `Created: ${comment.createdAt}` : undefined,
          comment.updatedAt && comment.updatedAt !== comment.createdAt
            ? `Updated: ${comment.updatedAt}`
            : undefined,
          "Body:",
          comment.bodyText || "(empty)"
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n---\n\n");
  }

  if (fallbackComments && fallbackComments.length > 0) {
    return fallbackComments
      .map((comment, index) => `Comment ${index + 1}\nBody:\n${comment}`)
      .join("\n\n---\n\n");
  }

  return "(none)";
}

function buildRepoFileReferenceCandidates(reference: string, repoName?: string): string[] {
  const normalized = reference
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/");

  if (repoName && normalized.startsWith(`${repoName}/`)) {
    return [normalized.slice(repoName.length + 1)].filter(Boolean);
  }

  return [normalized].filter(Boolean);
}
