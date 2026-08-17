import { registerScript } from '../scripts/registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../scripts/types.js';

import {
  runGatheringCore,
  type GatheringLocation,
} from './gathering-core.js';

/* ================================================================
 * TRAINING LOCATION CONFIGURATION
 *
 * Explicitly supplied locations take priority over automatic
 * level-based selection.
 * ================================================================ */

interface TrainingLocation {
  id: string;

  name: string;

  profession:
    | 'woodcutting'
    | 'mining'
    | 'fishing';

  x: number;

  z: number;

  tolerance: number;

  minLevel: number;

  resource?: string;

  method?: string;

  dangerousNpcPattern?: RegExp;

  bank:
    GatheringLocation;

  bankId: string;

  nodeType:
    | 'locs'
    | 'npcs';

  nodePattern: RegExp;

  maxNodes?: number;

  scanRadius?: number;

  rebuildAfterMisses?: number;

  inventoryThreshold: number;
}

/* ================================================================
 * LOCATIONS
 * ================================================================ */

const TRAINING_LOCATIONS:
  TrainingLocation[] = [

  /* ==============================================================
   * WOODCUTTING
   * ============================================================== */

  {
    id:
      'varrock-west-trees',

    name:
      'Varrock West Trees',

    profession:
      'woodcutting',

    x:
      3161,

    z:
      3471,

    tolerance:
      3,

    minLevel:
      1,

    resource:
      'tree',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^tree$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'draynor-willows',

    name:
      'Draynor Willows',

    profession:
      'woodcutting',

    x:
      3091,

    z:
      3225,

    tolerance:
      3,

    minLevel:
      30,

    resource:
      'willow',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(willow|willow tree)$/i,

    maxNodes:
      10,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'draynor-oaks',

    name:
      'Draynor Oaks',

    profession:
      'woodcutting',

    x:
      3101,

    z:
      3243,

    tolerance:
      3,

    minLevel:
      15,

    resource:
      'oak',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    /*
     * The exact world object naming is handled by the
     * woodcutting implementation. Keep the route broad enough
     * to discover Oak / Oak tree objects.
     */
    nodePattern:
      /^oak(?: tree)?$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'edgeville-yews',

    name:
      'Edgeville Yews',

    profession:
      'woodcutting',

    x:
      3087,

    z:
      3476,

    tolerance:
      3,

    minLevel:
      60,

    resource:
      'yew',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^yew tree$/i,

    maxNodes:
      10,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'varrock-palace-yews',

    name:
      'Varrock Palace Yews',

    profession:
      'woodcutting',

    x:
      3222,

    z:
      3503,

    tolerance:
      3,

    minLevel:
      60,

    resource:
      'yew',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^yew tree$/i,

    maxNodes:
      10,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'seers-maples',

    name:
      'Seers Maples',

    profession:
      'woodcutting',

    x:
      2727,

    z:
      3481,

    tolerance:
      3,

    minLevel:
      45,

    resource:
      'maple',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^maple tree$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'seers-willows',

    name:
      'Seers Willows',

    profession:
      'woodcutting',

    x:
      2712,

    z:
      3471,

    tolerance:
      3,

    minLevel:
      30,

    resource:
      'willow',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(willow|willow tree)$/i,

    maxNodes:
      10,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'catherby-yews',

    name:
      'Catherby Yews',

    profession:
      'woodcutting',

    x:
      2758,

    z:
      3431,

    tolerance:
      3,

    minLevel:
      60,

    resource:
      'yew',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^yew tree$/i,

    maxNodes:
      10,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  /* ==============================================================
   * MINING
   * ============================================================== */

  {
    id:
      'varrock-copper',

    name:
      'Varrock Copper',

    profession:
      'mining',

    x:
      3289,

    z:
      3363,

    tolerance:
      3,

    minLevel:
      1,

    resource:
      'copper',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^Rocks copper ore$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'varrock-east',

    name:
      'Varrock East Mine',

    profession:
      'mining',

    x:
      3281,

    z:
      3363,

    tolerance:
      3,

    minLevel:
      1,

    resource:
      'copper',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks copper ore|Rocks tin ore)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'lumbridge-swamp',

    name:
      'Lumbridge Swamp Mine',

    profession:
      'mining',

    x:
      3226,

    z:
      3144,

    tolerance:
      3,

    minLevel:
      1,

    resource:
      'copper',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks copper ore|Rocks tin ore|Rocks iron ore)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'rimmington',

    name:
      'Rimmington Mine',

    profession:
      'mining',

    x:
      2981,

    z:
      3233,

    tolerance:
      3,

    minLevel:
      1,

    resource:
      'copper',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks copper ore|Rocks tin ore|Rocks iron ore)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'falador',

    name:
      'Falador Mine',

    profession:
      'mining',

    x:
      2906,

    z:
      3362,

    tolerance:
      3,

    minLevel:
      15,

    resource:
      'iron',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks iron ore|Rocks coal|Rocks mithril ore)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'al-kharid',

    name:
      'Al Kharid Mine',

    profession:
      'mining',

    x:
      3298,

    z:
      3298,

    tolerance:
      3,

    minLevel:
      15,

    resource:
      'iron',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks iron ore|Rocks silver ore|Rocks coal)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'crafting-guild',

    name:
      'Crafting Guild Mine',

    profession:
      'mining',

    x:
      2933,

    z:
      3285,

    tolerance:
      3,

    minLevel:
      40,

    resource:
      'gold',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks gold ore|Rocks silver ore|Rocks coal)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'mining-guild',

    name:
      'Mining Guild',

    profession:
      'mining',

    x:
      3021,

    z:
      3338,

    tolerance:
      3,

    minLevel:
      30,

    resource:
      'coal',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'locs',

    nodePattern:
      /^(Rocks coal|Rocks mithril ore)$/i,

    maxNodes:
      12,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  /* ==============================================================
   * FISHING
   * ============================================================== */

  {
    id:
      'draynor-fishing',

    name:
      'Draynor Fishing',

    profession:
      'fishing',

    x:
      3087,

    z:
      3227,

    tolerance:
      3,

    minLevel:
      1,

    method:
      'net',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'lumbridge-swamp-fishing',

    name:
      'Lumbridge Swamp Fishing',

    profession:
      'fishing',

    x:
      3240,

    z:
      3150,

    tolerance:
      3,

    minLevel:
      1,

    method:
      'net',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'lumbridge-river',

    name:
      'Lumbridge River',

    profession:
      'fishing',

    x:
      3240,

    z:
      3290,

    tolerance:
      3,

    minLevel:
      5,

    method:
      'bait',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'barbarian-village',

    name:
      'Barbarian Village Fishing',

    profession:
      'fishing',

    x:
      3109,

    z:
      3433,

    tolerance:
      3,

    minLevel:
      1,

    method:
      'bait',

    bankId:
      'varrock-west-bank',

    bank: {
      name:
        'Varrock West Bank',

      x:
        3185,

      z:
        3436,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'catherby-fishing',

    name:
      'Catherby Fishing',

    profession:
      'fishing',

    x:
      2855,

    z:
      3430,

    tolerance:
      3,

    minLevel:
      1,

    method:
      'net',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'fishing-guild',

    name:
      'Fishing Guild',

    profession:
      'fishing',

    x:
      2611,

    z:
      3394,

    tolerance:
      3,

    minLevel:
      68,

    method:
      'net',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'karamja-lobsters',

    name:
      'Karamja Lobsters',

    profession:
      'fishing',

    x:
      2925,

    z:
      3175,

    tolerance:
      3,

    minLevel:
      40,

    method:
      'cage',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },

  {
    id:
      'seers-fishing',

    name:
      'Seers Fishing',

    profession:
      'fishing',

    x:
      2722,

    z:
      3528,

    tolerance:
      3,

    minLevel:
      1,

    method:
      'bait',

    bankId:
      'draynor-bank',

    bank: {
      name:
        'Draynor Bank',

      x:
        3093,

      z:
        3244,

      tolerance:
        5,
    },

    nodeType:
      'npcs',

    nodePattern:
      /fishing spot/i,

    maxNodes:
      8,

    scanRadius:
      15,

    rebuildAfterMisses:
      3,

    inventoryThreshold:
      26,
  },
];

/* ================================================================
 * GENERIC GATHER SCRIPT
 * ================================================================ */

registerScript(
  {
    name:
      'gather',

    description:
      'Generic deterministic or intelligent gathering controller for Woodcutting, Mining, and Fishing. An explicit registered location/resource/method is authoritative; when location is omitted the script automatically selects a suitable training location based on skill level.',

    params: {
      profession:
        'string — woodcutting | mining | fishing',

      location:
        'string — optional registered gathering location ID. When supplied, this location is authoritative and is not rejected merely because the player level is higher than the normal training range.',

      resource:
        'string — optional explicit resource override',

      method:
        'string — optional fishing method: net | bait | fly | lure | cage | harpoon',

      target:
        'string — optional fishing target',

      maxCycles:
        'number — optional number of gathering cycles; 0 or omitted means continuous',
    },

    preconditions: [
      'in_game',
    ],

    postconditions: [
      'continuous_gathering_started',
    ],

    failureModes: [
      'invalid_profession',
      'no_training_location',
      'level_too_low',
      'equipment_missing',
      'resource_nodes_not_found',
      'bank_unreachable',
      'interaction_failed',
      'danger_detected',
      'low_hp',
      'cancelled',
      'timeout',
    ],

    category:
      'gathering',

    verified:
      true,

    version:
      2,
  },

  async (
    params:
      Record<string, unknown>,

    ctx:
      ScriptContext,
  ): Promise<ScriptResult> => {
    const profession =
      String(
        params.profession ??
          '',
      )
        .trim()
        .toLowerCase();

    if (
      profession !==
        'woodcutting' &&
      profession !==
        'mining' &&
      profession !==
        'fishing'
    ) {
      return {
        success:
          false,

        message:
          `Invalid gathering profession: ${
            profession ||
            '(missing)'
          }`,

        data: {
          reason:
            'invalid_profession',

          allowed: [
            'woodcutting',
            'mining',
            'fishing',
          ],
        },
      };
    }

    /*
     * ------------------------------------------------------------
     * CONNECT / READ LEVEL
     * ------------------------------------------------------------
     */

    /*
     * GatheringCore owns the actual SDK adapter. We therefore use
     * its state through the context only for location selection.
     *
     * The final preparation/gathering controller reconnects through
     * the shared adapter.
     */
    const adapter =
      ctx.adapter as any;

    if (
      !adapter
    ) {
      return {
        success:
          false,

        message:
          'Gathering requires a shared RS-SDK adapter.',

        data: {
          reason:
            'adapter_missing',
        },
      };
    }

    if (
      typeof adapter.connect ===
        'function'
    ) {
      await adapter.connect();
    }

    /*
     * ------------------------------------------------------------
     * REQUESTED LOCATION
     * ------------------------------------------------------------
     *
     * THIS IS THE IMPORTANT CHANGE.
     *
     * If the caller gives a location explicitly, that location wins.
     *
     * We do NOT ask the level selector whether it is appropriate.
     *
     * Example:
     *
     *   profession = woodcutting
     *   location   = draynor-oaks
     *   resource   = oak
     *
     * At Woodcutting level 89 this is still valid.
     */
    const requestedLocation =
      String(
        params.location ??
          '',
      )
        .trim()
        .toLowerCase();

    let selected:
      TrainingLocation |
      undefined;

    if (
      requestedLocation
    ) {
      selected =
        TRAINING_LOCATIONS.find(
          (
            location,
          ) =>
            location.profession ===
              profession &&
            (
              location.id
                .toLowerCase() ===
              requestedLocation
            ),
        );

      if (
        !selected
      ) {
        return {
          success:
            false,

          message:
            `No ${profession} gathering location is registered as "${requestedLocation}".`,

          data: {
            reason:
              'no_training_location',

            profession,

            requestedLocation,
          },
        };
      }

      console.log(
        `[Gather] Using explicitly requested location: ${selected.name}`,
      );
    } else {
      /*
       * ----------------------------------------------------------
       * AUTOMATIC LOCATION SELECTION
       * ----------------------------------------------------------
       */

      const state =
        adapter.getState?.();

      const player =
        state?.player as any;

      if (
        !player
      ) {
        return {
          success:
            false,

          message:
            'Player state unavailable while selecting gathering location.',

          data: {
            reason:
              'state_unavailable',
          },
        };
      }

      const skill =
        getSkillLevel(
          adapter,
          profession,
        );

      if (
        skill ===
        null
      ) {
        return {
          success:
            false,

          message:
            `Could not determine ${profession} level.`,

          data: {
            reason:
              'skill_not_found',

            profession,
          },
        };
      }

      console.log(
        `[Gather] ${profession} level: ${skill}`,
      );

      selected =
        selectAutomaticLocation(
          profession,
          skill,
          Number(
            player.worldX ??
              0,
          ),
          Number(
            player.worldZ ??
              0,
          ),
        );

      if (
        !selected
      ) {
        return {
          success:
            false,

          message:
            `No suitable ${profession} training location is registered for level ${skill}.`,

          data: {
            reason:
              'no_training_location',

            profession,

            level:
              skill,
          },
        };
      }

      console.log(
        `[Gather] Selected training location: ${selected.id}`,
      );
    }

    /*
     * ------------------------------------------------------------
     * EFFECTIVE PARAMETERS
     * ------------------------------------------------------------
     *
     * Explicit params override the preset.
     */
    const effectiveResource =
      String(
        params.resource ??
          selected.resource ??
          '',
      )
        .trim()
        .toLowerCase();

    const effectiveMethod =
      String(
        params.method ??
          selected.method ??
          defaultFishingMethod(
            profession,
          ),
      )
        .trim()
        .toLowerCase();

    const effectiveTarget =
      String(
        params.target ??
          '',
      ).trim();

    console.log(
      `[Gather] Resource: ${
        effectiveResource ||
        selected.resource ||
        selected.name
      }`,
    );

    /*
     * ------------------------------------------------------------
     * GATHERING CORE CONFIGURATION
     * ------------------------------------------------------------
     */

    const gatherParams:
      Record<string, unknown> = {
      location:
        selected.id,

      resource:
        effectiveResource,

      method:
        effectiveMethod,

      target:
        effectiveTarget,
    };

    /*
     * The profession-specific gathering scripts can use these
     * parameters where appropriate.
     */
    if (
      profession ===
      'woodcutting'
    ) {
      gatherParams.resource =
        effectiveResource ||
        'tree';
    }

    if (
      profession ===
      'mining'
    ) {
      gatherParams.resource =
        effectiveResource ||
        'copper';
    }

    if (
      profession ===
      'fishing'
    ) {
      gatherParams.method =
        effectiveMethod;
    }

    const result =
      await runGatheringCore(
        {
          profession:
            profession as
              | 'woodcutting'
              | 'mining'
              | 'fishing',

          taskName:
            `Gather ${profession} at ${selected.name}`,

          bank:
            selected.bank,

          resource: {
            name:
              selected.name,

            x:
              selected.x,

            z:
              selected.z,

            tolerance:
              selected.tolerance,
          },

          prepareScript:
            getPreparationScript(
              profession,
            ),

          prepareParams:
            getPreparationParams(
              profession,
              selected,
              gatherParams,
            ),

          gatherScript:
            getGatherScript(
              profession,
            ),

          gatherParams,

          inventoryThreshold:
            selected.inventoryThreshold,

          dangerousNpcPattern:
            selected.dangerousNpcPattern,

          nodeRoute: {
            enabled:
              true,

            nodeType:
              selected.nodeType,

            nodePattern:
              selected.nodePattern,

            scanRadius:
              selected.scanRadius ??
              15,

            maxNodes:
              selected.maxNodes ??
              12,

            rebuildAfterMisses:
              selected.rebuildAfterMisses ??
              3,
          },

          maxCycles:
            parseMaxCycles(
              params.maxCycles,
            ),

          cancelSignal:
            ctx.cancelSignal,
        },

        ctx,
      );

    return result;
  },
);

/* ================================================================
 * AUTOMATIC LOCATION SELECTION
 * ================================================================ */

function selectAutomaticLocation(
  profession:
    'woodcutting' |
    'mining' |
    'fishing',

  level:
    number,

  playerX:
    number,

  playerZ:
    number,
): TrainingLocation | undefined {
  const candidates =
    TRAINING_LOCATIONS
      .filter(
        (
          location,
        ) =>
          location.profession ===
            profession &&
          level >=
            location.minLevel,
      )
      .sort(
        (
          a,
          b,
        ) => {
          /*
           * Prefer the highest available training tier, but among
           * equally suitable locations prefer the closest one.
           */
          const levelDifference =
            b.minLevel -
            a.minLevel;

          if (
            levelDifference !==
            0
          ) {
            return levelDifference;
          }

          const distanceA =
            Math.hypot(
              playerX -
                a.x,
              playerZ -
                a.z,
            );

          const distanceB =
            Math.hypot(
              playerX -
                b.x,
              playerZ -
                b.z,
            );

          return (
            distanceA -
            distanceB
          );
        },
      );

  return (
    candidates[0] ??
    undefined
  );
}

/* ================================================================
 * SKILL LEVEL
 * ================================================================ */

function getSkillLevel(
  adapter:
    any,

  profession:
    'woodcutting' |
    'mining' |
    'fishing',
): number | null {
  const skill =
    adapter.getSkill?.(
      profession,
    );

  if (
    skill
  ) {
    const level =
      Number(
        skill.level ??
          skill.currentLevel ??
          0,
      );

    if (
      Number.isFinite(
        level,
      ) &&
      level > 0
    ) {
      return level;
    }
  }

  const state =
    adapter.getState?.();

  const skills =
    state?.skills;

  const entry =
    skills?.[
      profession
    ];

  if (
    entry
  ) {
    const level =
      Number(
        entry.level ??
          entry.currentLevel ??
          0,
      );

    if (
      Number.isFinite(
        level,
      ) &&
      level > 0
    ) {
      return level;
    }
  }

  return null;
}

/* ================================================================
 * SCRIPT SELECTION
 * ================================================================ */

function getPreparationScript(
  profession:
    'woodcutting' |
    'mining' |
    'fishing',
): string {
  switch (
    profession
  ) {
    case 'woodcutting':
      return 'ensure_woodcutting_tool';

    case 'mining':
      return 'ensure_mining_tool';

    case 'fishing':
      return 'ensure_fishing_tool';
  }
}

function getPreparationParams(
  profession:
    'woodcutting' |
    'mining' |
    'fishing',

  location:
    TrainingLocation,

  gatherParams:
    Record<string, unknown>,
): Record<string, unknown> {
  switch (
    profession
  ) {
    case 'woodcutting':
      return {
        location:
          location.id,

        resource:
          gatherParams.resource,
      };

    case 'mining':
      return {
        location:
          location.id,

        resource:
          gatherParams.resource,
      };

    case 'fishing':
      return {
        location:
          location.id,

        method:
          gatherParams.method,
      };
  }
}

function getGatherScript(
  profession:
    'woodcutting' |
    'mining' |
    'fishing',
): string {
  switch (
    profession
  ) {
    case 'woodcutting':
      /*
       * Gather Core passes targetX/targetZ into gather_wood.
       */
      return 'gather_wood';

    case 'mining':
      /*
       * Gather Core passes targetX/targetZ into gather_ore.
       */
      return 'gather_ore';

    case 'fishing':
      /*
       * Gather Core passes targetX/targetZ into
       * use_fishing_script.
       */
      return 'use_fishing_script';
  }
}

/* ================================================================
 * DEFAULT FISHING METHOD
 * ================================================================ */

function defaultFishingMethod(
  profession:
    'woodcutting' |
    'mining' |
    'fishing',
): string {
  if (
    profession ===
    'fishing'
  ) {
    return 'net';
  }

  return '';
}

/* ================================================================
 * MAX CYCLES
 * ================================================================ */

function parseMaxCycles(
  value:
    unknown,
): number | undefined {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ''
  ) {
    return undefined;
  }

  const parsed =
    Number(
      value,
    );

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return undefined;
  }

  return Math.max(
    0,
    Math.floor(
      parsed,
    ),
  );
}
