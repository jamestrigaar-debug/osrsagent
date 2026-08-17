import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../logger.js';
import type { Command, CommandStatus, CommandType, QueueState } from './types.js';

const DB_PATH =
  process.env.MEMORY_DB_PATH ||
  path.join(process.cwd(), 'memory.db');

/* ================================================================
 * DATABASE
 * ================================================================ */

let db: Database.Database | null = null;

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
    CREATE TABLE IF NOT EXISTS commands (
      id         TEXT    PRIMARY KEY,
      type       TEXT    NOT NULL,
      params     TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending'
    );
  `);
}

/* ================================================================
 * COMMAND QUEUE
 * ================================================================ */

/**
 * Persistent command queue backed by SQLite.
 *
 * All mutating operations are serialised through SQLite so they are
 * safe for concurrent dispatcher ticks.
 *
 * The in-memory path is intentionally thin — the database is the
 * source of truth and is always consulted on reads.
 */
export class CommandQueue {
  /* ================================================================
   * WRITE
   * ================================================================ */

  /**
   * Append a command to the end of the queue.
   * Idempotent if a command with the same id already exists.
   */
  enqueue(command: Command): void {
    const database = getDb();

    database
      .prepare(
        `INSERT OR IGNORE INTO commands
           (id, type, params, created_at, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        command.id,
        command.type,
        JSON.stringify(command.params),
        command.createdAt,
        command.status,
      );

    logger.debug({ id: command.id, type: command.type }, 'CommandQueue: enqueued');
  }

  /**
   * Remove and return the oldest pending command.
   * Returns `null` if the queue is empty.
   *
   * Uses a SQLite transaction so the dequeue is atomic.
   */
  dequeue(): Command | null {
    const database = getDb();

    const dequeueTransaction = database.transaction((): Command | null => {
      const row = database
        .prepare(
          `SELECT id, type, params, created_at, status
             FROM commands
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1`,
        )
        .get() as RawRow | undefined;

      if (!row) {
        return null;
      }

      database
        .prepare(`DELETE FROM commands WHERE id = ?`)
        .run(row.id);

      return rowToCommand(row);
    });

    const command = dequeueTransaction();

    if (command) {
      logger.debug({ id: command.id, type: command.type }, 'CommandQueue: dequeued');
    }

    return command;
  }

  /**
   * Return the oldest pending command without removing it.
   */
  peek(): Command | null {
    const row = getDb()
      .prepare(
        `SELECT id, type, params, created_at, status
           FROM commands
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1`,
      )
      .get() as RawRow | undefined;

    return row ? rowToCommand(row) : null;
  }

  /* ================================================================
   * READ
   * ================================================================ */

  /**
   * Return all commands, optionally filtered by status.
   */
  list(status?: CommandStatus): Command[] {
    const database = getDb();

    const rows = (
      status
        ? database
            .prepare(
              `SELECT id, type, params, created_at, status
                 FROM commands
                WHERE status = ?
                ORDER BY created_at ASC`,
            )
            .all(status)
        : database
            .prepare(
              `SELECT id, type, params, created_at, status
                 FROM commands
                ORDER BY created_at ASC`,
            )
            .all()
    ) as RawRow[];

    return rows.map(rowToCommand);
  }

  /**
   * Return a single command by id, or `null` if not found.
   */
  get(id: string): Command | null {
    const row = getDb()
      .prepare(
        `SELECT id, type, params, created_at, status
           FROM commands
          WHERE id = ?`,
      )
      .get(id) as RawRow | undefined;

    return row ? rowToCommand(row) : null;
  }

  /* ================================================================
   * MUTATION
   * ================================================================ */

  /**
   * Apply a partial update to an existing command.
   * Only `status`, `type`, and `params` are writable after creation.
   */
  update(
    id: string,
    updates: Partial<Pick<Command, 'status' | 'type' | 'params'>>,
  ): void {
    const database = getDb();

    if (updates.status !== undefined) {
      database
        .prepare(`UPDATE commands SET status = ? WHERE id = ?`)
        .run(updates.status, id);
    }

    if (updates.type !== undefined) {
      database
        .prepare(`UPDATE commands SET type = ? WHERE id = ?`)
        .run(updates.type, id);
    }

    if (updates.params !== undefined) {
      database
        .prepare(`UPDATE commands SET params = ? WHERE id = ?`)
        .run(JSON.stringify(updates.params), id);
    }

    logger.debug({ id, updates }, 'CommandQueue: updated');
  }

  /**
   * Remove a command by id.
   */
  remove(id: string): void {
    getDb()
      .prepare(`DELETE FROM commands WHERE id = ?`)
      .run(id);

    logger.debug({ id }, 'CommandQueue: removed');
  }

  /**
   * Remove all pending commands.
   */
  clear(): void {
    getDb()
      .prepare(`DELETE FROM commands WHERE status = 'pending'`)
      .run();

    logger.debug('CommandQueue: cleared pending commands');
  }

  /* ================================================================
   * STATE
   * ================================================================ */

  /**
   * Return aggregate counts for the queue.
   */
  getState(): QueueState {
    const database = getDb();

    const total =
      (
        database
          .prepare(`SELECT COUNT(*) AS n FROM commands`)
          .get() as { n: number }
      ).n;

    const pending =
      (
        database
          .prepare(`SELECT COUNT(*) AS n FROM commands WHERE status = 'pending'`)
          .get() as { n: number }
      ).n;

    const running =
      (
        database
          .prepare(`SELECT COUNT(*) AS n FROM commands WHERE status = 'running'`)
          .get() as { n: number }
      ).n;

    return { total, pending, running };
  }
}

/* ================================================================
 * HELPERS
 * ================================================================ */

interface RawRow {
  id: string;
  type: string;
  params: string;
  created_at: number;
  status: string;
}

function rowToCommand(row: RawRow): Command {
  return {
    id: row.id,
    type: row.type as CommandType,
    params: JSON.parse(row.params) as Record<string, unknown>,
    createdAt: row.created_at,
    status: row.status as CommandStatus,
  };
}
