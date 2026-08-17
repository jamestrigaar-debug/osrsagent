import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

interface PickaxeOption {
  name: string;
  requiredLevel: number;
}

const PICKAXES: PickaxeOption[] = [
  { name: 'Rune pickaxe', requiredLevel: 41 },
  { name: 'Adamant pickaxe', requiredLevel: 31 },
  { name: 'Mithril pickaxe', requiredLevel: 21 },
  { name: 'Steel pickaxe', requiredLevel: 6 },
  { name: 'Iron pickaxe', requiredLevel: 1 },
  { name: 'Bronze pickaxe', requiredLevel: 1 },
];

registerScript(
  {
    name:
      'ensure_mining_tool',

    description:
      'Ensure an appropriate pickaxe is available in inventory or equipment. Prefer an owned pickaxe from the bank.',

    params: {
      location:
        'string — registered mining location',

      preferredPickaxe:
        'string — optional preferred pickaxe name',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'appropriate_pickaxe_available',
    ],

    failureModes: [
      'pickaxe_already_available',
      'bank_not_reachable',
      'pickaxe_not_in_bank',
      'no_coins',
      'withdraw_failed',
      'timeout',
    ],

    category:
      'equipment',

    verified:
      false,

    version:
      1,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const preferred =
      String(
        params.preferredPickaxe ?? '',
      ).trim();

    const adapter =
      createRsSdkAdapter(ctx);

    try {
      await adapter.connect();

      /*
       * Already have a pickaxe?
       */
      const existing =
        [
          ...adapter.getInventory(),
          ...adapter.getEquipment(),
        ].find(
          (item: any) =>
            typeof item?.name === 'string' &&
            /pickaxe/i.test(
              item.name,
            ),
        );

      if (existing) {
        console.log(
          `[Mining Tool] Pickaxe already available: ${existing.name}`,
        );

        return {
          success: true,

          message:
            `Pickaxe already available: ${existing.name}`,

          data: {
            pickaxe:
              existing.name,

            source:
              'inventory_or_equipment',
          },
        };
      }

      /*
       * Mining level.
       */
      const skill =
        adapter.getSkill(
          'mining',
        );

      const miningLevel =
        Number(
          skill?.level ??
          skill?.current ??
          1,
        );

      console.log(
        `[Mining Tool] Mining level: ${miningLevel}`,
      );

      const usable =
        PICKAXES.filter(
          (pickaxe) =>
            pickaxe.requiredLevel <=
            miningLevel,
        );

      if (!usable.length) {
        return {
          success: false,

          message:
            `No usable pickaxe for Mining level ${miningLevel}`,

          data: {
            reason:
              'no_usable_pickaxe',

            miningLevel,
          },
        };
      }

      /*
       * Honour preferred pickaxe when usable.
       */
      let candidates =
        usable;

      if (preferred) {
        const selected =
          usable.find(
            (pickaxe) =>
              pickaxe.name.toLowerCase() ===
              preferred.toLowerCase(),
          );

        if (selected) {
          candidates = [
            selected,
            ...usable.filter(
              (pickaxe) =>
                pickaxe.name !==
                selected.name,
            ),
          ];
        }
      }

      /*
       * Open bank.
       */
      if (!adapter.isBankOpen()) {
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
       * Find the best owned pickaxe.
       */
      let bankPickaxe:
        PickaxeOption | undefined;

      for (
        const pickaxe of candidates
      ) {
        const found =
          adapter.findBankItem(
            new RegExp(
              `^${escapeRegex(
                pickaxe.name,
              )}$`,
              'i',
            ),
          );

        if (found) {
          bankPickaxe =
            pickaxe;

          break;
        }
      }

      if (!bankPickaxe) {
        return {
          success: false,

          message:
            'No suitable pickaxe found in bank.',

          data: {
            reason:
              'pickaxe_not_in_bank',

            miningLevel,
          },
        };
      }

      console.log(
        `[Mining Tool] Found owned pickaxe: ${bankPickaxe.name}`,
      );

      const withdrawal =
        await adapter.withdrawItem(
          bankPickaxe.name,
          1,
        );

      if (!withdrawal.success) {
        return {
          success: false,

          message:
            `Could not withdraw ${bankPickaxe.name}: ${withdrawal.message}`,

          data: {
            reason:
              'withdraw_failed',

            pickaxe:
              bankPickaxe.name,
          },
        };
      }

      const observed =
        adapter
          .getInventory()
          .find(
            (item: any) =>
              typeof item?.name === 'string' &&
              item.name.toLowerCase() ===
                bankPickaxe!.name.toLowerCase(),
          );

      if (!observed) {
        return {
          success: false,

          message:
            `Withdrawal completed but ${bankPickaxe.name} was not observed in inventory.`,

          data: {
            reason:
              'withdrawal_not_observed',
          },
        };
      }

      return {
        success: true,

        message:
          `Withdrew ${bankPickaxe.name} from bank.`,

        data: {
          pickaxe:
            bankPickaxe.name,

          source:
            'bank',
        },
      };
    } catch (error) {
      return {
        success: false,

        message:
          `Mining tool preparation failed: ${
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
