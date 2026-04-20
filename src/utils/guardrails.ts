import type { AppConfig } from "../config.js";
import type { JiraTicket } from "../types.js";
import { hasStrongRequirements } from "./text.js";

export function evaluateTicketGuardrails(
  ticket: JiraTicket,
  config: Pick<
    AppConfig,
    "hardBlockedKeywords" | "scanHumanCommentsInGuardrails" | "weakRequirementThreshold"
  >
): string | null {
  const requirementsText = [
    ticket.summary,
    ticket.description,
    ticket.acceptanceCriteria ?? "",
    ticket.humanComments?.join("\n\n") ?? ""
  ].join("\n");

  const keywordText = [
    ticket.summary,
    ticket.description,
    ticket.acceptanceCriteria ?? "",
    ...(config.scanHumanCommentsInGuardrails ? ticket.humanComments ?? [] : [])
  ].join("\n");

  const hardBlockedKeyword = findHardBlockedKeyword(keywordText, config.hardBlockedKeywords);
  if (hardBlockedKeyword) {
    return `Ticket contains hard-blocked keyword "${hardBlockedKeyword}" and is outside automation scope.`;
  }

  if (!hasStrongRequirements(requirementsText, config.weakRequirementThreshold)) {
    return "Ticket requirements are too weak or incomplete for safe automation.";
  }

  return null;
}

function findHardBlockedKeyword(text: string, keywords: string[]): string | null {
  if (keywords.length === 0) {
    return null;
  }

  const normalizedText = normalizeForKeywordMatch(text);
  for (const keyword of keywords) {
    if (!keyword.trim()) {
      continue;
    }

    const pattern = buildKeywordPattern(keyword);
    if (pattern.test(normalizedText)) {
      return keyword;
    }
  }

  return null;
}

function buildKeywordPattern(keyword: string): RegExp {
  const normalizedKeyword = normalizeForKeywordMatch(keyword);
  const tokens = normalizedKeyword.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return /$^/;
  }

  const lastToken = tokens.at(-1) ?? "";
  const baseTokens = tokens.slice(0, -1);
  const lastTokenPattern = /s$/.test(lastToken)
    ? escapeRegExp(lastToken)
    : `${escapeRegExp(lastToken)}s?`;
  const joinedPattern = [...baseTokens.map(escapeRegExp), lastTokenPattern].join("\\s+");

  return new RegExp(`(?:^|\\b)${joinedPattern}(?:\\b|$)`, "i");
}

function normalizeForKeywordMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
