import { registerScript } from '../registry.js';
import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

interface AxeOption {
  name: string;
  requiredLevel: number;
}

const AXES: AxeOption[] = [
  {
    name: 'Rune axe',
    requiredLevel: 41,
  },
  {
    name: 'Adamant axe',
    requiredLevel: 31,
  },
  {
    name: 'Mithril axe',
    requiredLevel: 21,
  },
  {
    name: 'Steel axe',
    requiredLevel: 6,
  },
  {
    name: 'Iron axe',
    requiredLevel: 1,
  },
  {
    name: 'Bronze axe',
    requiredLevel: 1,
  },
];

const SHOP_LOCATIONS = [
  {
    name: 'Varrock General Store',
    x: 3212,
    z: 3417,
    tolerance: 8,
    npc: /shop keeper|shop assistant/i,
  },
];

registerScript(
  {
    name: 'ensure_woodcutting_tool',

    description:
      'Ensure an appropriate axe is available in inventory or equipment. Prefer an owned axe from the bank; only purchase one when no suitable owned axe exists and sufficient coins are available.',

    params: {
      location:
        'string — registered activity location',

      preferredAxe:
        'string — optional preferred axe name',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'appropriate_axe_available',
    ],

    failureModes: [
      'axe_already_available',
      'bank_not_reachable',
      'axe_not_in_bank',
      'no_coins',
      'insufficient_coins',
      'shop_not_found',
      'axe_not_in_shop',
      'purchase_failed',
      'timeout',
    ],

    category: 'equipment',

    verified: true,

    version: 3,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    const preferredAxe =
      String(
        params.preferredAxe ?? '',
      ).trim();

    const adapter =
      createRsSdkAdapter(ctx);

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * 1. ALREADY HAVE AN AXE
       * ------------------------------------------------------------
       *
       * An axe in inventory OR equipment is enough.
       * We deliberately do not equip it.
       */
      const inventory =
        adapter.getInventory();

      const equipment =
        adapter.getEquipment();

      const existingAxe =
        [
          ...inventory,
          ...equipment,
        ].find(
          (item: any) =>
            typeof item?.name === 'string' &&
            /\baxe\b/i.test(
              item.name,
            ),
        );

      if (existingAxe) {
        console.log(
          `[Tool] Axe already available: ${existingAxe.name}`,
        );

        return {
          success: true,

          message:
            `Axe already available: ${existingAxe.name}`,

          data: {
            axe:
              existingAxe.name,

            source:
              'inventory_or_equipment',
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * 2. CURRENT WOODCUTTING LEVEL
       * ------------------------------------------------------------
       */
      const skill =
        adapter.getSkill(
          'woodcutting',
        );

      const woodcuttingLevel =
        Number(
          skill?.level ??
          skill?.current ??
          1,
        );

      console.log(
        `[Tool] Woodcutting level: ${woodcuttingLevel}`,
      );

      /*
       * ------------------------------------------------------------
       * 3. USABLE AXES
       * ------------------------------------------------------------
       */
      const usableAxes =
        AXES.filter(
          (axe) =>
            axe.requiredLevel <=
            woodcuttingLevel,
        );

      if (
        usableAxes.length === 0
      ) {
        return {
          success: false,

          message:
            'No usable axe exists for current Woodcutting level.',

          data: {
            reason:
              'no_usable_axe',

            woodcuttingLevel,
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * 4. OPEN BANK
       * ------------------------------------------------------------
       */
      if (
        !adapter.isBankOpen()
      ) {
        const opened =
          await adapter.openBank();

        if (!opened.success) {
          return {
            success: false,

            message:
              `Could not open bank: ${opened.message}`,

            data: {
              reason:
                'bank_not_reachable',
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * 5. ORDER CANDIDATES
       * ------------------------------------------------------------
       */
      let candidates =
        usableAxes;

      if (preferredAxe) {
        const preferred =
          usableAxes.find(
            (axe) =>
              axe.name.toLowerCase() ===
              preferredAxe.toLowerCase(),
          );

        if (preferred) {
          candidates = [
            preferred,

            ...usableAxes.filter(
              (axe) =>
                axe.name !==
                preferred.name,
            ),
          ];
        }
      }

      /*
       * ------------------------------------------------------------
       * 6. FIND BEST ACTUALLY OWNED AXE
       * ------------------------------------------------------------
       */
      let bankAxe:
        AxeOption | undefined;

      for (
        const axe of candidates
      ) {
        const found =
          adapter.findBankItem(
            new RegExp(
              `^${escapeRegex(
                axe.name,
              )}$`,
              'i',
            ),
          );

        if (found) {
          bankAxe = axe;
          break;
        }
      }

      if (bankAxe) {
        console.log(
          `[Tool] Found owned axe in bank: ${bankAxe.name}`,
        );

        const withdrawal =
          await adapter.withdrawItem(
            bankAxe.name,
            1,
          );

        if (
          !withdrawal.success
        ) {
          return {
            success: false,

            message:
              `Could not withdraw ${bankAxe.name}: ${withdrawal.message}`,

            data: {
              reason:
                'withdraw_failed',

              axe:
                bankAxe.name,
            },
          };
        }

        const observed =
          adapter
            .getInventory()
            .find(
              (item: any) =>
                typeof item?.name ===
                  'string' &&
                item.name.toLowerCase() ===
                  bankAxe!.name.toLowerCase(),
            );

        if (!observed) {
          return {
            success: false,

            message:
              `Withdrawal completed but ${bankAxe.name} was not observed in inventory.`,

            data: {
              reason:
                'withdrawal_not_observed',
            },
          };
        }

        return {
          success: true,

          message:
            `Withdrew ${bankAxe.name} from bank.`,

          data: {
            axe:
              bankAxe.name,

            source:
              'bank',

            location,
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * 7. NO OWNED AXE — CHECK COINS
       * ------------------------------------------------------------
       */
      const coins =
        adapter.getCoins();

      console.log(
        `[Tool] No usable axe found in bank. Coins available: ${coins}`,
      );

      if (
        coins <= 0
      ) {
        return {
          success: false,

          message:
            'No suitable axe is owned and no coins are available for purchase.',

          data: {
            reason:
              'no_coins',

            coins,

            woodcuttingLevel,

            usableAxes:
              usableAxes.map(
                (axe) =>
                  axe.name,
              ),
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * 8. SHOP PURCHASE FALLBACK
       * ------------------------------------------------------------
       */
      const purchaseAxe =
        candidates[0];

      if (!purchaseAxe) {
        return {
          success: false,

          message:
            'No suitable axe selected for purchase.',

          data: {
            reason:
              'no_purchase_candidate',
          },
        };
      }

      const shop =
        SHOP_LOCATIONS[0];

      console.log(
        `[Tool] Going to ${shop.name} to purchase ${purchaseAxe.name}...`,
      );

      /*
       * Close bank before walking to the shop.
       */
      if (
        adapter.isBankOpen()
      ) {
        await adapter.closeBank();
      }

      const walk =
        await adapter.walkTo(
          shop.x,
          shop.z,
          shop.tolerance,
        );

      if (
        !walk.success
      ) {
        return {
          success: false,

          message:
            `Could not reach ${shop.name}: ${walk.message}`,

          data: {
            reason:
              'shop_not_reachable',
          },
        };
      }

      const openedShop =
        await adapter.openShop(
          shop.npc,
        );

      if (
        !openedShop.success
      ) {
        return {
          success: false,

          message:
            `Could not open ${shop.name}: ${openedShop.message}`,

          data: {
            reason:
              'shop_not_found',
          },
        };
      }

      const purchase =
        await adapter.buyFromShop(
          purchaseAxe.name,
          1,
        );

      if (
        !purchase.success
      ) {
        await adapter.closeShop();

        return {
          success: false,

          message:
            `Could not buy ${purchaseAxe.name}: ${purchase.message}`,

          data: {
            reason:
              purchase.data?.reason ??
              'purchase_failed',

            coins,

            axe:
              purchaseAxe.name,
          },
        };
      }

      await adapter.closeShop();

      /*
       * Verify actual inventory state.
       */
      const purchased =
        adapter
          .getInventory()
          .find(
            (item: any) =>
              typeof item?.name ===
                'string' &&
              item.name.toLowerCase() ===
                purchaseAxe.name.toLowerCase(),
          );

      if (!purchased) {
        return {
          success: false,

          message:
            `Purchase reported success but ${purchaseAxe.name} was not observed in inventory.`,

          data: {
            reason:
              'purchase_not_observed',
          },
        };
      }

      return {
        success: true,

        message:
          `Bought ${purchaseAxe.name}.`,

        data: {
          axe:
            purchaseAxe.name,

          source:
            'shop',

          location,
        },
      };
    } catch (error) {
      return {
        success: false,

        message:
          `Tool preparation failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'exception',
        },
      };
    }

    /*
     * NO DISCONNECT HERE.
     *
     * The GatheringCore owns the shared RS-SDK connection.
     * Disconnecting here would kill the controller between:
     *
     * prepare -> travel -> gather -> bank -> next cycle
     */
  },
);

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}
