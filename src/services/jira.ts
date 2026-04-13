import axios, { type AxiosInstance } from "axios";

import type { AppConfig } from "../config.js";
import type { JiraImageAttachment, JiraTicket } from "../types.js";
import { Logger } from "../utils/logger.js";
import { extractAcceptanceCriteria, normalizeWhitespace } from "../utils/text.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary?: string;
      description?: unknown;
      attachment?: Array<{
        filename?: string;
        mimeType?: string;
        content?: string;
        thumbnail?: string;
      }>;
      status?: {
        name?: string;
      };
    };
  }>;
}

interface JiraCommentResponse {
  comments: Array<{
    body?: unknown;
  }>;
}

interface JiraTransitionsResponse {
  transitions: Array<{
    id: string;
    name: string;
    to?: {
      name?: string;
      statusCategory?: {
        key?: string;
        name?: string;
      };
    };
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

  async getQueuedTickets(): Promise<JiraTicket[]> {
    const jiraQuery = buildJiraQuery(this.config);
    this.logger.info("Searching Jira for automation-ready tickets", {
      jql: jiraQuery
    });

    let response;
    try {
      response = await this.client.post<JiraSearchResponse>("/rest/api/3/search/jql", {
        jql: jiraQuery,
        maxResults: 100,
        fields: ["summary", "description", "attachment"]
      });
    } catch (error) {
      this.logger.error("Jira issue search failed", error);
      throw error;
    }

    if (response.data.issues.length === 0) {
      this.logger.info("No matching Jira tickets found");
      return [];
    }

    const tickets = await Promise.all(
      response.data.issues.map(async (issue) => {
        const description = normalizeWhitespace(extractPlainText(issue.fields.description));
        const acceptanceCriteria = extractAcceptanceCriteria(description);
        const imageAttachments = extractImageAttachments(issue.fields.attachment);
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

        if (imageAttachments.length > 0) {
          ticket.imageAttachments = imageAttachments;
        }

        if (recentHumanComments.length > 0) {
          ticket.recentHumanComments = recentHumanComments;
        }

        return ticket;
      })
    );

    this.logger.info("Selected Jira ticket batch", {
      count: tickets.length,
      ticketKeys: tickets.map((ticket) => ticket.key)
    });

    return tickets;
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

  async transitionToDone(ticketKey: string): Promise<boolean> {
    this.logger.info(`Attempting Jira done transition for ${ticketKey}`);
    const response = await this.client.get<JiraTransitionsResponse>(`/rest/api/3/issue/${ticketKey}/transitions`);
    const doneTransition = response.data.transitions.find((transition) => {
      const transitionName = transition.name.toLowerCase();
      const targetName = transition.to?.name?.toLowerCase() ?? "";
      const categoryKey = transition.to?.statusCategory?.key?.toLowerCase() ?? "";
      const categoryName = transition.to?.statusCategory?.name?.toLowerCase() ?? "";

      return (
        categoryKey === "done" ||
        categoryName === "done" ||
        transitionName === "done" ||
        transitionName === "closed" ||
        transitionName === "resolve issue" ||
        targetName === "done" ||
        targetName === "closed" ||
        targetName === "resolved"
      );
    });

    if (!doneTransition) {
      this.logger.warn(`No done-like Jira transition available for ${ticketKey}`);
      return false;
    }

    await this.client.post(`/rest/api/3/issue/${ticketKey}/transitions`, {
      transition: {
        id: doneTransition.id
      }
    });

    return true;
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

function combineQueueClauses(clauses: Array<string | undefined>): string {
  const populated = clauses.filter(Boolean);
  if (populated.length === 0) {
    return "";
  }

  if (populated.length === 1) {
    return `(${populated[0]})`;
  }

  return `(${populated.map((clause) => `(${clause})`).join(" OR ")})`;
}

function buildExplicitIncludeClause(keys: string[]): string | undefined {
  if (keys.length === 0) {
    return undefined;
  }

  return `key in (${keys.map((key) => quoteJqlValueIfNeeded(key)).join(", ")})`;
}

function splitJqlOrderBy(jql: string): { query: string; orderBy?: string } {
  const match = jql.match(/^(.*?)(\s+ORDER\s+BY\s+[\s\S]+)$/i);
  if (!match) {
    return { query: jql.trim() };
  }

  const query = match[1]?.trim() ?? jql.trim();
  const orderBy = match[2]?.trim();

  return orderBy ? { query, orderBy } : { query };
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

function extractImageAttachments(value: JiraSearchResponse["issues"][number]["fields"]["attachment"]): JiraImageAttachment[] {
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
