import type {
  Phase1Command,
} from './phase1-executor.js';

import {
  getTravelDestination,
  getGatheringPreset,
} from './phase1.js';

export function resolvePhase1Command(
  goal:
    string,
): Phase1Command | null {
  const normalized =
    goal
      .trim()
      .toLowerCase();

  /*
   * ------------------------------------------------------------
   * STOP
   * ------------------------------------------------------------
   */
  if (
    normalized ===
      'stop' ||
    normalized ===
      'cancel'
  ) {
    return {
      type:
        'stop',
    };
  }

  /*
   * ------------------------------------------------------------
   * TRAVEL
   * ------------------------------------------------------------
   */
  if (
    normalized.startsWith(
      'travel:',
    )
  ) {
    const id =
      normalized
        .slice(
          'travel:'.length,
        )
        .trim();

    if (
      getTravelDestination(
        id,
      )
    ) {
      return {
        type:
          'travel',

        destinationId:
          id,
      };
    }

    return null;
  }

  /*
   * ------------------------------------------------------------
   * GATHER
   * ------------------------------------------------------------
   */
  if (
    normalized.startsWith(
      'gather:',
    )
  ) {
    const id =
      normalized
        .slice(
          'gather:'.length,
        )
        .trim();

    if (
      getGatheringPreset(
        id,
      )
    ) {
      return {
        type:
          'gather',

        presetId:
          id,
      };
    }

    return null;
  }

  return null;
}
