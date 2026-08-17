import {
  runWoodcuttingTask,
} from "./gathering/woodcutting-task.js";

import {
  config,
} from "./config/index.js";

async function main(): Promise<void> {
  const context = {
    accountId:
      config.bot.name,

    sdkBaseUrl:
      config.rs_sdk.baseUrl,

    sdkBotName:
      config.bot.name,

    sdkBotPassword:
      config.bot.password,
  };

  console.log("");
  console.log("================================");
  console.log(" GATHERING CORE TEST");
  console.log(" WOODCUTTING — VARROCK WEST");
  console.log("================================");

  console.log("");
  console.log(
    "[Core Test] Bank: Varrock West (3185, 3436)",
  );

  console.log(
    "[Core Test] Resource: Varrock West trees (3180, 3430)",
  );

  console.log(
    "[Core Test] Running one gathering cycle...",
  );

  const result =
    await runWoodcuttingTask(
      context,
      {
        bankX:
          3185,

        bankZ:
          3436,

        resourceX:
          3180,

        resourceZ:
          3430,

        resource:
          "tree",

        inventoryThreshold:
          26,
      },
    );

  console.log("");
  console.log("================================");
  console.log(" CORE RESULT");
  console.log("================================");

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  if (!result.success) {
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    process.exit(
      process.exitCode ?? 0,
    );
  })
  .catch((error) => {
    console.error("");
    console.error(
      "================================",
    );
    console.error(
      " GATHERING CORE TEST FAILED",
    );
    console.error(
      "================================",
    );

    console.error(
      error instanceof Error
        ? error.message
        : String(error),
    );

    process.exitCode = 1;
  });
