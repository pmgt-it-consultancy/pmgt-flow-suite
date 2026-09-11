export type BusinessCommand = {
  kind: string;
  aggregateId: string;
  [key: string]: unknown;
};

export type JournalState =
  | "pending"
  | "projected"
  | "sending"
  | "accepted"
  | "observed"
  | "attention_required";

export type JournalEntry = {
  operationId: string;
  schemaVersion: 1;
  storeId: string;
  deviceId: string;
  command: BusinessCommand;
  state: JournalState;
  createdAt: number;
  updatedAt: number;
  error?: string;
};
