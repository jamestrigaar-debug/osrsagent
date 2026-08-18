import "../src/scripts/index.js";
import { executeScript } from "./scripts/executor.js";
import { config } from "./config/index.js";

async function main(): Promise<void> {
  const scriptName = "ensure_woodcutting_tool";

  const context = {
    accountId: config.bot.name,

    sdkBaseUrl:
      config.rs_sdk.baseUrl,

    sdkBotName:
      config.bot.name,

    sdkBotPassword:
      config.bot.password,
  };

  console.log("");
  console.log("================================");
  console.log(" WOODCUTTING TOOL TEST");
  console.log("================================");

  console.log("");
  console.log(
    "[Tool Test] Account:",
    context.accountId,
  );

  console.log(
    "[Tool Test] Script:",
    scriptName,
  );

  console.log(
    "[Tool Test] SDK server:",
    context.sdkBaseUrl,
  );

  console.log("");
  console.log(
    "[Tool Test] Loading registered scripts...",
  );

  console.log(
    "[Tool Test] Executing registered capability...",
  );

  const result =
    await executeScript(
      scriptName,
      {
        location:
          "varrock-west",
      },
      context,
    );

  console.log("");
  console.log("================================");
  console.log(" RESULT");
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

main().catch((error) => {
  console.error("");
  console.error(
    "================================",
  );
  console.error(
    " TOOL TEST FAILED",
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
