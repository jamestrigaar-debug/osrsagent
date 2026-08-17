import "./scripts/index.js";

import {
  executeScript,
} from "./scripts/executor.js";

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
  console.log(
    "================================",
  );
  console.log(
    " GENERIC GATHER TEST",
  );
  console.log(
    "================================",
  );

  console.log(
    "[Test] Starting generic Woodcutting gather...",
  );

  const result =
    await executeScript(
      "gather",
      {
        profession:
          "mining",
      },
      context,
    );

  console.log("");
  console.log(
    "================================",
  );
  console.log(
    " RESULT",
  );
  console.log(
    "================================",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  if (!result.success) {
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exitCode =
      1;
  },
);
