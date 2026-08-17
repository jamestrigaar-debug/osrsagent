import axios from 'axios';
import { registerScript } from '../registry.js';
import { ScriptContext, ScriptResult } from '../types.js';

// ─── withdraw_item ────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'withdraw_item',
    description: 'Withdraws the specified item from the bank.',
    params: {
      item: 'string — item name',
      quantity: 'number — how many to withdraw (default 1)',
    },
    preconditions: ['at_bank', 'bank_open'],
    postconditions: ['item_in_inventory'],
    failureModes: [
      'bank_not_open',
      'item_not_found',
      'partial_withdrawal',
      'timeout',
    ],
    category: 'banking',
    verified: true,
    version: 1,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const item = params['item'] as string;
    const quantity =
      (params['quantity'] as number) ?? 1;

    try {
      await axios.post(
        `${ctx.sdkBaseUrl}/api/action`,
        {
          bot: ctx.sdkBotName,
          password: ctx.sdkBotPassword,
          action: 'bank_withdraw',
          params: {
            item,
            quantity,
          },
        },
      );

      return {
        success: true,
        message: `Withdrew ${quantity}x ${item}`,
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : String(err);

      return {
        success: false,
        message: `SDK error: ${msg}`,
      };
    }
  },
);

// ─── deposit_item ─────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'deposit_item',
    description: 'Deposits the specified item into the bank.',
    params: {
      item: 'string — item name',
      quantity:
        'number — how many to deposit (default: all)',
    },
    preconditions: [
      'at_bank',
      'bank_open',
      'item_in_inventory',
    ],
    postconditions: [
      'item_removed_from_inventory',
    ],
    failureModes: [
      'bank_not_open',
      'item_not_found',
      'partial_deposit',
      'timeout',
    ],
    category: 'banking',
    verified: true,
    version: 1,
  },
  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const item = params['item'] as string;
    const quantity =
      (params['quantity'] as number) ?? -1;

    try {
      await axios.post(
        `${ctx.sdkBaseUrl}/api/action`,
        {
          bot: ctx.sdkBotName,
          password: ctx.sdkBotPassword,
          action: 'bank_deposit',
          params: {
            item,
            quantity,
          },
        },
      );

      return {
        success: true,
        message:
          `Deposited ${
            quantity === -1
              ? 'all'
              : quantity
          }x ${item}`,
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : String(err);

      return {
        success: false,
        message: `SDK error: ${msg}`,
      };
    }
  },
);

// ─── bank_all ─────────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'bank_all',
    description:
      'Deposits all items from inventory into the bank.',
    params: {},
    preconditions: [
      'at_bank',
      'bank_open',
    ],
    postconditions: [
      'inventory_empty',
    ],
    failureModes: [
      'bank_not_open',
      'deposit_failed',
      'timeout',
    ],
    category: 'banking',
    verified: true,
    version: 1,
  },
  async (
    _params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    try {
      await axios.post(
        `${ctx.sdkBaseUrl}/api/action`,
        {
          bot: ctx.sdkBotName,
          password: ctx.sdkBotPassword,
          action: 'bank_deposit_all',
          params: {},
        },
      );

      return {
        success: true,
        message: 'Deposited all items',
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : String(err);

      return {
        success: false,
        message: `SDK error: ${msg}`,
      };
    }
  },
);
