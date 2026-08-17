import Database from 'better-sqlite3';
import path from 'path';
import { AccountMemory, ActionResult, ActivePlan, InventorySlot, EquipmentSlot, Location, Skills } from './types.js';
import { logger } from '../logger.js';

const DB_PATH = process.env.MEMORY_DB_PATH || path.join(process.cwd(), 'memory.db');

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function defaultMemory(accountId: string): AccountMemory {
  return {
    accountId,
    skills: {},
    inventory: [],
    equipment: [],
    location: { worldX: 0, worldZ: 0 },
    currentGoal: '',
    activePlanId: null,
    activePlan: null,
    lastActionResult: null,
    history: [],
    updatedAt: Date.now(),
  };
}

/**
 * Load account memory from store. Creates a default entry if not found.
 */
export function loadMemory(accountId: string): AccountMemory {
  const database = getDb();
  const row = database.prepare('SELECT data FROM accounts WHERE account_id = ?').get(accountId) as { data: string } | undefined;
  if (!row) {
    const mem = defaultMemory(accountId);
    saveMemory(mem);
    return mem;
  }
  return JSON.parse(row.data) as AccountMemory;
}

/**
 * Persist account memory atomically.
 */
export function saveMemory(memory: AccountMemory): void {
  memory.updatedAt = Date.now();
  const database = getDb();
  database
    .prepare(
      'INSERT OR REPLACE INTO accounts (account_id, data, updated_at) VALUES (?, ?, ?)'
    )
    .run(memory.accountId, JSON.stringify(memory), memory.updatedAt);
}

/**
 * Update specific fields of an account memory atomically.
 */
export function updateMemory(
  accountId: string,
  updates: Partial<Omit<AccountMemory, 'accountId'>>
): AccountMemory {
  const memory = loadMemory(accountId);
  const updated: AccountMemory = { ...memory, ...updates, accountId };
  saveMemory(updated);
  logger.debug({ accountId, updates }, 'Memory updated');
  return updated;
}

/**
 * Append a string message to the account history log (capped at 200 entries).
 */
export function appendHistory(accountId: string, entry: string): void {
  const memory = loadMemory(accountId);
  const history = [...memory.history, entry].slice(-200);
  updateMemory(accountId, { history });
}

/**
 * Record the result of the last script execution.
 */
export function recordActionResult(accountId: string, result: ActionResult): void {
  updateMemory(accountId, { lastActionResult: result });
  appendHistory(
    accountId,
    `[${new Date(result.timestamp).toISOString()}] ${result.success ? 'OK' : 'FAIL'}: ${result.message}`
  );
}

/**
 * Store a new active plan in memory.
 */
export function storePlan(accountId: string, plan: ActivePlan): void {
  updateMemory(accountId, {
    activePlanId: plan.planId,
    activePlan: plan,
  });
  logger.info({ accountId, planId: plan.planId }, 'Plan stored in memory');
}

/**
 * Clear the active plan (e.g. on completion or cancellation).
 */
export function clearPlan(accountId: string): void {
  updateMemory(accountId, { activePlanId: null, activePlan: null });
  logger.info({ accountId }, 'Active plan cleared');
}

/**
 * Update live game state fields from SDK data.
 */
export function updateGameState(
  accountId: string,
  gameState: {
    skills?: Skills;
    inventory?: InventorySlot[];
    equipment?: EquipmentSlot[];
    location?: Location;
  }
): void {
  updateMemory(accountId, gameState);
}

/**
 * List all account IDs currently stored.
 */
export function listAccounts(): string[] {
  const database = getDb();
  const rows = database.prepare('SELECT account_id FROM accounts').all() as { account_id: string }[];
  return rows.map(r => r.account_id);
}

/**
 * Close the database connection (for graceful shutdown).
 */
export function closeMemoryStore(): void {
  if (db) {
    db.close();
  }
}
