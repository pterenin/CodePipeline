import {
  type JiraTicket,
  type TicketQueueItem,
  WORKFLOW_STEP_DEFINITIONS,
  type WorkerRunResult,
  type WorkerRunSnapshot,
  type WorkflowStepId,
  type WorkflowStepState
} from "./types.js";

type SnapshotListener = (snapshot: WorkerRunSnapshot) => void;

export class RunMonitor {
  private readonly listeners = new Set<SnapshotListener>();
  private runId = 0;
  private snapshot: WorkerRunSnapshot = this.createIdleSnapshot();

  getSnapshot(): WorkerRunSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  startRun(): void {
    this.runId += 1;
    this.snapshot = {
      runId: this.runId,
      status: "running",
      stopRequested: false,
      startedAt: new Date().toISOString(),
      tickets: [],
      steps: createInitialSteps(),
      logs: []
    };
    this.emit();
  }

  setTickets(tickets: JiraTicket[]): void {
    this.snapshot.tickets = tickets.map((ticket) => ({
      key: ticket.key,
      summary: ticket.summary,
      url: ticket.url,
      status: "queued"
    }));
    this.emit();
  }

  startTicket(ticketKey: string, detail?: string): void {
    const fetchStep = this.snapshot.steps.find((step) => step.id === "fetch_ticket");
    this.snapshot.steps = createInitialSteps().map((step) =>
      step.id === "fetch_ticket" && fetchStep ? { ...fetchStep } : step
    );
    this.snapshot.currentStepId = undefined;
    this.snapshot.currentTicketKey = ticketKey;
    this.snapshot.tickets = this.snapshot.tickets.map((ticket) =>
      ticket.key === ticketKey
        ? {
            ...ticket,
            status: "running",
            ...(detail ? { detail } : {})
          }
        : ticket
    );
    this.emit();
  }

  finishTicket(ticketKey: string, status: TicketQueueItem["status"], detail?: string): void {
    this.snapshot.tickets = this.snapshot.tickets.map((ticket) =>
      ticket.key === ticketKey
        ? {
            ...ticket,
            status,
            ...(detail ? { detail } : {})
          }
        : ticket
    );

    if (this.snapshot.currentTicketKey === ticketKey) {
      this.snapshot.currentTicketKey = undefined;
    }

    this.emit();
  }

  log(message: string, stepId?: WorkflowStepId): void {
    this.snapshot.logs = [
      ...this.snapshot.logs,
      {
        timestamp: new Date().toISOString(),
        message,
        stepId
      }
    ];
    this.emit();
  }

  startStep(stepId: WorkflowStepId, detail?: string): void {
    this.updateStep(stepId, (step) => ({
      ...step,
      status: "running",
      detail: detail ?? step.detail,
      currentCommand: undefined,
      startedAt: step.startedAt ?? new Date().toISOString()
    }));
    this.snapshot.currentStepId = stepId;
    this.emit();
  }

  setStepDetail(stepId: WorkflowStepId, detail: string): void {
    this.updateStep(stepId, (step) => ({
      ...step,
      detail
    }));
    this.emit();
  }

  setStepCurrentCommand(stepId: WorkflowStepId, command?: string): void {
    this.updateStep(stepId, (step) => ({
      ...step,
      currentCommand: command
    }));
    this.emit();
  }

  completeStep(stepId: WorkflowStepId, detail?: string, output?: string[]): void {
    this.finalizeStep(stepId, "completed", detail, output);
  }

  failStep(stepId: WorkflowStepId, detail?: string, output?: string[]): void {
    this.finalizeStep(stepId, "failed", detail, output);
  }

  skipStep(stepId: WorkflowStepId, detail?: string, output?: string[]): void {
    this.finalizeStep(stepId, "skipped", detail, output);
  }

  failCurrentStep(detail: string): void {
    if (!this.snapshot.currentStepId) {
      this.log(detail);
      return;
    }

    this.failStep(this.snapshot.currentStepId, detail);
  }

  finishRun(result: WorkerRunResult): void {
    this.snapshot.status = result.status === "stopped" || result.ok ? "completed" : "failed";
    this.snapshot.finishedAt = new Date().toISOString();
    this.snapshot.stopRequested = false;
    this.snapshot.currentStepId = undefined;
    this.snapshot.currentTicketKey = undefined;
    this.snapshot.result = result;
    this.emit();
  }

  markStopRequested(detail?: string): void {
    this.snapshot.stopRequested = true;
    this.snapshot.status = "stopping";

    if (detail) {
      this.log(detail);
      return;
    }

    this.emit();
  }

  private finalizeStep(
    stepId: WorkflowStepId,
    status: WorkflowStepState["status"],
    detail?: string,
    output?: string[]
  ): void {
    this.updateStep(stepId, (step) => ({
      ...step,
      status,
      detail: detail ?? step.detail,
      currentCommand: undefined,
      output: output ?? step.output,
      startedAt: step.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString()
    }));

    if (this.snapshot.currentStepId === stepId) {
      this.snapshot.currentStepId = undefined;
    }

    this.emit();
  }

  private updateStep(
    stepId: WorkflowStepId,
    updater: (step: WorkflowStepState) => WorkflowStepState
  ): void {
    this.snapshot.steps = this.snapshot.steps.map((step) =>
      step.id === stepId ? updater(step) : step
    );
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.getSnapshot());
    }
  }

  private createIdleSnapshot(): WorkerRunSnapshot {
    return {
      runId: 0,
      status: "idle",
      stopRequested: false,
      tickets: [],
      steps: createInitialSteps(),
      logs: []
    };
  }
}

function createInitialSteps(): WorkflowStepState[] {
  return WORKFLOW_STEP_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    status: "idle",
    output: []
  }));
}

function cloneSnapshot(snapshot: WorkerRunSnapshot): WorkerRunSnapshot {
  const result = snapshot.result
    ? {
        ...snapshot.result,
        ...(snapshot.result.validation
          ? {
              validation: {
                ...snapshot.result.validation,
                steps: snapshot.result.validation.steps.map((step) => ({ ...step }))
              }
            }
          : {})
      }
    : undefined;

  return {
    ...snapshot,
    tickets: snapshot.tickets.map((ticket) => ({ ...ticket })),
    steps: snapshot.steps.map((step) => ({
      ...step,
      output: [...step.output]
    })),
    logs: snapshot.logs.map((entry) => ({ ...entry })),
    result
  };
}
