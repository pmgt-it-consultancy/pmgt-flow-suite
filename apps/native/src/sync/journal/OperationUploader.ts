import type { OperationJournal } from "./OperationJournal";

type UploadResult = {
  operationId: string;
  status: "accepted" | "rejected";
  error?: string;
};

export class OperationUploader {
  private inFlight: Promise<number> | null = null;

  constructor(
    private readonly options: {
      journal: OperationJournal;
      uploadCommands: (
        commands: Array<{
          operationId: string;
          schemaVersion: number;
          command: Record<string, unknown>;
        }>,
      ) => Promise<{ results: UploadResult[] }>;
      batchSize?: number;
    },
  ) {}

  uploadOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    const run = this.runUpload();
    this.inFlight = run;
    void run
      .finally(() => {
        if (this.inFlight === run) this.inFlight = null;
      })
      .catch(() => undefined);
    return run;
  }

  private async runUpload(): Promise<number> {
    const batch = await this.options.journal.nextUploadBatch(this.options.batchSize ?? 25);
    if (batch.length === 0) return 0;
    await this.options.journal.markSending(batch.map((entry) => entry.operationId));
    const commands = batch.map((entry) => ({
      operationId: entry.operationId,
      schemaVersion: entry.schemaVersion,
      command: entry.command,
    }));
    const response = await this.options.uploadCommands(commands);
    for (const result of response.results) {
      if (result.status === "accepted") {
        await this.options.journal.markAccepted(result.operationId);
      } else {
        await this.options.journal.requireAttention(
          result.operationId,
          result.error ?? "Command rejected",
        );
      }
    }
    return response.results.length;
  }
}
