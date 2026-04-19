import axios from "axios";
import { Logger } from "../utils/logger.js";
import { extractAcceptanceCriteria, normalizeWhitespace } from "../utils/text.js";
export class JiraService {
    config;
    client;
    logger = new Logger("jira");
    constructor(config) {
        this.config = config;
        this.client = axios.create({
            baseURL: config.JIRA_BASE_URL,
            auth: {
                username: config.JIRA_EMAIL,
                password: config.JIRA_API_TOKEN
            },
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json"
            },
            timeout: 30000
        });
    }
    async getQueuedTickets() {
        const jiraQuery = buildJiraQuery(this.config);
        this.logger.info("Searching Jira for automation-ready tickets", {
            jql: jiraQuery
        });
        let response;
        try {
            response = await this.client.post("/rest/api/3/search/jql", {
                jql: jiraQuery,
                maxResults: 100,
                fields: ["summary", "description", "attachment"]
            });
        }
        catch (error) {
            this.logger.error("Jira issue search failed", error);
            throw error;
        }
        if (response.data.issues.length === 0) {
            this.logger.info("No matching Jira tickets found");
            return [];
        }
        const tickets = await Promise.all(response.data.issues.map(async (issue) => {
            const description = normalizeWhitespace(extractPlainText(issue.fields.description));
            const acceptanceCriteria = extractAcceptanceCriteria(description);
            const imageAttachments = extractImageAttachments(issue.fields.attachment);
            const humanComments = await this.getHumanComments(issue.key);
            const htmlAttachments = extractHtmlAttachments(issue.fields.attachment);
            const ticket = {
                key: issue.key,
                summary: normalizeWhitespace(issue.fields.summary ?? "(no summary)"),
                description,
                url: `${this.config.JIRA_BASE_URL}/browse/${issue.key}`
            };
            if (acceptanceCriteria) {
                ticket.acceptanceCriteria = acceptanceCriteria;
            }
            if (imageAttachments.length > 0) {
                ticket.imageAttachments = imageAttachments;
            }
            if (htmlAttachments.length > 0) {
                ticket.htmlAttachments = htmlAttachments;
            }
            if (humanComments.length > 0) {
                ticket.humanComments = humanComments;
            }
            return ticket;
        }));
        this.logger.info("Selected Jira ticket batch", {
            count: tickets.length,
            ticketKeys: tickets.map((ticket) => ticket.key)
        });
        return tickets;
    }
    async addComment(ticketKey, body) {
        this.logger.info(`Adding Jira comment to ${ticketKey}`);
        await this.client.post(`/rest/api/3/issue/${ticketKey}/comment`, {
            body: toAdfDocument(prefixAiAgentComment(body))
        });
    }
    async addLabel(ticketKey, label) {
        this.logger.info(`Adding Jira label to ${ticketKey}`, { label });
        await this.client.put(`/rest/api/3/issue/${ticketKey}`, {
            update: {
                labels: [
                    {
                        add: label
                    }
                ]
            }
        });
    }
    async transitionToInReview(ticketKey) {
        this.logger.info(`Attempting Jira In Review transition for ${ticketKey}`);
        const response = await this.client.get(`/rest/api/3/issue/${ticketKey}/transitions`);
        const reviewTransition = response.data.transitions.find((transition) => {
            const transitionName = transition.name.toLowerCase();
            const targetName = transition.to?.name?.toLowerCase() ?? "";
            return transitionName === "in review" || targetName === "in review";
        });
        if (!reviewTransition) {
            this.logger.warn(`No In Review Jira transition available for ${ticketKey}`);
            return false;
        }
        await this.client.post(`/rest/api/3/issue/${ticketKey}/transitions`, {
            transition: {
                id: reviewTransition.id
            }
        });
        return true;
    }
    async getHumanComments(ticketKey) {
        this.logger.info(`Fetching Jira comments for ${ticketKey}`);
        const response = await this.client.get(`/rest/api/3/issue/${ticketKey}/comment`, {
            params: {
                maxResults: 50
            }
        });
        return response.data.comments
            .map((comment) => normalizeWhitespace(extractPlainText(comment.body)))
            .filter(Boolean)
            .filter((comment) => !comment.startsWith("AI Agent:"));
    }
}
function prefixAiAgentComment(body) {
    const trimmed = body.trim();
    if (!trimmed) {
        return "AI Agent:";
    }
    if (trimmed.startsWith("AI Agent:")) {
        return trimmed;
    }
    return `AI Agent: ${trimmed}`;
}
function toAdfDocument(text) {
    const paragraphs = text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
    return {
        type: "doc",
        version: 1,
        content: paragraphs.map((paragraph) => ({
            type: "paragraph",
            content: [
                {
                    type: "text",
                    text: paragraph
                }
            ]
        }))
    };
}
function buildJiraQuery(config) {
    const explicitIncludeClause = buildExplicitIncludeClause(config.jiraForceIncludeKeys);
    if (config.JIRA_JQL) {
        const { query, orderBy } = splitJqlOrderBy(config.JIRA_JQL);
        const baseQuery = combineQueueClauses([query, explicitIncludeClause]);
        return `${baseQuery} AND (labels is EMPTY OR labels not in (ai-done))${orderBy ? ` ${orderBy}` : ""}`;
    }
    const parts = [`project = ${config.JIRA_PROJECT_KEY}`];
    if (config.JIRA_QUEUE_LABEL) {
        parts.push(`labels = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_LABEL)}`);
    }
    if (config.JIRA_QUEUE_STATUS) {
        parts.push(`status = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_STATUS)}`);
    }
    return `${combineQueueClauses([parts.join(" AND "), explicitIncludeClause])} AND (labels is EMPTY OR labels not in (ai-done)) ORDER BY priority DESC, created ASC`;
}
function combineQueueClauses(clauses) {
    const populated = clauses.filter(Boolean);
    if (populated.length === 0) {
        return "";
    }
    if (populated.length === 1) {
        return `(${populated[0]})`;
    }
    return `(${populated.map((clause) => `(${clause})`).join(" OR ")})`;
}
function buildExplicitIncludeClause(keys) {
    if (keys.length === 0) {
        return undefined;
    }
    return `key in (${keys.map((key) => quoteJqlValueIfNeeded(key)).join(", ")})`;
}
function splitJqlOrderBy(jql) {
    const match = jql.match(/^(.*?)(\s+ORDER\s+BY\s+[\s\S]+)$/i);
    if (!match) {
        return { query: jql.trim() };
    }
    const query = match[1]?.trim() ?? jql.trim();
    const orderBy = match[2]?.trim();
    return orderBy ? { query, orderBy } : { query };
}
function quoteJqlValueIfNeeded(value) {
    return /\s/.test(value) ? `"${value}"` : value;
}
function extractPlainText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return "";
    }
    const node = value;
    const parts = [];
    if (typeof node.text === "string") {
        parts.push(node.text);
    }
    if (Array.isArray(node.content)) {
        for (const child of node.content) {
            const childText = extractPlainText(child);
            if (childText) {
                parts.push(childText);
            }
        }
    }
    return parts.join("\n");
}
function extractImageAttachments(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((attachment) => (attachment.mimeType ?? "").toLowerCase().startsWith("image/"))
        .map((attachment) => ({
        filename: normalizeWhitespace(attachment.filename ?? "image"),
        mimeType: attachment.mimeType ?? "application/octet-stream",
        contentUrl: attachment.content ?? "",
        ...(attachment.thumbnail ? { thumbnailUrl: attachment.thumbnail } : {})
    }))
        .filter((attachment) => Boolean(attachment.contentUrl));
}
function extractHtmlAttachments(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((attachment) => {
        const filename = (attachment.filename ?? "").toLowerCase();
        const mimeType = (attachment.mimeType ?? "").toLowerCase();
        return mimeType === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm");
    })
        .map((attachment) => ({
        filename: normalizeWhitespace(attachment.filename ?? "example.html"),
        mimeType: attachment.mimeType ?? "text/html",
        contentUrl: attachment.content ?? ""
    }))
        .filter((attachment) => Boolean(attachment.contentUrl));
}
