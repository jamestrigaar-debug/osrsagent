import { registerScript } from '../registry.js';

import type {
  ScriptContext,
  ScriptResult,
} from '../types.js';

import {
  runGathering,
} from '../../gathering/gather.js';

registerScript(
  {
    name:
      "gather",

    description:
      "Automatically train Woodcutting, Mining, or Fishing. Checks the player's level, selects a suitable training location and resource, acquires required equipment, builds a persistent resource route, banks when necessary, and continues until cancelled.",

    params: {
      profession:
        'string — woodcutting | mining | fishing',

      location:
        'string — optional training location; omit to automatically select the best suitable location',

      resource:
        'string — optional resource override',

      method:
        'string — optional fishing method such as net | bait | fly | cage | harpoon',
    },

    preconditions: [
      "in_game",
    ],

    postconditions: [
      "continuous_gathering_started",
    ],

    failureModes: [
      "invalid_profession",
      "no_training_location",
      "level_too_low",
      "equipment_missing",
      "resource_nodes_not_found",
      "bank_unreachable",
      "interaction_failed",
      "danger_detected",
      "low_hp",
      "cancelled",
      "timeout",
    ],

    category:
      "gathering",

    verified:
      false,

    version:
      1,
  },

  async (
    params: Record<string, unknown>,
    ctx: ScriptContext,
  ): Promise<ScriptResult> => {
    const profession =
      String(
        params.profession ?? "",
      )
        .trim()
        .toLowerCase();

    if (
      profession !== "woodcutting" &&
      profession !== "mining" &&
      profession !== "fishing"
    ) {
      return {
        success:
          false,

        message:
          `Invalid gathering profession: ${profession || "(missing)"}`,

        data: {
          reason:
            "invalid_profession",

          allowed:
            [
              "woodcutting",
              "mining",
              "fishing",
            ],
        },
      };
    }

    return runGathering(
      {
        profession:
          profession as
            | "woodcutting"
            | "mining"
            | "fishing",

        location:
          params.location
            ? String(
                params.location,
              )
            : undefined,

        resource:
          params.resource
            ? String(
                params.resource,
              )
            : undefined,

        method:
          params.method
            ? String(
                params.method,
              )
            : undefined,
      },

      ctx,
    );
  },
);
