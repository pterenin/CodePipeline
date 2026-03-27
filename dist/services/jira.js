import axios from "axios";
import { extractAcceptanceCriteria, normalizeWhitespace } from "../utils/text.js";
export class JiraService {
    config;
    client;
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
    async getNextTicket() {
        const response = await this.client.post("/rest/api/3/search", {
            jql: this.config.JIRA_JQL,
            maxResults: 1,
            fields: ["summary", "description"]
        });
        const issue = response.data.issues[0];
        if (!issue) {
            return null;
        }
        const description = normalizeWhitespace(extractPlainText(issue.fields.description));
        const acceptanceCriteria = extractAcceptanceCriteria(description);
        const ticket = {
            key: issue.key,
            summary: normalizeWhitespace(issue.fields.summary ?? "(no summary)"),
            description,
            url: `${this.config.JIRA_BASE_URL}/browse/${issue.key}`
        };
        if (acceptanceCriteria) {
            ticket.acceptanceCriteria = acceptanceCriteria;
        }
        return ticket;
    }
    async addComment(ticketKey, body) {
        await this.client.post(`/rest/api/3/issue/${ticketKey}/comment`, {
            body
        });
    }
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
