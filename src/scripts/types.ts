/**
 * Script manifest and registry types
 */

export interface ParamSchema {
  [paramName: string]: string; // type description e.g. "string", "number"
}

export interface ScriptManifest {
  name: string;
  description: string;
  params: ParamSchema;
  preconditions: string[];
  postconditions: string[];
  verified: boolean;
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
}

export interface ScriptResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}
