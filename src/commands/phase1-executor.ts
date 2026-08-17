import type {
  ActivePlan,
} from '../memory/types.js';

import {
  getTravelDestination,
  getGatheringPreset,
} from './phase1.js';

export type Phase1Command =
  | {
      type: 'travel';

      destinationId:
        string;
    }
  | {
      type: 'gather';

      presetId:
        string;
    }
  | {
      type: 'stop';
    };

/* ================================================================
 * BUILD PHASE 1 PLAN
 * ================================================================ */

export function buildPhase1Plan(
  command:
    Phase1Command,
): ActivePlan | null {
  switch (
    command.type
  ) {
    case 'travel':
      return buildTravelPlan(
        command.destinationId,
      );

    case 'gather':
      return buildGatherPlan(
        command.presetId,
      );

    case 'stop':
      return null;

    default:
      return null;
  }
}

/* ================================================================
 * TRAVEL PLAN
 * ================================================================ */

function buildTravelPlan(
  destinationId:
    string,
): ActivePlan | null {
  const destination =
    getTravelDestination(
      destinationId,
    );

  if (
    !destination
  ) {
    return null;
  }

  return {
    planId:
      `phase1-travel-${destination.id}`,

    goal:
      `Travel to ${destination.name}`,

    currentStepIndex:
      0,

    createdAt:
      Date.now(),

    /*
     * Phase 1 plans do not dynamically resolve missing capabilities.
     * The deterministic script execution path handles failures.
     */
    onMissingCapability:
      undefined as never,

    steps: [
      {
        script:
          'travel_to',

        params: {
          location:
            `${destination.x},${destination.z}`,

          tolerance:
            destination.tolerance,

          announce:
            true,

          message:
            `Travel completed: ${destination.name}`,
        },
      },
    ],
  };
}

/* ================================================================
 * GATHER PLAN
 * ================================================================ */

function buildGatherPlan(
  presetId:
    string,
): ActivePlan | null {
  const preset =
    getGatheringPreset(
      presetId,
    );

  if (
    !preset
  ) {
    return null;
  }

  const destination =
    getTravelDestination(
      preset.locationId,
    );

  if (
    !destination
  ) {
    return null;
  }

  const gatherParams:
    Record<string, unknown> = {
    profession:
      preset.profession,

    location:
      preset.locationId,
  };

  if (
    preset.resource !==
    undefined
  ) {
    gatherParams.resource =
      preset.resource;
  }

  if (
    preset.method !==
    undefined
  ) {
    gatherParams.method =
      preset.method;
  }

  if (
    preset.target !==
    undefined
  ) {
    gatherParams.target =
      preset.target;
  }

  return {
    planId:
      `phase1-gather-${preset.id}`,

    goal:
      preset.name,

    currentStepIndex:
      0,

    createdAt:
      Date.now(),

    onMissingCapability:
      undefined as never,

    /*
     * Do not use loopUntil here.
     *
     * The gather script itself is the long-running operation.
     * Once the Dispatcher reaches this step, gathering continues
     * until it is cancelled/stopped or encounters a terminal error.
     */
    steps: [
      {
        script:
          'travel_to',

        params: {
          location:
            `${destination.x},${destination.z}`,

          tolerance:
            destination.tolerance,

          announce:
            true,

          message:
            `Travel completed: ${destination.name}`,
        },
      },

      {
        script:
          'gather',

        params:
          gatherParams,
      },
    ],
  };
}
