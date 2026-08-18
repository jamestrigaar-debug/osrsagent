import WebSocket from 'ws';

if (
  typeof globalThis.WebSocket === 'undefined'
) {
  globalThis.WebSocket =
    WebSocket as unknown as typeof globalThis.WebSocket;
}

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ScriptContext,
  ScriptResult,
} from '../scripts/types.js';

export interface RsSdkAdapterOptions {
  server: string;
  botName: string;
  password: string;
  showChat?: boolean;
}

type SDKModule = {
  BotSDK: new (
    options: Record<string, unknown>,
  ) => any;

  deriveGatewayUrl: (
    server?: string,
  ) => string;
};

type ActionsModule = {
  BotActions: new (
    sdk: any,
  ) => any;
};

type BotWorldState = Record<string, unknown>;

let sdkModulePromise:
  Promise<SDKModule> | null = null;

let actionsModulePromise:
  Promise<ActionsModule> | null = null;

/* ================================================================
 * RUNTIME SDK LOADING
 * ================================================================ */

async function loadSdkModule(): Promise<SDKModule> {
  if (!sdkModulePromise) {
    const sdkPath = join(
      process.cwd(),
      'node_modules',
      'server',
      'sdk',
      'index.ts',
    );

    sdkModulePromise = import(
      pathToFileURL(sdkPath).href
    ) as Promise<SDKModule>;
  }

  return sdkModulePromise;
}

async function loadActionsModule(): Promise<ActionsModule> {
  if (!actionsModulePromise) {
    const actionsPath = join(
      process.cwd(),
      'node_modules',
      'server',
      'sdk',
      'actions.ts',
    );

    actionsModulePromise = import(
      pathToFileURL(actionsPath).href
    ) as Promise<ActionsModule>;
  }

  return actionsModulePromise;
}

/* ================================================================
 * ADAPTER
 * ================================================================ */

export class RsSdkAdapter {
  private sdk: any = null;

  private bot: any = null;

  private readonly options: RsSdkAdapterOptions;

  private connected = false;

  constructor(
    options: RsSdkAdapterOptions,
  ) {
    this.options = options;
  }

  /* ================================================================
   * CONNECTION
   * ================================================================ */

  async connect(): Promise<void> {
    if (
      this.connected &&
      this.sdk?.isConnected?.()
    ) {
      return;
    }

    const {
      BotSDK,
      deriveGatewayUrl,
    } = await loadSdkModule();

    const {
      BotActions,
    } = await loadActionsModule();

    const gatewayUrl =
      deriveGatewayUrl(
        this.options.server,
      );

    this.sdk = new BotSDK({
      botUsername:
        this.options.botName,

      password:
        this.options.password,

      gatewayUrl,

      connectionMode:
        'control',

      autoReconnect:
        true,

      autoLaunchBrowser:
        false,

      showChat:
        this.options.showChat ??
        true,
    });

    this.bot =
      new BotActions(
        this.sdk,
      );

    try {
      await this.sdk.connect();

      await this.sdk.waitForReady(
        30_000,
      );

      this.connected = true;
    } catch (error) {
      this.connected = false;

      try {
        await this.sdk.disconnect();
      } catch {
        // Ignore cleanup failure.
      }

      this.sdk = null;
      this.bot = null;

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.sdk) {
      this.connected = false;
      return;
    }

    try {
      await this.sdk.disconnect();
    } finally {
      this.connected = false;
      this.sdk = null;
      this.bot = null;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (
      !this.connected ||
      !this.sdk?.isConnected?.()
    ) {
      await this.connect();
    }
  }

  isConnected(): boolean {
    return Boolean(
      this.sdk?.isConnected?.(),
    );
  }

  isAuthenticated(): boolean {
    return Boolean(
      this.sdk?.isAuthenticated?.(),
    );
  }

  /* ================================================================
   * STATE
   * ================================================================ */

  getState():
    BotWorldState | null {
    return (
      this.sdk?.getState?.() ??
      null
    );
  }

  getSkill(
    name: string,
  ): any | null {
    return (
      this.sdk?.getSkill?.(
        name,
      ) ??
      null
    );
  }

  getInventory(): any[] {
    return (
      this.sdk?.getInventory?.() ??
      []
    );
  }

  getEquipment(): any[] {
    return (
      this.sdk?.getEquipment?.() ??
      []
    );
  }

  getNearbyNpcs(): any[] {
    return (
      this.sdk?.getNearbyNpcs?.() ??
      []
    );
  }

  getNearbyLocs(): any[] {
    return (
      this.sdk?.getNearbyLocs?.() ??
      []
    );
  }

  getCoins(): number {
    const coins =
      this.getInventory().filter(
        (item: any) =>
          typeof item?.name === 'string' &&
          /^coins?$/i.test(
            item.name,
          ),
      );

    return coins.reduce(
      (
        total: number,
        item: any,
      ) =>
        total +
        Number(
          item?.count ?? 0,
        ),
      0,
    );
  }

  /* ================================================================
   * MOVEMENT
   * ================================================================ */

  async walkTo(
    x: number,
    z: number,
    tolerance = 3,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      const result =
        await this.bot.walkTo(
          x,
          z,
          tolerance,
        );

      return toScriptResult(
        result,
      );
    } catch (error) {
      return failure(
        'walkTo failed',
        error,
      );
    }
  }

  /* ================================================================
   * BANKING
   * ================================================================ */

  async openBank(): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      return toScriptResult(
        await this.bot.openBank(),
      );
    } catch (error) {
      return failure(
        'openBank failed',
        error,
      );
    }
  }

  async closeBank(): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      return toScriptResult(
        await this.bot.closeBank(),
      );
    } catch (error) {
      return failure(
        'closeBank failed',
        error,
      );
    }
  }

  isBankOpen(): boolean {
    return Boolean(
      this.sdk?.isBankOpen?.(),
    );
  }

  getBankItems(): any[] {
    return (
      this.sdk?.getBankItems?.() ??
      []
    );
  }

  findBankItem(
    pattern: string | RegExp,
  ): any | null {
    return (
      this.sdk?.findBankItem?.(
        pattern,
      ) ??
      null
    );
  }

  async bankAll(): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      let deposited = 0;

      for (
        let i = 0;
        i < 100 &&
        this.getInventory().length > 0;
        i++
      ) {
        const item =
          this.getInventory()[0];

        if (!item) {
          break;
        }

        const before =
          this.getInventory().length;

        const result =
          await this.bot.depositItem(
            item,
            -1,
          );

        if (!result.success) {
          return toScriptResult(
            result,
          );
        }

        await this.sdk.waitForTicks(
          1,
        );

        const after =
          this.getInventory().length;

        deposited +=
          Math.max(
            0,
            before - after,
          );

        if (after >= before) {
          return {
            success: false,

            message:
              `Deposit made no progress for ${item.name}`,

            data: {
              item:
                item.name,

              reason:
                'deposit_no_progress',
            },
          };
        }
      }

      const empty =
        this.getInventory().length === 0;

      return {
        success: empty,

        message: empty
          ? 'Inventory completely deposited'
          : 'Inventory was not completely deposited',

        data: {
          depositedSlots:
            deposited,
        },
      };
    } catch (error) {
      return failure(
        'bankAll failed',
        error,
      );
    }
  }

  async withdrawItem(
    item: string,
    amount = 1,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      if (!this.isBankOpen()) {
        return {
          success: false,

          message:
            'Bank is not open',

          data: {
            reason:
              'bank_not_open',
          },
        };
      }

      const bankItem =
        this.findBankItem(
          new RegExp(
            `^${escapeRegex(item)}$`,
            'i',
          ),
        );

      if (!bankItem) {
        return {
          success: false,

          message:
            `${item} not found in bank`,

          data: {
            reason:
              'item_not_found',
          },
        };
      }

      return toScriptResult(
        await this.bot.withdrawItem(
          bankItem,
          amount,
        ),
      );
    } catch (error) {
      return failure(
        'withdrawItem failed',
        error,
      );
    }
  }

  async depositItem(
    item: string,
    amount = -1,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      if (!this.isBankOpen()) {
        return {
          success: false,

          message:
            'Bank is not open',

          data: {
            reason:
              'bank_not_open',
          },
        };
      }

      const inventoryItem =
        this.sdk.findInventoryItem(
          new RegExp(
            `^${escapeRegex(item)}$`,
            'i',
          ),
        );

      if (!inventoryItem) {
        return {
          success: false,

          message:
            `${item} not found in inventory`,

          data: {
            reason:
              'item_not_found',
          },
        };
      }

      return toScriptResult(
        await this.bot.depositItem(
          inventoryItem,
          amount,
        ),
      );
    } catch (error) {
      return failure(
        'depositItem failed',
        error,
      );
    }
  }

  /* ================================================================
   * SHOPPING
   * ================================================================ */

  async openShop(
    target:
      | string
      | RegExp = /shop keeper|shop assistant/i,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      return toScriptResult(
        await this.bot.openShop(
          target,
        ),
      );
    } catch (error) {
      return failure(
        'openShop failed',
        error,
      );
    }
  }

  async closeShop(): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      return toScriptResult(
        await this.bot.closeShop(),
      );
    } catch (error) {
      return failure(
        'closeShop failed',
        error,
      );
    }
  }

  async buyFromShop(
    item: string,
    amount = 1,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      const shop =
        this.sdk.getState()?.shop;

      if (!shop?.isOpen) {
        return {
          success: false,

          message:
            'Shop is not open',

          data: {
            reason:
              'shop_not_open',
          },
        };
      }

      return toScriptResult(
        await this.bot.buyFromShop(
          item,
          amount,
        ),
      );
    } catch (error) {
      return failure(
        'buyFromShop failed',
        error,
      );
    }
  }

  /* ================================================================
   * EQUIPMENT / RECOVERY
   * ================================================================ */

  async equipItem(
    item: string,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      const inventoryItem =
        this.sdk.findInventoryItem(
          new RegExp(
            `^${escapeRegex(item)}$`,
            'i',
          ),
        );

      if (!inventoryItem) {
        return {
          success: false,

          message:
            `${item} not found in inventory`,

          data: {
            reason:
              'item_not_found',
          },
        };
      }

      return toScriptResult(
        await this.bot.equipItem(
          inventoryItem,
        ),
      );
    } catch (error) {
      return failure(
        'equipItem failed',
        error,
      );
    }
  }

  async eatFood(
    item: string,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      return toScriptResult(
        await this.bot.eatFood(
          new RegExp(
            `^${escapeRegex(item)}$`,
            'i',
          ),
        ),
      );
    } catch (error) {
      return failure(
        'eatFood failed',
        error,
      );
    }
  }

  /* ================================================================
   * FISHING
   * ================================================================ */

  async fish(
    method = 'net',
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      let spot =
        this.sdk.findNearbyNpc(
          /fishing spot/i,
          {
            reachable: true,
          },
        );

      if (!spot) {
        spot =
          this.getNearbyNpcs().find(
            (npc: any) =>
              typeof npc?.name === 'string' &&
              /fishing spot/i.test(
                npc.name,
              ),
          ) ?? null;
      }

      if (!spot) {
        return {
          success: false,

          message:
            'No fishing spot NPC found nearby',

          data: {
            reason:
              'fishing_spot_not_found',
          },
        };
      }

      const methodPattern =
        method === 'net'
          ? /net/i
          : method === 'bait'
            ? /bait/i
            : method === 'fly'
              ? /lure|fly/i
              : method === 'cage'
                ? /cage/i
                : method === 'harpoon'
                  ? /harpoon/i
                  : new RegExp(
                      escapeRegex(method),
                      'i',
                    );

      const option =
        spot.optionsWithIndex?.find(
          (entry: any) =>
            methodPattern.test(
              String(
                entry?.text ?? '',
              ),
            ),
        ) ??
        spot.optionsWithIndex?.find(
          (entry: any) =>
            /net|fish|bait|lure|cage|harpoon/i.test(
              String(
                entry?.text ?? '',
              ),
            ),
        );

      if (!option) {
        return {
          success: false,

          message:
            `No usable fishing option on ${spot.name}`,

          data: {
            reason:
              'fishing_option_not_found',

            spot:
              spot.name,
          },
        };
      }

      return toScriptResult(
        await this.bot.interactNpc(
          spot,
          option.text,
        ),
      );
    } catch (error) {
      return failure(
        'fish failed',
        error,
      );
    }
  }

  /* ================================================================
   * MINING
   * ================================================================ */

  async mine(
    resource: string,
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      const rock =
        this.sdk.findNearbyLoc(
          new RegExp(
            escapeRegex(resource),
            'i',
          ),
        );

      if (!rock) {
        return {
          success: false,

          message:
            `No ${resource} rock found nearby`,

          data: {
            reason:
              'resource_not_found',
          },
        };
      }

      const option =
        rock.optionsWithIndex?.find(
          (entry: any) =>
            /mine/i.test(
              String(
                entry?.text ?? '',
              ),
            ),
        );

      if (!option) {
        return {
          success: false,

          message:
            `${rock.name} has no Mine option`,

          data: {
            reason:
              'mine_option_not_found',

            object:
              rock.name,
          },
        };
      }

      return toScriptResult(
        await this.bot.interactLoc(
          rock,
          option.text,
        ),
      );
    } catch (error) {
      return failure(
        'mine failed',
        error,
      );
    }
  }

  /* ================================================================
   * WOODCUTTING
   * ================================================================ */

  async chopTree(
    resource = 'tree',
  ): Promise<ScriptResult> {
    try {
      await this.ensureConnected();

      const tree =
        this.sdk.findNearbyLoc(
          new RegExp(
            `^${escapeRegex(resource)}$`,
            'i',
          ),
        );

      if (!tree) {
        return {
          success: false,

          message:
            `No ${resource} found nearby`,

          data: {
            reason:
              'resource_not_found',
          },
        };
      }

      return toScriptResult(
        await this.bot.chopTree(
          tree,
        ),
      );
    } catch (error) {
      return failure(
        'chopTree failed',
        error,
      );
    }
  }
}

/* ================================================================
 * FACTORY
 * ================================================================ */

export function createRsSdkAdapter(
  ctx: ScriptContext,
): RsSdkAdapter {
  /*
   * IMPORTANT:
   *
   * Do not use instanceof here.
   *
   * The SDK is dynamically imported and the same class can be
   * represented by different module instances. Duck typing makes
   * the shared-controller contract reliable.
   */
  const existing =
    ctx.adapter as any;

  if (
    existing &&
    typeof existing.connect === 'function' &&
    typeof existing.disconnect === 'function' &&
    typeof existing.getState === 'function'
  ) {
    return existing as RsSdkAdapter;
  }

  return new RsSdkAdapter({
    server:
      normalizeServer(
        ctx.sdkBaseUrl,
      ),

    botName:
      ctx.sdkBotName,

    password:
      ctx.sdkBotPassword,
  });
}

/* ================================================================
 * HELPERS
 * ================================================================ */

function toScriptResult(
  result: any,
): ScriptResult {
  return {
    success:
      Boolean(
        result?.success,
      ),

    message:
      result?.message ??
      (
        result?.success
          ? 'Action completed'
          : 'Action failed'
      ),

    data:
      result,
  };
}

function failure(
  message: string,
  error: unknown,
): ScriptResult {
  return {
    success: false,

    message:
      `${message}: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
  };
}

function escapeRegex(
  value: string,
): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  );
}

function normalizeServer(
  value: string,
): string {
  return value
    .replace(
      /^https?:\/\//,
      '',
    )
    .replace(
      /^wss?:\/\//,
      '',
    )
    .replace(
      /\/gateway\/?$/,
      '',
    )
    .replace(
      /\/$/,
      '',
    );
}
