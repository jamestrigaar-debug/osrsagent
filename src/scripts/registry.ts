import { ScriptManifest, ScriptHandler } from './types.js';

interface RegistryEntry {
  manifest: ScriptManifest;
  handler: ScriptHandler;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a script with its manifest and handler.
 */
export function registerScript(manifest: ScriptManifest, handler: ScriptHandler): void {
  registry.set(manifest.name, { manifest, handler });
}

/**
 * Retrieve a registered script by name.
 */
export function getScript(name: string): RegistryEntry | undefined {
  return registry.get(name);
}

/**
 * Get all registered script manifests (sent to Planner — never the code).
 */
export function getAllManifests(): ScriptManifest[] {
  return Array.from(registry.values()).map(e => e.manifest);
}

/**
 * Check whether a script name is registered.
 */
export function hasScript(name: string): boolean {
  return registry.has(name);
}
