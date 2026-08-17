/**
 * Script manifest and registry types
 */

import type { AdapterPool } from '../adapters/adapter-pool.js';

export interface ParamSchema {
  [paramName: string]: string;
}

export interface ScriptManifest {
  name: string;
  description: string;

  params: ParamSchema;

  preconditions: string[];
  postconditions: string[];

  failureModes: string[];

  category:
    | "observation"
    | "movement"
    | "banking"
    | "inventory"
    | "equipment"
    | "shopping"
    | "recovery"
    | "gathering"
    | "combat"
    | "interaction"
    | "progression";

  verified: boolean;

  version: number;
}

export type ScriptHandler = (
  params: Record<string, unknown>,
  context: ScriptContext
) => Promise<ScriptResult>;

export interface ScriptContext {
  accountId: string;

  sdkBaseUrl: string;

  sdkBotName: string;

  sdkBotPassword: string;

  /**
   * Optional shared RS-SDK adapter.
   *
   * GatheringCore supplies this so preparation, movement,
   * banking and gathering all reuse the same live controller.
   */
  adapter?: unknown;

  /**
   * Optional shared adapter pool.
   *
   * When supplied, scripts should obtain their adapter via
   * `pool.getAdapter(accountId)` rather than creating a fresh one.
   * The `createRsSdkAdapter` factory honours this automatically.
   */
  adapterPool?: AdapterPool;

  /**
   * Optional abort signal used to cancel a long-running script.
   */
  cancelSignal?: AbortSignal;
}

export interface ScriptResult {
  success: boolean;

  message: string;

  data?: Record<string, unknown>;
}
