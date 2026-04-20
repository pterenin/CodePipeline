import axios, { type AxiosInstance } from "axios";

import type { AppConfig } from "../config.js";
import type { JiraComment, JiraHtmlAttachment, JiraImageAttachment, JiraTicket } from "../types.js";
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
  startAt?: number;
  maxResults?: number;
  total?: number;
  comments: Array<{
    id?: string;
    body?: unknown;
    author?: {
      displayName?: string;
    };
    created?: string;
    updated?: string;
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
        const comments = await this.getTicketComments(issue.key);
        const htmlAttachments = extractHtmlAttachments(issue.fields.attachment);

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

        if (htmlAttachments.length > 0) {
          ticket.htmlAttachments = htmlAttachments;
        }

        if (comments.length > 0) {
          ticket.comments = comments;
          ticket.humanComments = comments.map((comment) => comment.bodyText);
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
      body: toAdfDocument(prefixAutomationComment(body, this.config.JIRA_COMMENT_PREFIX))
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

  async transitionToReviewStatus(ticketKey: string): Promise<boolean> {
    this.logger.info(`Attempting Jira transition for ${ticketKey}`, {
      targetStatus: this.config.JIRA_REVIEW_TRANSITION_NAME
    });
    const response = await this.client.get<JiraTransitionsResponse>(
      `/rest/api/3/issue/${ticketKey}/transitions`
    );
    const targetStatus = this.config.JIRA_REVIEW_TRANSITION_NAME.toLowerCase();
    const reviewTransition = response.data.transitions.find((transition) => {
      const transitionName = transition.name.toLowerCase();
      const targetName = transition.to?.name?.toLowerCase() ?? "";

      return transitionName === targetStatus || targetName === targetStatus;
    });

    if (!reviewTransition) {
      this.logger.warn(`No matching Jira transition available for ${ticketKey}`, {
        targetStatus: this.config.JIRA_REVIEW_TRANSITION_NAME
      });
      return false;
    }

    await this.client.post(`/rest/api/3/issue/${ticketKey}/transitions`, {
      transition: {
        id: reviewTransition.id
      }
    });

    return true;
  }

  private async getTicketComments(ticketKey: string): Promise<JiraComment[]> {
    this.logger.info(`Fetching Jira comments for ${ticketKey}`);

    const comments: JiraComment[] = [];
    const maxResults = 100;
    let startAt = 0;

    while (true) {
      const response = await this.client.get<JiraCommentResponse>(
        `/rest/api/3/issue/${ticketKey}/comment`,
        {
          params: {
            startAt,
            maxResults
          }
        }
      );

      const pageComments = response.data.comments
        .map((comment) => {
          const bodyText = normalizeWhitespace(extractPlainText(comment.body));
          if (!bodyText || hasAutomationCommentPrefix(bodyText, this.config.JIRA_COMMENT_PREFIX)) {
            return null;
          }

          return {
            ...(comment.id ? { id: comment.id } : {}),
            ...(comment.author?.displayName ? { authorName: comment.author.displayName } : {}),
            ...(comment.created ? { createdAt: comment.created } : {}),
            ...(comment.updated ? { updatedAt: comment.updated } : {}),
            bodyText
          } satisfies JiraComment;
        })
        .filter((comment): comment is JiraComment => Boolean(comment));

      comments.push(...pageComments);

      const receivedCount = response.data.comments.length;
      const total = response.data.total ?? startAt + receivedCount;
      if (receivedCount === 0 || startAt + receivedCount >= total) {
        break;
      }

      startAt += receivedCount;
    }

    return comments;
  }
}

function prefixAutomationComment(body: string, prefix: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return prefix;
  }

  if (hasAutomationCommentPrefix(trimmed, prefix)) {
    return trimmed;
  }

  return `${prefix} ${trimmed}`;
}

function hasAutomationCommentPrefix(body: string, prefix: string): boolean {
  return body.trimStart().toLowerCase().startsWith(prefix.toLowerCase());
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
    return `${baseQuery} AND (labels is EMPTY OR labels not in (${quoteJqlValueIfNeeded(config.JIRA_DONE_LABEL)}))${orderBy ? ` ${orderBy}` : ""}`;
  }

  const parts = [`project = ${config.JIRA_PROJECT_KEY}`];

  if (config.JIRA_QUEUE_LABEL) {
    parts.push(`labels = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_LABEL)}`);
  }

  if (config.JIRA_QUEUE_STATUS) {
    parts.push(`status = ${quoteJqlValueIfNeeded(config.JIRA_QUEUE_STATUS)}`);
  }

  return `${combineQueueClauses([parts.join(" AND "), explicitIncludeClause])} AND (labels is EMPTY OR labels not in (${quoteJqlValueIfNeeded(config.JIRA_DONE_LABEL)})) ORDER BY priority DESC, created ASC`;
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

function extractImageAttachments(
  value: JiraSearchResponse["issues"][number]["fields"]["attachment"]
): JiraImageAttachment[] {
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

function extractHtmlAttachments(
  value: JiraSearchResponse["issues"][number]["fields"]["attachment"]
): JiraHtmlAttachment[] {
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
