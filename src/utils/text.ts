export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "ticket"
  );
}

export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }

  return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

export function hasStrongRequirements(text: string, threshold: number): boolean {
  const normalized = normalizeWhitespace(text);
  if (normalized.length < threshold) {
    return false;
  }

  const sentenceCount = normalized.split(/[.!?](?:\s+|$)/).filter(Boolean).length;
  const bulletCount = normalized
    .split("\n")
    .filter((line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line)).length;
  const sectionSignalCount = [
    "acceptance criteria",
    "definition of done",
    "implementation notes",
    "relevant code context",
    "goal",
    "why"
  ].filter((signal) => normalized.toLowerCase().includes(signal)).length;
  const codeReferenceCount =
    (normalized.match(/`[^`]+`/g)?.length ?? 0) +
    (normalized.match(/\bsrc\/[A-Za-z0-9_./[\]-]+/g)?.length ?? 0);

  const readinessSignals = [
    normalized.length >= Math.max(threshold * 4, 120),
    sentenceCount >= 3,
    bulletCount >= 2,
    sectionSignalCount >= 2,
    codeReferenceCount >= 1
  ].filter(Boolean).length;

  return readinessSignals >= 2;
}

export function extractAcceptanceCriteria(description: string): string | undefined {
  const match = description.match(
    /(?:acceptance criteria|acceptance criterias|definition of done)\s*[:-]?\s*([\s\S]+)/i
  );

  return match?.[1]?.trim();
}
