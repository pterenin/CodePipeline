export function renderAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CodePipeline</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef3f8;
        --bg-accent: radial-gradient(circle at top left, rgba(28, 126, 214, 0.14), transparent 28%),
          radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 24%), #eef3f8;
        --panel: rgba(255, 255, 255, 0.88);
        --panel-strong: #ffffff;
        --line: rgba(72, 98, 125, 0.2);
        --text: #17324d;
        --muted: #5f7288;
        --running: #1d4ed8;
        --success: #0f9f6e;
        --failed: #c2410c;
        --skipped: #9a6700;
        --idle: #8a94a6;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        background: var(--bg-accent);
        color: var(--text);
      }

      .shell {
        max-width: 1400px;
        margin: 0 auto;
        padding: 32px 20px 48px;
      }

      .topbar {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: center;
        margin-bottom: 24px;
      }

      .headline {
        margin: 0;
        font-size: clamp(2rem, 3vw, 3.2rem);
        line-height: 1;
        letter-spacing: -0.05em;
      }

      .subhead {
        margin: 10px 0 0;
        color: var(--muted);
        max-width: 720px;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }

      .status-pill {
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.7);
        font-size: 0.94rem;
        color: var(--muted);
      }

      .status-pill strong {
        color: var(--text);
      }

      .start-button {
        border: 0;
        border-radius: 16px;
        padding: 14px 22px;
        font: inherit;
        font-weight: 700;
        color: white;
        background: linear-gradient(135deg, #1d4ed8, #0f766e);
        box-shadow: 0 16px 30px rgba(29, 78, 216, 0.25);
        cursor: pointer;
        transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
      }

      .start-button:hover:enabled {
        transform: translateY(-1px);
        box-shadow: 0 20px 38px rgba(29, 78, 216, 0.28);
      }

      .start-button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
        box-shadow: none;
      }

      .layout {
        display: grid;
        gap: 20px;
        grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
      }

      .panel {
        background: var(--panel);
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 28px;
        backdrop-filter: blur(18px);
        box-shadow: 0 24px 60px rgba(54, 78, 102, 0.12);
      }

      .workflow-panel {
        padding: 24px;
      }

      .panel-title {
        margin: 0 0 6px;
        font-size: 1.15rem;
      }

      .panel-copy {
        margin: 0 0 20px;
        color: var(--muted);
      }

      .workflow-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px;
      }

      .node {
        position: relative;
        min-height: 176px;
        padding: 18px;
        border-radius: 22px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 252, 0.96));
        border: 1px solid rgba(118, 141, 167, 0.18);
        overflow: hidden;
      }

      .node::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 6px;
        background: var(--idle);
      }

      .node.running::before { background: var(--running); }
      .node.completed::before { background: var(--success); }
      .node.failed::before { background: var(--failed); }
      .node.skipped::before { background: var(--skipped); }

      .node-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }

      .node-title {
        margin: 0;
        font-size: 1rem;
      }

      .node-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 0.82rem;
        text-transform: capitalize;
      }

      .node-detail {
        margin: 14px 0 0;
        color: var(--text);
        font-size: 0.92rem;
        line-height: 1.5;
      }

      .node-output {
        margin: 14px 0 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 8px;
      }

      .node-output li {
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(228, 236, 245, 0.65);
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.45;
        word-break: break-word;
      }

      .indicator {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex: 0 0 auto;
      }

      .indicator.idle { background: rgba(138, 148, 166, 0.5); }
      .indicator.completed { background: var(--success); }
      .indicator.failed { background: var(--failed); }
      .indicator.skipped { background: var(--skipped); }
      .indicator.running {
        border: 2px solid rgba(29, 78, 216, 0.22);
        border-top-color: var(--running);
        background: transparent;
        animation: spin 0.9s linear infinite;
      }

      .side-panel {
        display: grid;
        gap: 20px;
      }

      .summary-panel,
      .logs-panel {
        padding: 22px;
      }

      .key-value {
        display: grid;
        gap: 12px;
        margin-top: 18px;
      }

      .key-value div {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(244, 248, 252, 0.95);
        border: 1px solid rgba(118, 141, 167, 0.15);
      }

      .key-value strong {
        display: block;
        margin-bottom: 6px;
        font-size: 0.8rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--muted);
      }

      pre {
        margin: 14px 0 0;
        padding: 16px;
        overflow: auto;
        border-radius: 18px;
        background: #15293d;
        color: #d8e6f5;
        font-size: 0.83rem;
        line-height: 1.55;
      }

      .log-list {
        display: grid;
        gap: 10px;
        margin-top: 16px;
        max-height: 420px;
        overflow: auto;
      }

      .log-entry {
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(244, 248, 252, 0.95);
        border: 1px solid rgba(118, 141, 167, 0.15);
      }

      .log-meta {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        font-size: 0.76rem;
        color: var(--muted);
        margin-bottom: 6px;
      }

      .empty {
        color: var(--muted);
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      @media (max-width: 1060px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 760px) {
        .shell {
          padding: 20px 14px 32px;
        }

        .topbar {
          align-items: flex-start;
          flex-direction: column;
        }

        .workflow-panel,
        .summary-panel,
        .logs-panel {
          padding: 18px;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="topbar">
        <div>
          <h1 class="headline">CodePipeline</h1>
          <p class="subhead">Start a run manually, watch the workflow move node by node, and inspect outputs as each stage completes.</p>
        </div>
        <div class="controls">
          <div class="status-pill" id="runStatus">Run state: <strong>Idle</strong></div>
          <button class="start-button" id="startButton">Start</button>
        </div>
      </section>

      <section class="layout">
        <article class="panel workflow-panel">
          <h2 class="panel-title">Workflow</h2>
          <p class="panel-copy">Nothing runs automatically. A new execution begins only when you press Start.</p>
          <div class="workflow-grid" id="workflowGrid"></div>
        </article>

        <section class="side-panel">
          <article class="panel summary-panel">
            <h2 class="panel-title">Run Summary</h2>
            <p class="panel-copy" id="summaryCopy">No execution has started yet.</p>
            <div class="key-value" id="summaryMeta"></div>
            <pre id="resultJson" hidden></pre>
          </article>

          <article class="panel logs-panel">
            <h2 class="panel-title">Live Events</h2>
            <p class="panel-copy">Step transitions and key results appear here as the worker runs.</p>
            <div class="log-list" id="logList"></div>
          </article>
        </section>
      </section>
    </main>

    <script>
      const startButton = document.getElementById("startButton");
      const runStatus = document.getElementById("runStatus");
      const workflowGrid = document.getElementById("workflowGrid");
      const summaryCopy = document.getElementById("summaryCopy");
      const summaryMeta = document.getElementById("summaryMeta");
      const resultJson = document.getElementById("resultJson");
      const logList = document.getElementById("logList");

      let snapshot = null;

      function prettyStatus(value) {
        return value.replace(/_/g, " ").replace(/\\b\\w/g, (match) => match.toUpperCase());
      }

      function render(nextSnapshot) {
        snapshot = nextSnapshot;
        const running = snapshot.status === "running";

        runStatus.innerHTML = "Run state: <strong>" + prettyStatus(snapshot.status) + "</strong>";
        startButton.disabled = running;

        workflowGrid.replaceChildren(...snapshot.steps.map(renderNode));
        renderSummary(snapshot);
        renderLogs(snapshot.logs);
      }

      function renderNode(step) {
        const node = document.createElement("article");
        node.className = "node " + step.status;

        const header = document.createElement("div");
        header.className = "node-header";

        const title = document.createElement("h3");
        title.className = "node-title";
        title.textContent = step.label;

        const status = document.createElement("div");
        status.className = "node-status";

        const indicator = document.createElement("span");
        indicator.className = "indicator " + step.status;

        const statusText = document.createElement("span");
        statusText.textContent = prettyStatus(step.status);

        status.append(indicator, statusText);
        header.append(title, status);
        node.append(header);

        const detail = document.createElement("p");
        detail.className = "node-detail";
        detail.textContent = step.detail || "Waiting for this part of the workflow.";
        node.append(detail);

        if (step.output.length > 0) {
          const output = document.createElement("ul");
          output.className = "node-output";

          for (const line of step.output) {
            const item = document.createElement("li");
            item.textContent = line;
            output.append(item);
          }

          node.append(output);
        }

        return node;
      }

      function renderSummary(snapshot) {
        summaryMeta.replaceChildren();

        const result = snapshot.result;
        if (!result) {
          summaryCopy.textContent = snapshot.status === "running"
            ? "Execution is in progress."
            : "No execution has started yet.";
          resultJson.hidden = true;
          resultJson.textContent = "";
        } else {
          summaryCopy.textContent = result.message || "Execution finished.";
          resultJson.hidden = false;
          resultJson.textContent = JSON.stringify(result, null, 2);
        }

        const fields = [
          ["Run", snapshot.runId > 0 ? "#" + snapshot.runId : "Not started"],
          ["Started", formatTime(snapshot.startedAt)],
          ["Finished", formatTime(snapshot.finishedAt)],
          ["Current step", snapshot.currentStepId ? prettyStatus(snapshot.currentStepId) : "None"],
          ["Ticket", result && result.ticketKey ? result.ticketKey : "None"],
          ["Outcome", result ? prettyStatus(result.status) : prettyStatus(snapshot.status)]
        ];

        for (const [label, value] of fields) {
          const wrapper = document.createElement("div");
          const key = document.createElement("strong");
          key.textContent = label;
          const val = document.createElement("span");
          val.textContent = value || "None";
          wrapper.append(key, val);
          summaryMeta.append(wrapper);
        }
      }

      function renderLogs(logs) {
        if (logs.length === 0) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "No events yet.";
          logList.replaceChildren(empty);
          return;
        }

        const entries = logs.slice().reverse().map((entry) => {
          const card = document.createElement("div");
          card.className = "log-entry";

          const meta = document.createElement("div");
          meta.className = "log-meta";

          const step = document.createElement("span");
          step.textContent = entry.stepId ? prettyStatus(entry.stepId) : "System";

          const time = document.createElement("span");
          time.textContent = formatTime(entry.timestamp);

          meta.append(step, time);

          const message = document.createElement("div");
          message.textContent = entry.message;

          card.append(meta, message);
          return card;
        });

        logList.replaceChildren(...entries);
      }

      function formatTime(value) {
        if (!value) {
          return "Not available";
        }

        const date = new Date(value);
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "medium"
        }).format(date);
      }

      async function loadSnapshot() {
        const response = await fetch("/api/run-state");
        const data = await response.json();
        render(data);
      }

      async function startRun() {
        startButton.disabled = true;
        try {
          const response = await fetch("/api/run", { method: "POST" });
          if (response.status === 409) {
            const data = await response.json();
            window.alert(data.message || "A run is already in progress.");
            return;
          }

          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "Unable to start the worker.");
          }
        } catch (error) {
          window.alert(error instanceof Error ? error.message : String(error));
        } finally {
          startButton.disabled = snapshot && snapshot.status === "running";
        }
      }

      startButton.addEventListener("click", startRun);

      const stream = new EventSource("/api/run-events");
      stream.onmessage = (event) => {
        render(JSON.parse(event.data));
      };
      stream.onerror = () => {
        void loadSnapshot();
      };

      void loadSnapshot();
    </script>
  </body>
</html>`;
}
