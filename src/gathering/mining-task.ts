import {
  runGatheringCore,
} from "./gathering-core.js";

import type {
  ScriptContext,
} from "../scripts/types.js";

export async function runMiningTask(
  ctx: ScriptContext,
  options: {
    bankX: number;
    bankZ: number;

    resourceX: number;
    resourceZ: number;

    resource:
      | "copper"
      | "tin"
      | "iron"
      | "coal"
      | "silver"
      | "gold"
      | "mithril"
      | "adamantite";

    inventoryThreshold?: number;
  },
) {
  return runGatheringCore(
    {
      profession:
        "mining",

      taskName:
        `Mining — ${options.resource}`,

      bank: {
        name:
          "Mining Bank",

        x:
          options.bankX,

        z:
          options.bankZ,

        tolerance:
          5,
      },

      resource: {
        name:
          `${options.resource} mining area`,

        x:
          options.resourceX,

        z:
          options.resourceZ,

        tolerance:
          5,
      },

      prepareScript:
        "ensure_mining_tool",

      prepareParams: {
        location:
          "mining-task",
      },

      gatherScript:
        "gather_ore",

      gatherParams: {
        location:
          "mining-task",

        resource:
          options.resource,
      },

      inventoryThreshold:
        options.inventoryThreshold ??
        26,

      nodeRoute: {
        enabled:
          true,

        nodeType:
          "locs",

        scanRadius:
          15,

        maxNodes:
          20,

        nodePattern:
          new RegExp(
            `^Rocks ${options.resource} ore$`,
            "i",
          ),

        rebuildAfterMisses:
          3,
      },

      hpStopPercent:
        0.50,

      maxCycles:
        0,
    },

    ctx,
  );
}
