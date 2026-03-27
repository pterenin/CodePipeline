export function slugify(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "ticket";
}
export function truncate(input, maxLength) {
    if (input.length <= maxLength) {
        return input;
    }
    return `${input.slice(0, Math.max(0, maxLength - 3))}...`;
}
export function normalizeWhitespace(input) {
    return input.replace(/\r\n/g, "\n").trim();
}
export function hasStrongRequirements(text, threshold) {
    const normalized = normalizeWhitespace(text);
    if (normalized.length < threshold) {
        return false;
    }
    const sentenceCount = normalized.split(/[.!?]\s+/).filter(Boolean).length;
    return sentenceCount >= 1;
}
export function extractAcceptanceCriteria(description) {
    const match = description.match(/(?:acceptance criteria|acceptance criterias|definition of done)\s*[:\-]?\s*([\s\S]+)/i);
    return match?.[1]?.trim();
}
