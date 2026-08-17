import {
  RsSdkAdapter,
} from "./adapters/rs-sdk.js";

import {
  config,
} from "./config/index.js";

type TestMode =
  | "fishing"
  | "mining"
  | "woodcutting";

function fail(
  message: string,
): never {
  throw new Error(message);
}

function usage(): never {
  console.error(`
Usage:

  npx tsx src/test-adapter.ts fishing [method]
  npx tsx src/test-adapter.ts mining [resource]
  npx tsx src/test-adapter.ts woodcutting [resource]

Examples:

  npx tsx src/test-adapter.ts fishing net
  npx tsx src/test-adapter.ts mining copper
  npx tsx src/test-adapter.ts mining tin
  npx tsx src/test-adapter.ts mining iron
  npx tsx src/test-adapter.ts woodcutting tree
  npx tsx src/test-adapter.ts woodcutting oak
`);

  process.exit(1);
}


async function main(): Promise<void> {
  const mode =
    process.argv[2] as TestMode | undefined;

  const target =
    process.argv[3];

  if (
    mode !== "fishing" &&
    mode !== "mining" &&
    mode !== "woodcutting"
  ) {
    usage();
  }

  const adapter =
    new RsSdkAdapter({
      server:
        config.rs_sdk.baseUrl,

      botName:
        config.bot.name,

      password:
        config.bot.password,
    });

  try {
    console.log("");
    console.log(
      "================================",
    );
    console.log(
      ` ${mode.toUpperCase()} ADAPTER TEST`,
    );
    console.log(
      "================================",
    );

    console.log(
      "[Adapter Test] Connecting...",
    );

    await adapter.connect();

    console.log(
      "[Adapter Test] Connected.",
    );

    const state =
      adapter.getState();

    if (!state) {
      fail(
        "No game state received.",
      );
    }

    const player =
      state.player as any;

    console.log("");
    console.log(
      "[Adapter Test] Player:",
    );

    console.log({
      name:
        player?.name,
      worldX:
        player?.worldX,
      worldZ:
        player?.worldZ,
      level:
        player?.level,
      hp:
        player?.hp,
      maxHp:
        player?.maxHp,
      inCombat:
        player?.combat?.inCombat,
    });

    if (
      player?.combat?.inCombat
    ) {
      fail(
        "Player is in combat; refusing gathering test.",
      );
    }

    const inventory =
      adapter.getInventory();

    const equipment =
      adapter.getEquipment();

    console.log("");
    console.log(
      "[Adapter Test] Inventory:",
    );
    console.log(
      inventory.map(
        (item: any) => ({
          name:
            item.name,
          count:
            item.count,
          slot:
            item.slot,
        }),
      ),
    );

    console.log("");
    console.log(
      "[Adapter Test] Equipment:",
    );
    console.log(
      equipment.map(
        (item: any) => ({
          name:
            item.name,
          count:
            item.count,
          slot:
            item.slot,
        }),
      ),
    );

    /* ============================================================
     * FISHING
     * ============================================================ */

    if (
      mode === "fishing"
    ) {
      const method =
        target ??
        "net";

      const fishingSpots =
        adapter
          .getNearbyNpcs()
          .filter(
            (npc: any) =>
              typeof npc?.name ===
                "string" &&
              /fishing spot/i.test(
                npc.name,
              ),
          );

      console.log("");
      console.log(
        `[Fishing Test] Fishing spots found: ${fishingSpots.length}`,
      );

      if (
        fishingSpots.length === 0
      ) {
        fail(
          "No fishing spot NPC found nearby.",
        );
      }

      console.log(
        fishingSpots.map(
          (npc: any) => ({
            name:
              npc.name,
            x:
              npc.x,
            z:
              npc.z,
            options:
              npc.optionsWithIndex,
          }),
        ),
      );

      console.log("");
      console.log(
        `[Fishing Test] Attempting method: ${method}`,
      );

      const result =
        await adapter.fish(
          method,
        );

      console.log("");
      console.log(
        "[Fishing Test] Result:",
      );

      console.log(
        JSON.stringify(
          result,
          null,
          2,
        ),
      );

      if (
        !result.success
      ) {
        fail(
          result.message,
        );
      }

      return;
    }

    /* ============================================================
     * MINING
     * ============================================================ */

    if (
      mode === "mining"
    ) {
      const resource =
        target ??
        "copper";

      /*
       * Mining requires a pickaxe.
       */
      const hasPickaxe =
        [
          ...inventory,
          ...equipment,
        ].some(
          (item: any) =>
            typeof item?.name ===
              "string" &&
            /pickaxe/i.test(
              item.name,
            ),
        );

      console.log("");
      console.log(
        `[Mining Test] Pickaxe check: ${
          hasPickaxe
            ? "PASS"
            : "FAIL"
        }`,
      );

      if (
        !hasPickaxe
      ) {
        fail(
          "No pickaxe available for mining.",
        );
      }

      const mineable =
        adapter
          .getNearbyLocs()
          .filter(
            (loc: any) =>
              typeof loc?.name ===
                "string" &&
              /rock|ore/i.test(
                loc.name,
              ),
          )
          .filter(
            (loc: any) =>
              !/rocking chair/i.test(
                loc.name,
              ),
          )
          .slice(
            0,
            25,
          );

      console.log("");
      console.log(
        "[Mining Test] Nearby mineable objects:",
      );

      console.log(
        mineable.map(
          (loc: any) => ({
            name:
              loc.name,
            x:
              loc.x,
            z:
              loc.z,
            options:
              loc.optionsWithIndex,
          }),
        ),
      );

      if (
        mineable.length === 0
      ) {
        fail(
          "No mineable rocks found nearby.",
        );
      }

      console.log("");
      console.log(
        `[Mining Test] Attempting to mine: ${resource}`,
      );

      const result =
        await adapter.mine(
          resource,
        );

      console.log("");
      console.log(
        "[Mining Test] Result:",
      );

      console.log(
        JSON.stringify(
          result,
          null,
          2,
        ),
      );

      if (
        !result.success
      ) {
        fail(
          result.message,
        );
      }

      return;
    }

    /* ============================================================
     * WOODCUTTING
     * ============================================================ */

    if (
      mode === "woodcutting"
    ) {
      const resource =
        target ??
        "tree";

      /*
       * THIS IS THE IMPORTANT CHECK.
       *
       * An axe in either inventory OR equipment satisfies the
       * Woodcutting capability.
       *
       * We deliberately do NOT equip it automatically.
       */
      const axe =
        [
          ...inventory,
          ...equipment,
        ].find(
          (item: any) =>
            typeof item?.name ===
              "string" &&
            /\baxe\b/i.test(
              item.name,
            ),
        );

      console.log("");
      console.log(
        "[Woodcutting Test] Axe check:",
        axe
          ? `PASS — ${axe.name}`
          : "FAIL — no axe found",
      );

      if (!axe) {
        console.log("");
        console.log(
          "================================",
        );
        console.log(
          " WOODCUTTING PRECONDITION FAILED",
        );
        console.log(
          "================================",
        );
        console.log(
          "An axe is required before chopping.",
        );
        console.log(
          "The test will NOT attempt to chop.",
        );

        return;
      }

      const trees =
        adapter
          .getNearbyLocs()
          .filter(
            (loc: any) =>
              typeof loc?.name ===
                "string" &&
              /^(tree|oak|willow|maple|yew|magic)$/i.test(
                loc.name,
              ),
          )
          .filter(
            (loc: any) =>
              !/stump/i.test(
                loc.name,
              ),
          )
          .slice(
            0,
            25,
          );

      console.log("");
      console.log(
        "[Woodcutting Test] Nearby trees:",
      );

      console.log(
        trees.map(
          (loc: any) => ({
            name:
              loc.name,
            x:
              loc.x,
            z:
              loc.z,
            options:
              loc.optionsWithIndex,
          }),
        ),
      );

      if (
        trees.length === 0
      ) {
        fail(
          "No woodcutting trees found nearby.",
        );
      }

      console.log("");
      console.log(
        `[Woodcutting Test] Attempting to chop: ${resource}`,
      );

      const result =
        await adapter.chopTree(
          resource,
        );

      console.log("");
      console.log(
        "[Woodcutting Test] Result:",
      );

      console.log(
        JSON.stringify(
          result,
          null,
          2,
        ),
      );

      if (
        !result.success
      ) {
        fail(
          result.message,
        );
      }

      return;
    }
  } finally {
    console.log("");
    console.log(
      "[Adapter Test] Disconnecting...",
    );

    await adapter.disconnect();

    console.log(
      "[Adapter Test] Disconnected.",
    );
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("");
    console.error(
      "================================",
    );
    console.error(
      " ADAPTER TEST FAILED",
    );
    console.error(
      "================================",
    );

    console.error(
      error instanceof Error
        ? error.message
        : String(error),
    );

    process.exit(1);
  });
