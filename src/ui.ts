export function renderAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodePipeline</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #120f1f;
        --bg-accent:
          radial-gradient(circle at 12% 18%, rgba(98, 160, 255, 0.18), transparent 24%),
          radial-gradient(circle at 84% 14%, rgba(130, 105, 255, 0.16), transparent 22%),
          radial-gradient(circle at 52% 72%, rgba(0, 212, 255, 0.08), transparent 28%),
          linear-gradient(180deg, #141026 0%, #17132d 44%, #120f23 100%);
        --panel: rgba(40, 35, 58, 0.84);
        --panel-strong: rgba(49, 43, 71, 0.96);
        --panel-soft: rgba(255, 255, 255, 0.08);
        --line: rgba(231, 237, 255, 0.22);
        --line-strong: rgba(231, 237, 255, 0.42);
        --text: #f5f7ff;
        --muted: #d7dbef;
        --subtle: #a8afd2;
        --running: #7ab8ff;
        --success: #62d98b;
        --failed: #ff7f8b;
        --skipped: #ffd166;
        --idle: #8b90ab;
        --shadow: 0 28px 100px rgba(5, 4, 17, 0.34);
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        min-height: 100%;
      }

      body {
        min-height: 100vh;
        font-family: "Segoe UI", "SF Pro Display", "Helvetica Neue", sans-serif;
        background: var(--bg-accent);
        color: var(--text);
      }

      button,
      input,
      textarea,
      select {
        font: inherit;
      }

      .app-shell {
        position: relative;
        max-width: 1560px;
        margin: 0 auto;
        padding: 28px 20px 42px;
      }

      .grid-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(212, 217, 255, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(212, 217, 255, 0.08) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.46), transparent 92%);
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.8fr);
        gap: 20px;
        margin-bottom: 20px;
      }

      .hero-card,
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 26px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(16px);
      }

      .hero-card {
        padding: 28px;
        position: relative;
        overflow: hidden;
      }

      .hero-card::after {
        content: "";
        position: absolute;
        inset: auto -10% -35% 30%;
        height: 260px;
        background: radial-gradient(circle, rgba(122, 184, 255, 0.24), transparent 64%);
        pointer-events: none;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 14px;
        padding: 7px 12px;
        border-radius: 999px;
        border: 1px solid rgba(122, 184, 255, 0.26);
        background: rgba(122, 184, 255, 0.14);
        color: #dceeff;
        font-size: 0.82rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .headline {
        margin: 0;
        max-width: 780px;
        font-size: clamp(2.3rem, 4vw, 4.4rem);
        line-height: 0.94;
        letter-spacing: -0.05em;
      }

      .subhead {
        margin: 14px 0 0;
        max-width: 760px;
        color: var(--muted);
        font-size: 1.01rem;
        line-height: 1.7;
      }

      .hero-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 26px;
      }

      .start-button {
        border: 0;
        border-radius: 16px;
        padding: 14px 22px;
        min-width: 148px;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #7ab8ff 0%, #8e7dff 100%);
        box-shadow: 0 18px 38px rgba(122, 184, 255, 0.34);
        cursor: pointer;
        transition: transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
      }

      .start-button:hover:enabled {
        transform: translateY(-1px);
        box-shadow: 0 24px 46px rgba(122, 184, 255, 0.4);
      }

      .start-button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        box-shadow: none;
      }

      .stop-button {
        background: linear-gradient(135deg, #ff7f8b 0%, #c83f59 100%);
        box-shadow: 0 18px 38px rgba(200, 63, 89, 0.32);
      }

      .stop-button:hover:enabled {
        transform: translateY(-1px);
        box-shadow: 0 24px 46px rgba(200, 63, 89, 0.38);
      }

      .ghost-chip {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 12px 15px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
      }

      .ghost-chip strong {
        color: var(--text);
      }

      .connection-chip.connected {
        border-color: rgba(98, 217, 139, 0.3);
        background: rgba(98, 217, 139, 0.14);
      }

      .connection-chip.reconnecting {
        border-color: rgba(122, 184, 255, 0.3);
        background: rgba(122, 184, 255, 0.14);
      }

      .connection-chip.offline {
        border-color: rgba(255, 127, 139, 0.3);
        background: rgba(255, 127, 139, 0.14);
      }

      .hero-side {
        display: grid;
        gap: 16px;
      }

      .stat-card {
        padding: 22px;
      }

      .stat-label {
        margin: 0 0 12px;
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .stat-value {
        margin: 0;
        font-size: clamp(1.8rem, 3vw, 2.8rem);
        letter-spacing: -0.04em;
      }

      .stat-copy {
        margin: 10px 0 0;
        color: var(--subtle);
        line-height: 1.6;
      }

      .main-layout {
        display: grid;
        grid-template-columns: minmax(0, 1.45fr) minmax(330px, 0.72fr);
        gap: 20px;
      }

      .panel {
        padding: 24px;
      }

      .panel-title {
        margin: 0;
        font-size: 1.08rem;
        letter-spacing: -0.02em;
      }

      .panel-copy {
        margin: 8px 0 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .pipeline-panel {
        overflow: hidden;
      }

      .pipeline-wrap {
        margin-top: 22px;
        display: grid;
        gap: 10px;
      }

      .pipeline-stage {
        padding: 18px;
        border-radius: 22px;
        border: 1px solid rgba(232, 236, 255, 0.14);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02)),
          rgba(24, 20, 40, 0.6);
      }

      .pipeline-loop {
        position: relative;
        padding: 18px;
        border-radius: 22px;
        border: 1px dashed rgba(122, 184, 255, 0.38);
        background:
          linear-gradient(180deg, rgba(122, 184, 255, 0.06), rgba(122, 184, 255, 0.01)),
          rgba(24, 20, 40, 0.6);
      }

      .pipeline-loop::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background:
          radial-gradient(circle at 100% 0%, rgba(122, 184, 255, 0.12), transparent 40%);
      }

      .pipeline-stage-head,
      .pipeline-loop-head {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
        position: relative;
      }

      .pipeline-stage-badge {
        display: inline-flex;
        align-items: center;
        padding: 5px 11px;
        border-radius: 999px;
        font-size: 0.72rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        font-weight: 600;
      }

      .pipeline-stage-badge.queue {
        border: 1px solid rgba(122, 184, 255, 0.42);
        background: rgba(122, 184, 255, 0.18);
        color: #d7ebff;
      }

      .pipeline-stage-badge.ticket {
        border: 1px solid rgba(142, 125, 255, 0.42);
        background: rgba(142, 125, 255, 0.18);
        color: #e2daff;
      }

      .pipeline-stage-note {
        color: var(--subtle);
        font-size: 0.84rem;
      }

      .pipeline-loop-meta {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(122, 184, 255, 0.32);
        background: rgba(122, 184, 255, 0.1);
        color: #d7ebff;
        font-size: 0.72rem;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .pipeline-flow-divider {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 0 6px;
        color: rgba(122, 184, 255, 0.9);
        font-size: 0.74rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .pipeline-flow-divider .divider-chevron {
        font-size: 1rem;
      }

      .pipeline-flow-divider .divider-rule {
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, rgba(122, 184, 255, 0.35), transparent);
      }

      .pipeline-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: stretch;
      }

      .pipeline-phases {
        display: grid;
        gap: 4px;
      }

      .pipeline-phase-row {
        display: grid;
        grid-template-columns: 184px minmax(0, 1fr);
        gap: 18px;
        align-items: start;
        padding: 10px 0;
      }

      .pipeline-phase-row + .pipeline-phase-row {
        border-top: 1px dashed rgba(232, 236, 255, 0.08);
      }

      .pipeline-phase-label {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding-top: 4px;
      }

      .pipeline-phase-label .phase-index {
        flex: 0 0 34px;
        width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        border: 1px solid rgba(232, 236, 255, 0.2);
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }

      .pipeline-phase-label strong {
        display: block;
        color: var(--text);
        font-size: 0.95rem;
        letter-spacing: -0.01em;
        margin-bottom: 3px;
      }

      .pipeline-phase-label span {
        display: block;
        color: var(--subtle);
        font-size: 0.8rem;
        line-height: 1.5;
      }

      .pipeline-phase-nodes {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: stretch;
      }

      .pipeline-connector {
        align-self: center;
        display: inline-flex;
        align-items: center;
        color: rgba(232, 236, 255, 0.28);
        flex: 0 0 auto;
      }

      .pipeline-connector.running {
        color: rgba(122, 184, 255, 0.9);
      }

      .pipeline-connector.completed {
        color: rgba(98, 217, 139, 0.85);
      }

      .pipeline-connector.failed {
        color: rgba(255, 127, 139, 0.85);
      }

      .pipeline-connector.skipped {
        color: rgba(255, 209, 102, 0.85);
      }

      @media (max-width: 900px) {
        .pipeline-phase-row {
          grid-template-columns: 1fr;
          gap: 10px;
        }

        .pipeline-connector svg {
          transform: rotate(90deg);
        }
      }

      .pipeline-node {
        position: relative;
        flex: 1 1 236px;
        min-width: 220px;
        max-width: 320px;
        padding: 14px 14px 12px;
        border-radius: 16px;
        border: 1px solid rgba(232, 236, 255, 0.2);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.03) 100%),
          rgba(37, 31, 56, 0.95);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          0 10px 22px rgba(8, 7, 20, 0.18);
        display: grid;
        gap: 6px;
        align-content: start;
      }

      .pipeline-node.runs-once {
        flex-basis: 300px;
        border-style: dashed;
        border-color: rgba(122, 184, 255, 0.48);
        background:
          linear-gradient(135deg, rgba(122, 184, 255, 0.14), rgba(122, 184, 255, 0.02)),
          rgba(37, 31, 56, 0.95);
      }

      .pipeline-node.active {
        border-color: rgba(122, 184, 255, 0.72);
        box-shadow:
          0 0 0 1px rgba(122, 184, 255, 0.32),
          0 0 0 6px rgba(122, 184, 255, 0.1),
          0 16px 32px rgba(12, 10, 28, 0.32);
      }

      .pipeline-node.completed {
        border-color: rgba(98, 217, 139, 0.5);
      }

      .pipeline-node.failed {
        border-color: rgba(255, 127, 139, 0.58);
      }

      .pipeline-node.skipped {
        border-color: rgba(255, 209, 102, 0.48);
      }

      .pipeline-node-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }

      .pipeline-node-tag {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 0.68rem;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--subtle);
      }

      .pipeline-node-tag .node-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        padding: 2px 6px;
        border-radius: 7px;
        border: 1px solid rgba(232, 236, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
        color: var(--muted);
        font-weight: 700;
      }

      .pipeline-node-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.72rem;
        text-transform: capitalize;
        color: var(--muted);
      }

      .pipeline-node-title {
        margin: 2px 0 0;
        font-size: 0.98rem;
        letter-spacing: -0.01em;
        color: var(--text);
      }

      .pipeline-node-detail {
        margin: 0;
        color: var(--subtle);
        font-size: 0.8rem;
        line-height: 1.45;
      }

      .pipeline-node-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }

      .pipeline-pill {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--subtle);
        font-size: 0.7rem;
        white-space: nowrap;
      }

      .pipeline-pill.command {
        max-width: 100%;
        border: 1px solid rgba(122, 184, 255, 0.32);
        background: rgba(122, 184, 255, 0.14);
        color: #dceeff;
        font-family: "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .pipeline-node-output {
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 6px;
      }

      .pipeline-node-output li {
        padding: 7px 10px;
        border-radius: 10px;
        border: 1px solid rgba(232, 236, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        color: var(--muted);
        font-size: 0.76rem;
        line-height: 1.45;
        word-break: break-word;
      }

      .indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex: 0 0 auto;
      }

      .indicator.idle {
        background: rgba(139, 144, 171, 0.72);
      }

      .indicator.completed {
        background: var(--success);
        box-shadow: 0 0 0 4px rgba(98, 217, 139, 0.24);
      }

      .indicator.failed {
        background: var(--failed);
        box-shadow: 0 0 0 4px rgba(255, 127, 139, 0.24);
      }

      .indicator.skipped {
        background: var(--skipped);
        box-shadow: 0 0 0 4px rgba(255, 209, 102, 0.22);
      }

      .indicator.running {
        background: transparent;
        border: 2px solid rgba(122, 184, 255, 0.24);
        border-top-color: var(--running);
        animation: spin 0.9s linear infinite;
      }

      .indicator.stopping {
        background: transparent;
        border: 2px solid rgba(255, 209, 102, 0.24);
        border-top-color: var(--skipped);
        animation: spin 0.9s linear infinite;
      }

      .side-column {
        display: grid;
        gap: 20px;
      }

      .summary-grid {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }

      .summary-item {
        padding: 14px 15px;
        border-radius: 18px;
        border: 1px solid rgba(232, 236, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
      }

      .summary-item strong {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.74rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .summary-item span {
        color: var(--text);
        line-height: 1.5;
        word-break: break-word;
      }

      pre {
        margin: 18px 0 0;
        padding: 16px;
        overflow: auto;
        border-radius: 20px;
        border: 1px solid rgba(232, 236, 255, 0.16);
        background: rgba(27, 22, 45, 0.84);
        color: #e0ebff;
        font-size: 0.8rem;
        line-height: 1.6;
      }

      .event-list {
        display: grid;
        gap: 12px;
        margin-top: 18px;
        max-height: 720px;
        overflow: auto;
        padding-right: 2px;
      }

      .event-card {
        padding: 14px 15px;
        border-radius: 18px;
        border: 1px solid rgba(232, 236, 255, 0.16);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.035)),
          rgba(31, 25, 48, 0.92);
      }

      .event-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
        color: var(--subtle);
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .event-message {
        color: #eef2ff;
        line-height: 1.6;
        font-size: 0.9rem;
      }

      .empty-state {
        padding: 18px;
        border-radius: 18px;
        border: 1px dashed rgba(191, 211, 235, 0.2);
        color: var(--subtle);
        background: rgba(255, 255, 255, 0.04);
      }

      .ticket-list {
        display: grid;
        gap: 10px;
        margin-top: 18px;
      }

      .ticket-item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 14px 15px;
        border-radius: 18px;
        border: 1px solid rgba(232, 236, 255, 0.16);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.035)),
          rgba(31, 25, 48, 0.92);
      }

      .ticket-item.running {
        border-color: rgba(122, 184, 255, 0.42);
        box-shadow: 0 0 0 1px rgba(122, 184, 255, 0.2);
      }

      .ticket-item.done {
        border-color: rgba(98, 217, 139, 0.34);
      }

      .ticket-item.failed {
        border-color: rgba(255, 127, 139, 0.34);
      }

      .ticket-icon {
        width: 24px;
        height: 24px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        font-size: 0.9rem;
        font-weight: 700;
      }

      .ticket-icon.queued {
        color: var(--subtle);
        background: rgba(255, 255, 255, 0.08);
      }

      .ticket-icon.done {
        color: #0d2818;
        background: var(--success);
      }

      .ticket-icon.failed {
        color: white;
        background: var(--failed);
      }

      .ticket-icon.running {
        background: rgba(122, 184, 255, 0.12);
      }

      .ticket-body {
        min-width: 0;
      }

      .ticket-line {
        display: flex;
        gap: 10px;
        align-items: baseline;
        flex-wrap: wrap;
      }

      .ticket-key {
        color: var(--text);
        font-weight: 700;
        text-decoration: none;
      }

      .ticket-key:hover {
        text-decoration: underline;
      }

      .ticket-summary {
        color: var(--muted);
        line-height: 1.5;
      }

      .ticket-detail {
        margin-top: 6px;
        color: var(--subtle);
        font-size: 0.84rem;
        line-height: 1.5;
      }

      .status-accent {
        color: white;
      }

      .status-accent.running {
        color: #b8ddff;
      }

      .status-accent.stopping {
        color: #ffe19b;
      }

      .status-accent.completed {
        color: #a6f0bf;
      }

      .status-accent.failed {
        color: #ffb6be;
      }

      .status-accent.idle {
        color: #d7dcf2;
      }

      .inline-note {
        margin-top: 12px;
        color: var(--subtle);
        line-height: 1.6;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 1220px) {
        .hero,
        .main-layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 960px) {
        .pipeline-lane-header {
          flex-direction: column;
          align-items: flex-start;
        }
      }

      @media (max-width: 720px) {
        .app-shell {
          padding: 18px 14px 28px;
        }

        .hero-card,
        .panel {
          padding: 18px;
          border-radius: 22px;
        }

        .pipeline-lane {
          padding: 16px;
          border-radius: 22px;
        }

        .pipeline-card {
          flex-basis: min(86vw, 292px);
        }

        .node-topline,
        .event-meta {
          align-items: flex-start;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <div class="grid-overlay" aria-hidden="true"></div>
    <div id="app"></div>

    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script type="text/babel">
      const { useEffect, useMemo, useState } = React;
      const SNAPSHOT_STORAGE_KEY = "codepipeline:lastSnapshot";
      const CONNECTION_STORAGE_KEY = "codepipeline:lastSyncAt";
      const QUEUE_STEP_ID = "fetch_ticket";
      const TICKET_PHASES = [
        {
          id: "intake",
          label: "Intake",
          description: "Safety checks and Jira bookkeeping before the ticket enters the workspace.",
          stepIds: ["evaluate_guardrails", "comment_start"]
        },
        {
          id: "prep",
          label: "Prep",
          description: "Set up the worktree and collect context before any code changes.",
          stepIds: ["prepare_repository", "document_context"]
        },
        {
          id: "execute",
          label: "Execute",
          description: "Implement the change, run browser-based comparison, review it, and validate until the branch is green.",
          stepIds: ["implement_changes", "visual_review", "review_implementation", "validation"]
        },
        {
          id: "publish",
          label: "Publish",
          description: "Commit the change, open the draft PR, and finalize the Jira ticket.",
          stepIds: ["commit_push", "create_pull_request", "finalize_jira"]
        }
      ];
      const STEP_META = {
        fetch_ticket: {
          scope: "queue",
          phase: "Queue setup",
          helper: "Loads all matching Jira tickets for the current run."
        },
        evaluate_guardrails: {
          scope: "ticket",
          phase: "Intake",
          helper: "Checks whether the current ticket is safe and specific enough to automate."
        },
        comment_start: {
          scope: "ticket",
          phase: "Intake",
          helper: "Reserved for early Jira commenting when the workflow needs it."
        },
        prepare_repository: {
          scope: "ticket",
          phase: "Prep",
          helper: "Creates the isolated git worktree and branch for the active ticket."
        },
        document_context: {
          scope: "ticket",
          phase: "Prep",
          helper: "Builds the ticket context markdown so implementation keeps the full Jira history in view."
        },
        implement_changes: {
          scope: "ticket",
          phase: "Execute",
          helper: "Applies coding passes from the documented ticket context, including any follow-up fixes from review."
        },
        visual_review: {
          scope: "ticket",
          phase: "Execute",
          helper: "Runs a headless browser comparison between the HTML example and the current implementation preview in an isolated process."
        },
        review_implementation: {
          scope: "ticket",
          phase: "Execute",
          helper: "Runs a review pass over the implementation and loops back with findings when needed."
        },
        validation: {
          scope: "ticket",
          phase: "Execute",
          helper: "Runs validation commands and the repair loop required to get the branch green."
        },
        commit_push: {
          scope: "ticket",
          phase: "Publish",
          helper: "Commits validated changes and pushes the branch or base target."
        },
        create_pull_request: {
          scope: "ticket",
          phase: "Publish",
          helper: "Opens the draft pull request when the workflow is using PR mode."
        },
        finalize_jira: {
          scope: "ticket",
          phase: "Publish",
          helper: "Writes the final Jira update, labels the ticket, and moves it forward when possible."
        }
      };

      function prettyStatus(value) {
        return value.replace(/_/g, " ").replace(/\\b\\w/g, function (match) {
          return match.toUpperCase();
        });
      }

      function formatTime(value) {
        if (!value) {
          return "Not available";
        }

        const date = new Date(value);
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(date);
      }

      function toneForEdge(current, next) {
        if (current === "failed" || next === "failed") {
          return "failed";
        }

        if (current === "running" || next === "running") {
          return "running";
        }

        if (current === "completed" && next === "completed") {
          return "completed";
        }

        if (current === "skipped" || next === "skipped") {
          return "skipped";
        }

        return "idle";
      }

      function getStepMeta(stepId) {
        return STEP_META[stepId] || {
          scope: "ticket",
          phase: "Pipeline",
          helper: "Waiting for this stage to begin."
        };
      }

      function buildSummaryFields(snapshot) {
        const result = snapshot.result;
        const doneTickets = snapshot.tickets.filter(function (ticket) {
          return ticket.status === "done";
        }).length;
        const failedTickets = snapshot.tickets.filter(function (ticket) {
          return ticket.status === "failed";
        }).length;
        return [
          ["Run", snapshot.runId > 0 ? "#" + snapshot.runId : "Not started"],
          ["Started", formatTime(snapshot.startedAt)],
          ["Finished", formatTime(snapshot.finishedAt)],
          ["Current Step", snapshot.currentStepId ? prettyStatus(snapshot.currentStepId) : "None"],
          ["Current Ticket", snapshot.currentTicketKey || (result && result.ticketKey ? result.ticketKey : "None")],
          ["Queue", snapshot.tickets.length ? doneTickets + " done / " + failedTickets + " failed / " + snapshot.tickets.length + " total" : "No tickets loaded"],
          ["Outcome", result ? prettyStatus(result.status) : prettyStatus(snapshot.status)],
          ["Branch", result && result.branchName ? result.branchName : "Not created"],
          ["Pull Request", result && result.pullRequestUrl ? result.pullRequestUrl : "Not created"]
        ];
      }

      function readCachedSnapshot() {
        try {
          const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
          return raw ? JSON.parse(raw) : null;
        } catch (_error) {
          return null;
        }
      }

      function writeCachedSnapshot(snapshot) {
        try {
          window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
          window.localStorage.setItem(CONNECTION_STORAGE_KEY, new Date().toISOString());
        } catch (_error) {
        }
      }

      function readLastSyncAt() {
        try {
          return window.localStorage.getItem(CONNECTION_STORAGE_KEY);
        } catch (_error) {
          return null;
        }
      }

      function describeConnectionState(connectionState) {
        if (connectionState === "offline") {
          return "Server offline";
        }

        if (connectionState === "reconnecting") {
          return "Reconnecting";
        }

        return "Live";
      }

      function App() {
        const [snapshot, setSnapshot] = useState(function () {
          return readCachedSnapshot() || {
            runId: 0,
            status: "idle",
            tickets: [],
            steps: [],
            logs: []
          };
        });
        const [loading, setLoading] = useState(true);
        const [connectionState, setConnectionState] = useState("reconnecting");
        const [lastSyncAt, setLastSyncAt] = useState(function () {
          return readLastSyncAt();
        });

        useEffect(function () {
          let active = true;
          let stream = null;
          let pollTimer = null;

          async function loadSnapshot(markConnection) {
            try {
              const response = await fetch("/api/run-state");
              if (!response.ok) {
                throw new Error("Snapshot request failed");
              }
              const data = await response.json();
              if (active) {
                setSnapshot(data);
                writeCachedSnapshot(data);
                setLastSyncAt(readLastSyncAt());
                if (markConnection) {
                  setConnectionState("connected");
                }
              }
              return true;
            } catch (_error) {
              if (active && markConnection) {
                setConnectionState("offline");
              }
              return false;
            } finally {
              if (active) {
                setLoading(false);
              }
            }
          }

          async function verifyConnection() {
            try {
              const response = await fetch("/health", { cache: "no-store" });
              if (!response.ok) {
                throw new Error("Health check failed");
              }

              if (!active) {
                return;
              }

              setConnectionState("connected");
              await loadSnapshot(false);
            } catch (_error) {
              if (active) {
                setConnectionState("offline");
              }
            }
          }

          loadSnapshot(true);

          stream = new EventSource("/api/run-events");
          stream.onmessage = function (event) {
            if (active) {
              const nextSnapshot = JSON.parse(event.data);
              setSnapshot(nextSnapshot);
              writeCachedSnapshot(nextSnapshot);
              setLastSyncAt(readLastSyncAt());
              setConnectionState("connected");
              setLoading(false);
            }
          };
          stream.onerror = function () {
            if (active) {
              setConnectionState("reconnecting");
            }
            verifyConnection();
          };

          pollTimer = window.setInterval(function () {
            verifyConnection();
          }, 4000);

          return function () {
            active = false;
            if (stream) {
              stream.close();
            }
            if (pollTimer) {
              window.clearInterval(pollTimer);
            }
          };
        }, []);

        async function startRun() {
          try {
            const response = await fetch("/api/run", { method: "POST" });
            if (response.status === 409) {
              const data = await response.json();
              window.alert(data.message || "A run is already in progress.");
              return;
            }

            if (!response.ok) {
              const data = await response.json().catch(function () {
                return {};
              });
              throw new Error(data.message || "Unable to start the worker.");
            }
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          }
        }

        async function stopRun() {
          try {
            const response = await fetch("/api/run/stop", { method: "POST" });
            if (response.status === 409) {
              const data = await response.json();
              window.alert(data.message || "No run is currently active.");
              return;
            }

            if (!response.ok) {
              const data = await response.json().catch(function () {
                return {};
              });
              throw new Error(data.message || "Unable to stop the worker.");
            }
          } catch (error) {
            window.alert(error instanceof Error ? error.message : String(error));
          }
        }

        const running = snapshot.status === "running" || snapshot.status === "stopping";
        const stopPending = snapshot.status === "stopping" || Boolean(snapshot.stopRequested);
        const summaryFields = useMemo(function () {
          return buildSummaryFields(snapshot);
        }, [snapshot]);
        const completedSteps = snapshot.steps.filter(function (step) {
          return step.status === "completed";
        }).length;

        return (
          <main className="app-shell">
            <section className="hero">
              <article className="hero-card">
                <div className="eyebrow">
                  <span className={"indicator " + snapshot.status}></span>
                  Live automation pipeline
                </div>
                <h1 className="headline">Code Pipeline.</h1>
                <p className="subhead">
                  Refresh without losing the visible job, track every stage as connected nodes, and let the dashboard tell you when the backend process is no longer reachable.
                </p>
                <div className="hero-actions">
                  <button className="start-button" onClick={startRun} disabled={running || loading || connectionState !== "connected"}>
                    {running ? "Queue Running" : "Start Queue"}
                  </button>
                  <button
                    className="start-button stop-button"
                    onClick={stopRun}
                    disabled={!running || loading || connectionState !== "connected" || stopPending}
                  >
                    {stopPending ? "Stopping..." : "Stop Queue"}
                  </button>
                  <div className="ghost-chip">
                    <span>Run State</span>
                    <strong className={"status-accent " + snapshot.status}>{prettyStatus(snapshot.status)}</strong>
                  </div>
                  <div className={"ghost-chip connection-chip " + connectionState}>
                    <span>Connection</span>
                    <strong>{describeConnectionState(connectionState)}</strong>
                  </div>
                  <div className="ghost-chip">
                    <span>Completed Nodes</span>
                    <strong>{completedSteps + "/" + snapshot.steps.length}</strong>
                  </div>
                </div>
                <div className="inline-note">
                  Refresh restores the last known pipeline snapshot immediately.
                  {connectionState === "offline" && lastSyncAt
                    ? " The server appears to be down, so the UI is showing the last sync from " + formatTime(lastSyncAt) + "."
                    : ""}
                </div>
              </article>

              <aside className="hero-side">
                <article className="panel stat-card">
                  <p className="stat-label">Current Focus</p>
                  <p className="stat-value">
                    {snapshot.currentTicketKey || (snapshot.currentStepId ? prettyStatus(snapshot.currentStepId) : prettyStatus(snapshot.status))}
                  </p>
                  <p className="stat-copy">
                    {connectionState === "offline"
                      ? "The UI cannot reach the backend process. If the job was killed in the terminal, this is the last known pipeline state."
                      : snapshot.status === "stopping"
                        ? "A stop request is in flight. The backend is interrupting active work and will stop before any further pipeline steps continue."
                        : snapshot.status === "running"
                          ? "The active ticket and its current pipeline node update automatically while the queue advances."
                        : "Nothing runs automatically. A new execution begins only when you start the queue."}
                  </p>
                </article>

                <article className="panel stat-card">
                  <p className="stat-label">Latest Result</p>
                  <p className="stat-value">{snapshot.result ? prettyStatus(snapshot.result.status) : "Waiting"}</p>
                  <p className="stat-copy">
                    {snapshot.result ? snapshot.result.message : "Run results, ticket metadata, and PR details appear here after execution."}
                  </p>
                </article>
              </aside>
            </section>

            <section className="main-layout">
              <article className="panel pipeline-panel">
                <h2 className="panel-title">Pipeline Graph</h2>
                <p className="panel-copy">
                  Queue bootstrap runs once per execution. Every matched ticket then flows through Intake → Prep → Execute → Publish, with each node's status streaming in live.
                </p>
                <PipelineCanvas steps={snapshot.steps} />
              </article>

              <section className="side-column">
                <article className="panel">
                  <h2 className="panel-title">Ticket Queue</h2>
                  <p className="panel-copy">
                    Matching Jira tickets run one after another. Success marks a ticket done, failures stay visible, and the queue continues.
                  </p>
                  <TicketQueue tickets={snapshot.tickets} />
                </article>

                <article className="panel">
                  <h2 className="panel-title">Run Summary</h2>
                  <p className="panel-copy">
                    {snapshot.result
                      ? snapshot.result.message
                      : snapshot.status === "running"
                        ? "Execution is in progress."
                        : "No execution has started yet."}
                  </p>
                  <div className="summary-grid">
                    {summaryFields.map(function (field) {
                      return (
                        <div className="summary-item" key={field[0]}>
                          <strong>{field[0]}</strong>
                          <span>{field[1] || "None"}</span>
                        </div>
                      );
                    })}
                  </div>
                  {snapshot.result ? <pre>{JSON.stringify(snapshot.result, null, 2)}</pre> : null}
                </article>

                <article className="panel">
                  <h2 className="panel-title">Live Events</h2>
                  <p className="panel-copy">
                    Step transitions, worker decisions, and completion messages appear here in reverse chronological order.
                  </p>
                  <EventFeed logs={snapshot.logs} />
                </article>
              </section>
            </section>
          </main>
        );
      }

      function ConnectorArrow(props) {
        return (
          <div className={"pipeline-connector " + (props.tone || "idle")} aria-hidden="true">
            <svg width="30" height="18" viewBox="0 0 30 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M0 9 L24 9" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <path d="M19 3 L27 9 L19 15" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );
      }

      function PipelineNode(props) {
        const step = props.step;
        const meta = getStepMeta(step.id);
        const indexLabel = String(props.index).padStart(2, "0");
        const className =
          "pipeline-node " +
          step.status +
          (step.status === "running" ? " active" : "") +
          (props.runsOnce ? " runs-once" : "");

        return (
          <article className={className}>
            <div className="pipeline-node-head">
              <div className="pipeline-node-tag">
                <span className="node-index">{indexLabel}</span>
                <span>{meta.phase}</span>
              </div>
              <div className="pipeline-node-status">
                <span className={"indicator " + step.status}></span>
                <span>{prettyStatus(step.status)}</span>
              </div>
            </div>
            <h4 className="pipeline-node-title">{step.label}</h4>
            <p className="pipeline-node-detail">{step.detail || meta.helper}</p>
            {(step.startedAt || step.finishedAt || step.currentCommand) ? (
              <div className="pipeline-node-pills">
                {step.startedAt ? <span className="pipeline-pill">Started {formatTime(step.startedAt)}</span> : null}
                {step.finishedAt ? <span className="pipeline-pill">Finished {formatTime(step.finishedAt)}</span> : null}
                {step.currentCommand ? <span className="pipeline-pill command">{step.currentCommand}</span> : null}
              </div>
            ) : null}
            {step.output && step.output.length ? (
              <ul className="pipeline-node-output">
                {step.output.slice(0, 2).map(function (line, outputIndex) {
                  return <li key={step.id + "-output-" + outputIndex}>{line}</li>;
                })}
              </ul>
            ) : null}
          </article>
        );
      }

      function PipelineCanvas(props) {
        const stepsById = useMemo(function () {
          const map = {};
          props.steps.forEach(function (step) {
            map[step.id] = step;
          });
          return map;
        }, [props.steps]);

        const queueStep = stepsById[QUEUE_STEP_ID];
        const phaseRows = TICKET_PHASES
          .map(function (phase) {
            return {
              ...phase,
              steps: phase.stepIds
                .map(function (id) { return stepsById[id]; })
                .filter(Boolean)
            };
          })
          .filter(function (row) { return row.steps.length > 0; });

        let globalIndex = queueStep ? 1 : 0;

        return (
          <div className="pipeline-wrap">
            {queueStep ? (
              <section className="pipeline-stage">
                <div className="pipeline-stage-head">
                  <span className="pipeline-stage-badge queue">Queue Bootstrap</span>
                  <span className="pipeline-stage-note">Runs once per execution, before any ticket work begins.</span>
                </div>
                <div className="pipeline-row">
                  <PipelineNode step={queueStep} runsOnce index={1} />
                </div>
              </section>
            ) : null}

            {queueStep && phaseRows.length ? (
              <div className="pipeline-flow-divider">
                <span className="divider-chevron">▼</span>
                <span>for each ticket</span>
                <span className="divider-rule"></span>
              </div>
            ) : null}

            {phaseRows.length ? (
              <section className="pipeline-loop">
                <div className="pipeline-loop-head">
                  <span className="pipeline-stage-badge ticket">Per-Ticket Loop</span>
                  <span className="pipeline-stage-note">Every ticket in the queue flows through these phases top to bottom.</span>
                  <span className="pipeline-loop-meta">↻ loop</span>
                </div>
                <div className="pipeline-phases">
                  {phaseRows.map(function (row, rowIndex) {
                    return (
                      <div className="pipeline-phase-row" key={row.id}>
                        <div className="pipeline-phase-label">
                          <span className="phase-index">{String(rowIndex + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{row.label}</strong>
                            <span>{row.description}</span>
                          </div>
                        </div>
                        <div className="pipeline-phase-nodes">
                          {row.steps.map(function (step, idx) {
                            globalIndex += 1;
                            const nodeIndex = globalIndex;
                            return (
                              <React.Fragment key={step.id}>
                                <PipelineNode step={step} index={nodeIndex} />
                                {idx < row.steps.length - 1 ? (
                                  <ConnectorArrow tone={toneForEdge(step.status, row.steps[idx + 1].status)} />
                                ) : null}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </div>
        );
      }

      function EventFeed(props) {
        if (!props.logs.length) {
          return <div className="empty-state">No events yet.</div>;
        }

        return (
          <div className="event-list">
            {props.logs.slice().reverse().map(function (entry, index) {
              return (
                <div className="event-card" key={entry.timestamp + "-" + index}>
                  <div className="event-meta">
                    <span>{entry.stepId ? prettyStatus(entry.stepId) : "System"}</span>
                    <span>{formatTime(entry.timestamp)}</span>
                  </div>
                  <div className="event-message">{entry.message}</div>
                </div>
              );
            })}
          </div>
        );
      }

      function TicketQueue(props) {
        if (!props.tickets.length) {
          return <div className="empty-state">No tickets loaded yet.</div>;
        }

        return (
          <div className="ticket-list">
            {props.tickets.map(function (ticket) {
              return (
                <div className={"ticket-item " + ticket.status} key={ticket.key}>
                  <div className={"ticket-icon " + ticket.status}>
                    {ticket.status === "done"
                      ? "✓"
                      : ticket.status === "failed"
                        ? "×"
                        : ticket.status === "running"
                          ? <span className="indicator running"></span>
                          : "·"}
                  </div>
                  <div className="ticket-body">
                    <div className="ticket-line">
                      <a className="ticket-key" href={ticket.url} target="_blank" rel="noreferrer">
                        {ticket.key}
                      </a>
                      <span className="ticket-summary">{ticket.summary}</span>
                    </div>
                    <div className="ticket-detail">
                      {ticket.detail || prettyStatus(ticket.status)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      const root = ReactDOM.createRoot(document.getElementById("app"));
      root.render(<App />);
    </script>
  </body>
</html>`;
}
