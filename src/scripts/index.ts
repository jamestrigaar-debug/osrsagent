/**
 * Script manifests index — imports all implementations to trigger registerScript calls.
 */
export * from './registry.js';
export * from './executor.js';
export * from './types.js';

// Side-effect imports: register all scripts
import './implementations/movement.js';
import './implementations/fishing.js';
import './implementations/banking.js';
import './implementations/inventory.js';
