import {
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
      startedAt: new Date().toISOString(),
      steps: createInitialSteps(),
      logs: []
    };
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
      startedAt: step.startedAt ?? new Date().toISOString()
    }));
    this.snapshot.currentStepId = stepId;
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
    this.snapshot.status = result.ok ? "completed" : "failed";
    this.snapshot.finishedAt = new Date().toISOString();
    this.snapshot.currentStepId = undefined;
    this.snapshot.result = result;
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
      output: output ?? step.output,
      startedAt: step.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString()
    }));

    if (this.snapshot.currentStepId === stepId) {
      this.snapshot.currentStepId = undefined;
    }

    this.emit();
  }

  private updateStep(stepId: WorkflowStepId, updater: (step: WorkflowStepState) => WorkflowStepState): void {
    this.snapshot.steps = this.snapshot.steps.map((step) => (step.id === stepId ? updater(step) : step));
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
    steps: snapshot.steps.map((step) => ({
      ...step,
      output: [...step.output]
    })),
    logs: snapshot.logs.map((entry) => ({ ...entry })),
    result
  };
}
