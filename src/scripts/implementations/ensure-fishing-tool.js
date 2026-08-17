import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

interface FishingToolRequirement {
  method: string;
  equipmentName: string;
  equipmentPattern: RegExp;
  requiredItems?: string[];
}

const FISHING_REQUIREMENTS: FishingToolRequirement[] = [
  {
    method: 'net',
    equipmentName: 'Small fishing net',
    equipmentPattern: /small fishing net/i,
  },

  {
    method: 'bait',
    equipmentName: 'Fishing rod',
    equipmentPattern: /^fishing rod$/i,
    requiredItems: ['bait'],
  },

  {
    method: 'fly',
    equipmentName: 'Fly fishing rod',
    equipmentPattern: /fly fishing rod/i,
    requiredItems: ['feather'],
  },

  {
    method: 'lure',
    equipmentName: 'Fly fishing rod',
    equipmentPattern: /fly fishing rod/i,
    requiredItems: ['feather'],
  },

  {
    method: 'cage',
    equipmentName: 'Lobster pot',
    equipmentPattern: /lobster pot/i,
  },

  {
    method: 'harpoon',
    equipmentName: 'Harpoon',
    equipmentPattern: /harpoon/i,
  },
];

registerScript(
  {
    name: 'ensure_fishing_tool',

    description:
      'Ensure the correct fishing equipment is available in inventory or equipment for the requested fishing method. Prefer equipment already owned or stored in the bank.',

    params: {
      location:
        'string — registered fishing location',

      method:
        'string — net | bait | fly | lure | cage | harpoon',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'appropriate_fishing_equipment_available',
    ],

    failureModes: [
      'invalid_method',
      'equipment_already_available',
      'bank_not_reachable',
      'equipment_not_in_bank',
      'bait_not_in_bank',
      'feathers_not_in_bank',
      'withdraw_failed',
      'equipment_not_observed',
      'timeout',
    ],

    category: 'equipment',

    verified: false,

    version: 2,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    const method =
      String(
        params.method ?? 'net',
      ).trim().toLowerCase();

    const requirement =
      FISHING_REQUIREMENTS.find(
        (entry) =>
          entry.method === method,
      );

    if (!requirement) {
      return {
        success: false,

        message:
          `Unsupported fishing method: ${method}`,

        data: {
          reason: 'invalid_method',

          method,

          allowed:
            FISHING_REQUIREMENTS.map(
              (entry) =>
                entry.method,
            ),
        },
      };
    }

    const adapter =
      createRsSdkAdapter(
        ctx,
      );

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * CHECK CURRENT INVENTORY / EQUIPMENT
       * ------------------------------------------------------------
       */
      const inventory =
        adapter.getInventory();

      const equipment =
        adapter.getEquipment();

      const allItems = [
        ...inventory,
        ...equipment,
      ];

      const existingTool =
        allItems.find(
          (item: any) =>
            typeof item?.name === 'string' &&
            testRegex(
              requirement.equipmentPattern,
              item.name,
            ),
        );

      /*
       * ------------------------------------------------------------
       * TOOL ALREADY AVAILABLE
       * ------------------------------------------------------------
       */
      if (existingTool) {
        const consumables =
          checkConsumables(
            inventory,
            requirement,
          );

        if (consumables.success) {
          console.log(
            `[Fishing Tool] ${existingTool.name} already available.`,
          );

          return {
            success: true,

            message:
              `Fishing equipment already available: ${existingTool.name}`,

            data: {
              method,

              equipment:
                existingTool.name,

              source:
                'inventory_or_equipment',

              location,
            },
          };
        }

        console.log(
          `[Fishing Tool] ${existingTool.name} available, but required consumables are missing.`,
        );
      }

      /*
       * ------------------------------------------------------------
       * OPEN BANK
       * ------------------------------------------------------------
       */
      if (!adapter.isBankOpen()) {
        const opened =
          await adapter.openBank();

        if (!opened.success) {
          return {
            success: false,

            message:
              `Could not open bank for fishing equipment: ${opened.message}`,

            data: {
              reason:
                'bank_not_reachable',

              method,

              location,
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * PRIMARY EQUIPMENT
       * ------------------------------------------------------------
       */
      if (!existingTool) {
        const bankTool =
          adapter.findBankItem(
            requirement.equipmentPattern,
          );

        if (!bankTool) {
          return {
            success: false,

            message:
              `${requirement.equipmentName} not found in bank.`,

            data: {
              reason:
                'equipment_not_in_bank',

              method,

              equipment:
                requirement.equipmentName,
            },
          };
        }

        console.log(
          `[Fishing Tool] Found owned equipment in bank: ${bankTool.name}`,
        );

        const withdrawal =
          await adapter.withdrawItem(
            bankTool.name,
            1,
          );

        if (!withdrawal.success) {
          return {
            success: false,

            message:
              `Could not withdraw ${bankTool.name}: ${withdrawal.message}`,

            data: {
              reason:
                'withdraw_failed',

              method,

              equipment:
                bankTool.name,
            },
          };
        }
      }

      /*
       * ------------------------------------------------------------
       * REQUIRED CONSUMABLES
       * ------------------------------------------------------------
       */
      if (
        requirement.requiredItems &&
        requirement.requiredItems.length > 0
      ) {
        for (
          const requiredItem of
            requirement.requiredItems
        ) {
          const currentInventory =
            adapter.getInventory();

          const alreadyHave =
            currentInventory.some(
              (item: any) =>
                typeof item?.name === 'string' &&
                item.name.toLowerCase() ===
                  requiredItem.toLowerCase() &&
                Number(
                  item?.count ?? 0,
                ) > 0,
            );

          if (alreadyHave) {
            continue;
          }

          const bankConsumable =
            adapter.findBankItem(
              new RegExp(
                `^${escapeRegex(
                  requiredItem,
                )}$`,
                'i',
              ),
            );

          if (!bankConsumable) {
            return {
              success: false,

              message:
                `${requiredItem} not found in bank for ${method} fishing.`,

              data: {
                reason:
                  requiredItem.toLowerCase() ===
                  'bait'
                    ? 'bait_not_in_bank'
                    : 'feathers_not_in_bank',

                method,

                item:
                  requiredItem,
              },
            };
          }

          const withdrawalAmount = 100;

          console.log(
            `[Fishing Tool] Withdrawing ${withdrawalAmount} ${requiredItem}...`,
          );

          const withdrawal =
            await adapter.withdrawItem(
              bankConsumable.name,
              withdrawalAmount,
            );

          if (!withdrawal.success) {
            return {
              success: false,

              message:
                `Could not withdraw ${requiredItem}: ${withdrawal.message}`,

              data: {
                reason:
                  'withdraw_failed',

                method,

                item:
                  requiredItem,
              },
            };
          }
        }
      }

      /*
       * ------------------------------------------------------------
       * FINAL VERIFICATION
       * ------------------------------------------------------------
       */
      const finalInventory =
        adapter.getInventory();

      const finalEquipment =
        adapter.getEquipment();

      const finalItems = [
        ...finalInventory,
        ...finalEquipment,
      ];

      const finalTool =
        finalItems.find(
          (item: any) =>
            typeof item?.name === 'string' &&
            testRegex(
              requirement.equipmentPattern,
              item.name,
            ),
        );

      if (!finalTool) {
        return {
          success: false,

          message:
            `Fishing equipment preparation completed, but ${requirement.equipmentName} was not observed.`,

          data: {
            reason:
              'equipment_not_observed',

            method,
          },
        };
      }

      const finalConsumables =
        checkConsumables(
          finalInventory,
          requirement,
        );

      if (!finalConsumables.success) {
        return {
          success: false,

          message:
            finalConsumables.message,

          data: {
            reason:
              finalConsumables.data?.reason ??
              'consumable_missing',

            method,

            ...(finalConsumables.data ?? {}),
          },
        };
      }

      console.log(
        `[Fishing Tool] Ready: ${finalTool.name} for ${method} fishing.`,
      );

      return {
        success: true,

        message:
          `Prepared ${method} fishing equipment: ${finalTool.name}.`,

        data: {
          method,

          equipment:
            finalTool.name,

          source:
            existingTool
              ? 'inventory_or_equipment'
              : 'bank',

          location,
        },
      };
    } catch (error) {
      return {
        success: false,

        message:
          `Fishing tool preparation failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,

        data: {
          reason:
            'exception',

          method,

          location,
        },
      };
    }
  },
);

/* ================================================================
 * CONSUMABLE CHECK
 * ================================================================ */

function checkConsumables(
  inventory: any[],
  requirement: FishingToolRequirement,
): ScriptResult {
  if (
    !requirement.requiredItems ||
    requirement.requiredItems.length === 0
  ) {
    return {
      success: true,

      message:
        'No fishing consumables required.',
    };
  }

  for (
    const requiredItem of
      requirement.requiredItems
  ) {
    const item =
      inventory.find(
        (entry: any) =>
          typeof entry?.name === 'string' &&
          entry.name.toLowerCase() ===
            requiredItem.toLowerCase() &&
          Number(
            entry?.count ?? 0,
          ) > 0,
      );

    if (!item) {
      return {
        success: false,

        message:
          `Required fishing consumable missing: ${requiredItem}`,

        data: {
          reason:
            requiredItem.toLowerCase() ===
            'bait'
              ? 'bait_not_available'
              : 'feathers_not_available',

          item:
            requiredItem,
        },
      };
    }
  }

  return {
    success: true,

    message:
      'Fishing consumables verified.',
  };
}

/* ================================================================
 * REGEX
 * ================================================================ */

function testRegex(
  pattern: RegExp,
  value: string,
): boolean {
  pattern.lastIndex = 0;

  return pattern.test(
    value,
  );
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}
