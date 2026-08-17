/**
 * Command queue type definitions
 */

export type CommandType =
  | 'travel'
  | 'gather'
  | 'generic';

export type CommandStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface Command {
  id: string;
  type: CommandType;
  params: Record<string, unknown>;
  createdAt: number;
  status: CommandStatus;
}

export interface QueueState {
  total: number;
  pending: number;
  running: number;
}
