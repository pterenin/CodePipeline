import axios, { type AxiosInstance } from "axios";

import type { AppConfig } from "../config.js";
import type { JiraTicket } from "../types.js";
import { Logger } from "../utils/logger.js";
import { extractAcceptanceCriteria, normalizeWhitespace } from "../utils/text.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary?: string;
      description?: unknown;
    };
  }>;
}

interface JiraCommentResponse {
  comments: Array<{
    body?: unknown;
  }>;
}

export class JiraService {
  private readonly client: AxiosInstance;
  private readonly logger = new Logger("jira");

  constructor(private readonly config: AppConfig) {
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

  async getNextTicket(): Promise<JiraTicket | null> {
    const jiraQuery = buildJiraQuery(this.config);
    this.logger.info("Searching Jira for next automation-ready ticket", {
      jql: jiraQuery
    });

    let response;
    try {
      response = await this.client.post<JiraSearchResponse>("/rest/api/3/search/jql", {
        jql: jiraQuery,
        maxResults: 1,
        fields: ["summary", "description"]
      });
    } catch (error) {
      this.logger.error("Jira issue search failed", error);
      throw error;
    }

    const issue = response.data.issues[0];
    if (!issue) {
      this.logger.info("No matching Jira tickets found");
      return null;
    }

    const description = normalizeWhitespace(extractPlainText(issue.fields.description));

    const acceptanceCriteria = extractAcceptanceCriteria(description);
    const recentHumanComments = await this.getRecentHumanComments(issue.key);

    const ticket: JiraTicket = {
      key: issue.key,
      summary: normalizeWhitespace(issue.fields.summary ?? "(no summary)"),
      description,
      url: `${this.config.JIRA_BASE_URL}/browse/${issue.key}`
    };

    if (acceptanceCriteria) {
      ticket.acceptanceCriteria = acceptanceCriteria;
    }

    if (recentHumanComments.length > 0) {
      ticket.recentHumanComments = recentHumanComments;
    }

    this.logger.info(`Selected Jira ticket ${ticket.key}`, {
      summary: ticket.summary,
      recentHumanComments: recentHumanComments.length
    });

    return ticket;
  }

  async addComment(ticketKey: string, body: string): Promise<void> {
    this.logger.info(`Adding Jira comment to ${ticketKey}`);
    await this.client.post(`/rest/api/3/issue/${ticketKey}/comment`, {
      body: toAdfDocument(prefixAiAgentComment(body))
    });
  }

  async addLabel(ticketKey: string, label: string): Promise<void> {
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

  private async getRecentHumanComments(ticketKey: string): Promise<string[]> {
    this.logger.info(`Fetching recent Jira comments for ${ticketKey}`);

    const response = await this.client.get<JiraCommentResponse>(`/rest/api/3/issue/${ticketKey}/comment`, {
      params: {
        maxResults: 50
      }
    });

    return response.data.comments
      .map((comment) => normalizeWhitespace(extractPlainText(comment.body)))
      .filter(Boolean)
      .filter((comment) => !comment.startsWith("AI Agent:"))
      .slice(-5);
  }
}

function prefixAiAgentComment(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "AI Agent:";
  }

  if (trimmed.startsWith("AI Agent:")) {
    return trimmed;
  }

  return `AI Agent: ${trimmed}`;
}

function toAdfDocument(text: string): {
  type: "doc";
  version: 1;
  content: Array<{
    type: "paragraph";
    content: Array<{
      type: "text";
      text: string;
    }>;
  }>;
} {
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

function buildJiraQuery(config: AppConfig): string {
  if (config.JIRA_JQL) {
    return `(${config.JIRA_JQL}) AND (labels is EMPTY OR labels not in (ai-done))`;
  }

  const parts = [`project = ${config.JIRA_PROJECT_KEY}`, `(labels is EMPTY OR labels not in (ai-done))`];

  if (config.JIRA_QUEUE_LABEL) {
    parts.push(`labels = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_LABEL)}`);
  }

  if (config.JIRA_QUEUE_STATUS) {
    parts.push(`status = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_STATUS)}`);
  }

  return `${parts.join(" AND ")} ORDER BY priority DESC, created ASC`;
}

function quoteJqlValueIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function extractPlainText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  const node = value as {
    text?: string;
    content?: unknown[];
  };

  const parts: string[] = [];
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
