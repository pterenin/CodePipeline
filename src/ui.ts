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
        position: relative;
        margin-top: 22px;
        padding: 12px 6px 8px;
      }

      .pipeline-svg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }

      .pipeline-grid {
        position: relative;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }

      .pipeline-node {
        position: relative;
        min-height: 198px;
        padding: 18px;
        border-radius: 24px;
        border: 1px solid rgba(232, 236, 255, 0.22);
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%),
          rgba(42, 36, 62, 0.94);
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.12),
          0 18px 36px rgba(8, 7, 20, 0.2);
      }

      .pipeline-node.active {
        border-color: rgba(122, 184, 255, 0.62);
        box-shadow:
          0 0 0 1px rgba(122, 184, 255, 0.28),
          0 0 0 6px rgba(122, 184, 255, 0.08),
          0 24px 46px rgba(12, 10, 28, 0.34);
      }

      .pipeline-node.completed {
        border-color: rgba(98, 217, 139, 0.52);
      }

      .pipeline-node.failed {
        border-color: rgba(255, 127, 139, 0.58);
      }

      .pipeline-node.skipped {
        border-color: rgba(255, 209, 102, 0.52);
      }

      .node-topline {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 18px;
      }

      .node-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.09);
        color: var(--muted);
        font-size: 0.76rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .node-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 0.8rem;
        text-transform: capitalize;
      }

      .node-title {
        margin: 0;
        font-size: 1.05rem;
        letter-spacing: -0.02em;
      }

      .node-detail {
        margin: 10px 0 0;
        color: #e2ebf8;
        line-height: 1.6;
        font-size: 0.94rem;
      }

      .node-times {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .time-pill,
      .output-pill {
        display: inline-flex;
        align-items: center;
        padding: 7px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        color: var(--subtle);
        font-size: 0.76rem;
      }

      .node-output {
        margin: 16px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 9px;
      }

      .node-output li {
        padding: 10px 12px;
        border-radius: 14px;
        border: 1px solid rgba(232, 236, 255, 0.18);
        background: rgba(255, 255, 255, 0.09);
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.55;
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

      .status-accent {
        color: white;
      }

      .status-accent.running {
        color: #b8ddff;
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
        .pipeline-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
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

        .pipeline-grid {
          grid-template-columns: 1fr;
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
      const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React;
      const SNAPSHOT_STORAGE_KEY = "codepipeline:lastSnapshot";
      const CONNECTION_STORAGE_KEY = "codepipeline:lastSyncAt";

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

      function toneForConnection(current, next) {
        if (current === "failed" || next === "failed") {
          return "#ff8f9b";
        }

        if (current === "running" || next === "running") {
          return "#9ad0ff";
        }

        if (current === "completed" && next === "completed") {
          return "#7be6a3";
        }

        if (current === "skipped" || next === "skipped") {
          return "#ffd978";
        }

        return "rgba(232, 236, 255, 0.4)";
      }

      function buildSummaryFields(snapshot) {
        const result = snapshot.result;
        return [
          ["Run", snapshot.runId > 0 ? "#" + snapshot.runId : "Not started"],
          ["Started", formatTime(snapshot.startedAt)],
          ["Finished", formatTime(snapshot.finishedAt)],
          ["Current Step", snapshot.currentStepId ? prettyStatus(snapshot.currentStepId) : "None"],
          ["Ticket", result && result.ticketKey ? result.ticketKey : "None"],
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

        const running = snapshot.status === "running";
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
                    {running ? "Pipeline Running" : "Start Pipeline"}
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
                    {snapshot.currentStepId ? prettyStatus(snapshot.currentStepId) : prettyStatus(snapshot.status)}
                  </p>
                  <p className="stat-copy">
                    {connectionState === "offline"
                      ? "The UI cannot reach the backend process. If the job was killed in the terminal, this is the last known pipeline state."
                      : snapshot.status === "running"
                        ? "The active node and the live event stream update automatically as the worker advances."
                        : "Nothing runs automatically. A new execution begins only when you start the pipeline."}
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
                  Every stage is rendered as a connected node so the execution path stays visually clear while details and outputs stream in.
                </p>
                <PipelineCanvas steps={snapshot.steps} />
              </article>

              <section className="side-column">
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

      function PipelineCanvas(props) {
        const containerRef = useRef(null);
        const nodeRefs = useRef({});
        const [lines, setLines] = useState([]);

        useLayoutEffect(function () {
          function recalculate() {
            const container = containerRef.current;
            if (!container || !props.steps.length) {
              setLines([]);
              return;
            }

            const containerRect = container.getBoundingClientRect();
            const nextLines = [];

            for (let index = 0; index < props.steps.length - 1; index += 1) {
              const current = nodeRefs.current[props.steps[index].id];
              const next = nodeRefs.current[props.steps[index + 1].id];

              if (!current || !next) {
                continue;
              }

              const startRect = current.getBoundingClientRect();
              const endRect = next.getBoundingClientRect();

              const startX = startRect.left - containerRect.left + startRect.width / 2;
              const startY = startRect.top - containerRect.top + startRect.height / 2;
              const endX = endRect.left - containerRect.left + endRect.width / 2;
              const endY = endRect.top - containerRect.top + endRect.height / 2;
              const curveOffset = Math.max(Math.abs(endX - startX) * 0.35, 40);

              nextLines.push({
                key: props.steps[index].id + "-" + props.steps[index + 1].id,
                color: toneForConnection(props.steps[index].status, props.steps[index + 1].status),
                active: props.steps[index].status === "running" || props.steps[index + 1].status === "running",
                path:
                  "M " +
                  startX +
                  " " +
                  startY +
                  " C " +
                  (startX + curveOffset) +
                  " " +
                  startY +
                  ", " +
                  (endX - curveOffset) +
                  " " +
                  endY +
                  ", " +
                  endX +
                  " " +
                  endY
              });
            }

            setLines(nextLines);
          }

          recalculate();
          window.addEventListener("resize", recalculate);

          let observer = null;
          if (typeof ResizeObserver !== "undefined" && containerRef.current) {
            observer = new ResizeObserver(recalculate);
            observer.observe(containerRef.current);
          }

          return function () {
            window.removeEventListener("resize", recalculate);
            if (observer) {
              observer.disconnect();
            }
          };
        }, [props.steps]);

        return (
          <div className="pipeline-wrap" ref={containerRef}>
            <svg className="pipeline-svg" aria-hidden="true">
              {lines.map(function (line) {
                return (
                  <g key={line.key}>
                    <path d={line.path} fill="none" stroke="rgba(244, 246, 255, 0.22)" strokeWidth="8" strokeLinecap="round" />
                    <path
                      d={line.path}
                      fill="none"
                      stroke={line.color}
                      strokeOpacity={line.active ? 0.98 : 0.74}
                      strokeWidth={line.active ? "3.8" : "2.8"}
                      strokeLinecap="round"
                      strokeDasharray={line.active ? "10 8" : "0"}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="pipeline-grid">
              {props.steps.map(function (step, index) {
                return (
                  <article
                    key={step.id}
                    ref={function (element) {
                      nodeRefs.current[step.id] = element;
                    }}
                    className={
                      "pipeline-node " +
                      step.status +
                      (step.status === "running" ? " active" : "")
                    }
                  >
                    <div className="node-topline">
                      <div className="node-badge">Node {String(index + 1).padStart(2, "0")}</div>
                      <div className="node-status">
                        <span className={"indicator " + step.status}></span>
                        <span>{prettyStatus(step.status)}</span>
                      </div>
                    </div>

                    <h3 className="node-title">{step.label}</h3>
                    <p className="node-detail">
                      {step.detail || "Waiting for this stage to begin."}
                    </p>

                    <div className="node-times">
                      {step.startedAt ? <span className="time-pill">Started {formatTime(step.startedAt)}</span> : null}
                      {step.finishedAt ? <span className="time-pill">Finished {formatTime(step.finishedAt)}</span> : null}
                      {step.output.length ? <span className="output-pill">{step.output.length} updates</span> : null}
                    </div>

                    {step.output.length ? (
                      <ul className="node-output">
                        {step.output.slice(0, 3).map(function (line, outputIndex) {
                          return <li key={step.id + "-output-" + outputIndex}>{line}</li>;
                        })}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
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

      const root = ReactDOM.createRoot(document.getElementById("app"));
      root.render(<App />);
    </script>
  </body>
</html>`;
}
