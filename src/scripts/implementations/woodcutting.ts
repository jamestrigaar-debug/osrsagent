import { registerScript } from '../registry.js';
import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  createRsSdkAdapter,
} from '../../adapters/rs-sdk.js';

registerScript(
  {
    name: 'gather_wood',

    description:
      'Gather wood from a selected persistent tree node using an available axe.',

    params: {
      location:
        'string — registered woodcutting location',

      resource:
        'string — tree | oak | willow | maple | yew | magic',

      targetX:
        'number — saved tree world X coordinate',

      targetZ:
        'number — saved tree world Z coordinate',
    },

    preconditions: [
      'in_game',
      'correct_woodcutting_tool',
      'at_woodcutting_location',
    ],

    postconditions: [
      'woodcutting_action_attempted',
    ],

    failureModes: [
      'resource_not_found',
      'equipment_missing',
      'inventory_full',
      'interaction_failed',
      'timeout',
    ],

    category:
      'gathering',

    verified:
      true,

    version:
      4,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const location =
      String(
        params.location ?? '',
      ).trim();

    const resource =
      String(
        params.resource ?? 'tree',
      ).trim();

    const targetX =
      Number(
        params.targetX,
      );

    const targetZ =
      Number(
        params.targetZ,
      );

    const adapter =
      createRsSdkAdapter(ctx);

    try {
      await adapter.connect();

      /*
       * ------------------------------------------------------------
       * EQUIPMENT
       * ------------------------------------------------------------
       */
      const inventory =
        adapter.getInventory();

      const equipment =
        adapter.getEquipment();

      const axe =
        [
          ...inventory,
          ...equipment,
        ].find(
          (item: any) =>
            typeof item?.name ===
              'string' &&
            /\baxe\b/i.test(
              item.name,
            ),
        );

      if (!axe) {
        return {
          success:
            false,

          message:
            'No axe available for woodcutting',

          data: {
            reason:
              'equipment_missing',
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * INVENTORY
       * ------------------------------------------------------------
       */
      if (
        inventory.length >= 28
      ) {
        return {
          success:
            false,

          message:
            'Inventory is full; banking is required',

          data: {
            reason:
              'inventory_full',

            inventorySlots:
              inventory.length,
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * VALIDATE SAVED NODE
       * ------------------------------------------------------------
       */
      if (
        !Number.isFinite(
          targetX,
        ) ||
        !Number.isFinite(
          targetZ,
        )
      ) {
        return {
          success:
            false,

          message:
            'Saved tree coordinates are invalid',

          data: {
            reason:
              'invalid_coordinates',
          },
        };
      }

      /*
       * ------------------------------------------------------------
       * WALK TO THE SAVED NODE
       * ------------------------------------------------------------
       *
       * This is the persistent-route behaviour.
       *
       * We do NOT walk to the generic resource anchor.
       */
      console.log(
        `[Woodcutting] Target node: ${resource} at (${targetX}, ${targetZ})`,
      );

      const walkResult =
        await adapter.walkTo(
          targetX,
          targetZ,
          2,
        );

      if (
        !walkResult.success
      ) {
        return {
          success:
            false,

          message:
            `Could not reach saved tree node: ${walkResult.message}`,

          data: {
            reason:
              'node_unreachable',

            targetX,

            targetZ,
          },
        };
      }

      /*
       * Give the world state a couple of ticks to refresh after
       * arriving at the saved node.
       */
      await waitForTicksSafe(
        adapter,
        2,
      );

      /*
       * ------------------------------------------------------------
       * VERIFY THE SAVED NODE
       * ------------------------------------------------------------
       */
      const nearby =
        adapter.getNearbyLocs();

      const exactNode =
        nearby.find(
          (loc: any) =>
            Number(
              loc?.x,
            ) === targetX &&
            Number(
              loc?.z,
            ) === targetZ &&
            isValidTreeName(
              String(
                loc?.name ?? '',
              ),
              resource,
            ),
        );

      if (!exactNode) {
        return {
          success:
            false,

          message:
            `Saved ${resource} node at (${targetX}, ${targetZ}) is currently unavailable`,

          data: {
            reason:
              'resource_not_found',

            targetX,

            targetZ,

            resource,
          },
        };
      }

      console.log(
        `[Woodcutting] Found saved node: ${exactNode.name} (${targetX}, ${targetZ})`,
      );

      console.log(
        `[Woodcutting] Axe available: ${axe.name}`,
      );

      /*
       * ------------------------------------------------------------
       * CHOP
       * ------------------------------------------------------------
       *
       * We use the existing proven adapter.chopTree(resource)
       * after positioning at the saved node.
       *
       * No chopTreeAt method is required.
       */
      const result =
        await adapter.chopTree(
          resource,
        );

      if (
        !result.success
      ) {
        return {
          success:
            false,

          message:
            result.message,

          data: {
            location,

            resource,

            axe:
              axe.name,

            targetX,

            targetZ,

            ...(result.data ?? {}),
          },
        };
      }

      return {
        success:
          true,

        message:
          `Chopped ${exactNode.name} at (${targetX}, ${targetZ})`,

        data: {
          location,

          resource,

          axe:
            axe.name,

          targetX,

          targetZ,

          node:
            exactNode.name,

          ...(result.data ?? {}),
        },
      };
    } catch (error) {
      return {
        success:
          false,

        message:
          `Woodcutting failed: ${
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

function isValidTreeName(
  name: string,
  resource: string,
): boolean {
  if (
    /stump/i.test(
      name,
    )
  ) {
    return false;
  }

  if (
    resource.toLowerCase() ===
    'tree'
  ) {
    return /^(tree|normal tree)$/i.test(
      name,
    );
  }

  return new RegExp(
    `^${escapeRegex(resource)}$`,
    'i',
  ).test(
    name,
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

async function waitForTicksSafe(
  adapter: any,
  ticks: number,
): Promise<void> {
  const sdk =
    adapter?.sdk;

  if (
    sdk?.waitForTicks
  ) {
    await sdk.waitForTicks(
      ticks,
    );
  }
}
