import type { AppConfig } from "../config.js";
import type { JiraTicket } from "../types.js";
import { hasStrongRequirements } from "./text.js";

export function evaluateTicketGuardrails(
  ticket: JiraTicket,
  config: Pick<AppConfig, "hardBlockedKeywordPattern" | "weakRequirementThreshold">
): string | null {
  const combinedText = [
    ticket.summary,
    ticket.description,
    ticket.acceptanceCriteria ?? "",
    ticket.humanComments?.join("\n\n") ?? ""
  ].join("\n");

  if (config.hardBlockedKeywordPattern.test(combinedText)) {
    return "Ticket contains hard-blocked keywords and is outside automation scope.";
  }

  if (!hasStrongRequirements(combinedText, config.weakRequirementThreshold)) {
    return "Ticket requirements are too weak or incomplete for safe automation.";
  }

  return null;
}
