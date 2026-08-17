import axios from 'axios';
import { registerScript } from '../registry.js';
import { ScriptContext, ScriptResult } from '../types.js';

// ─── equip_item ───────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'equip_item',
    description: 'Equips the specified item from inventory.',
    params: { item: 'string — item name' },
    preconditions: ['item_in_inventory'],
    postconditions: ['item_equipped'],
    verified: true,
  },
  async (params: Record<string, unknown>, ctx: ScriptContext): Promise<ScriptResult> => {
    const item = params['item'] as string;
    try {
      await axios.post(`${ctx.sdkBaseUrl}/api/action`, {
        bot: ctx.sdkBotName,
        password: ctx.sdkBotPassword,
        action: 'equip',
        params: { item },
      });
      return { success: true, message: `Equipped ${item}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `SDK error: ${msg}` };
    }
  }
);

// ─── buy_item ─────────────────────────────────────────────────────────────────

registerScript(
  {
    name: 'buy_item',
    description: 'Buys the specified item from the GE or nearby shop.',
    params: {
      item: 'string — item name',
      quantity: 'number — quantity to buy',
      price: 'number — max price per item (optional)',
    },
    preconditions: ['has_coins', 'near_shop_or_ge'],
    postconditions: ['item_in_inventory'],
    verified: true,
  },
  async (params: Record<string, unknown>, ctx: ScriptContext): Promise<ScriptResult> => {
    const item = params['item'] as string;
    const quantity = (params['quantity'] as number) ?? 1;
    const price = params['price'] as number | undefined;
    try {
      await axios.post(`${ctx.sdkBaseUrl}/api/action`, {
        bot: ctx.sdkBotName,
        password: ctx.sdkBotPassword,
        action: 'buy',
        params: { item, quantity, price },
      });
      return { success: true, message: `Bought ${quantity}x ${item}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `SDK error: ${msg}` };
    }
  }
);
