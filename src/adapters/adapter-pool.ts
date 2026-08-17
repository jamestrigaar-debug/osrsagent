import {
  RsSdkAdapter,
  RsSdkAdapterOptions,
} from './rs-sdk.js';

import { logger } from '../logger.js';

/* ================================================================
 * ADAPTER POOL
 * ================================================================ */

interface PoolEntry {
  adapter: RsSdkAdapter;
  /** Number of active users (scripts currently referencing this adapter). */
  refCount: number;
}

/**
 * Singleton pool of long-lived {@link RsSdkAdapter} instances keyed by
 * account id.
 *
 * ### Design
 * - One WebSocket connection is maintained per account for the lifetime
 *   of the pool.
 * - `getAdapter()` returns the existing adapter when one is available,
 *   connecting it on first use.
 * - `release()` decrements the reference count but does **not**
 *   disconnect — the adapter stays alive for the next task.
 * - `destroy()` closes every adapter and empties the pool; call this
 *   during graceful shutdown.
 */
export class AdapterPool {
  private readonly entries: Map<string, PoolEntry> = new Map();

  private readonly optionsByAccount: Map<string, RsSdkAdapterOptions> =
    new Map();

  /* ================================================================
   * REGISTRATION
   * ================================================================ */

  /**
   * Register the connection options for an account so that
   * {@link getAdapter} can construct the adapter on first use.
   *
   * Re-registering with new options replaces the stored options but
   * does **not** reconnect an already-connected adapter.
   */
  registerOptions(
    accountId: string,
    options: RsSdkAdapterOptions,
  ): void {
    this.optionsByAccount.set(accountId, options);
  }

  /* ================================================================
   * ACQUIRE
   * ================================================================ */

  /**
   * Return the pooled adapter for `accountId`, creating and connecting
   * it if this is the first call.
   *
   * @param accountId  The account whose adapter to vend.
   * @param options    Connection options; required on first call for
   *                   this `accountId`.  Ignored if an adapter for the
   *                   account already exists in the pool.
   */
  async getAdapter(
    accountId: string,
    options?: RsSdkAdapterOptions,
  ): Promise<RsSdkAdapter> {
    const existing = this.entries.get(accountId);

    if (existing) {
      existing.refCount += 1;

      /*
       * Re-connect if the underlying SDK dropped the connection
       * between tasks.
       */
      if (!existing.adapter.isConnected()) {
        logger.info(
          { accountId },
          'AdapterPool: reconnecting dropped adapter',
        );

        await existing.adapter.connect();
      }

      return existing.adapter;
    }

    /*
     * Resolve options: prefer the argument, then fall back to what
     * was pre-registered.
     */
    const resolvedOptions =
      options ?? this.optionsByAccount.get(accountId);

    if (!resolvedOptions) {
      throw new Error(
        `AdapterPool: no options registered for account "${accountId}". ` +
          'Call registerOptions() or pass options to getAdapter().',
      );
    }

    const adapter = new RsSdkAdapter(resolvedOptions);

    logger.info(
      { accountId },
      'AdapterPool: creating new pooled adapter',
    );

    await adapter.connect();

    this.entries.set(accountId, { adapter, refCount: 1 });

    return adapter;
  }

  /* ================================================================
   * RELEASE
   * ================================================================ */

  /**
   * Signal that a script is done with the adapter.
   *
   * This is intentionally a **no-op** for the connection itself: the
   * adapter stays alive for the next task.  Only the reference count
   * is decremented so that `destroy()` knows when it is safe to close.
   */
  release(accountId: string): void {
    const entry = this.entries.get(accountId);

    if (!entry) {
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);

    logger.debug(
      { accountId, refCount: entry.refCount },
      'AdapterPool: released (adapter kept alive)',
    );
  }

  /* ================================================================
   * DESTROY
   * ================================================================ */

  /**
   * Disconnect and remove every pooled adapter.
   *
   * Call during graceful shutdown.
   */
  async destroy(): Promise<void> {
    const entries = [...this.entries.entries()];

    this.entries.clear();
    this.optionsByAccount.clear();

    await Promise.allSettled(
      entries.map(async ([accountId, { adapter }]) => {
        logger.info({ accountId }, 'AdapterPool: disconnecting adapter');

        try {
          await adapter.disconnect();
        } catch (err) {
          logger.warn(
            { accountId, err },
            'AdapterPool: error disconnecting adapter',
          );
        }
      }),
    );

    logger.info('AdapterPool: destroyed');
  }

  /* ================================================================
   * INTROSPECTION
   * ================================================================ */

  /**
   * Return the number of adapters currently in the pool.
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Return `true` if the pool has a live adapter for `accountId`.
   */
  has(accountId: string): boolean {
    return this.entries.has(accountId);
  }
}
