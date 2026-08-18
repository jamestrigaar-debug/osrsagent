/**
 * Script manifests index — imports all implementations so their
 * registerScript() calls execute during startup.
 */

export * from './registry.js';
export * from './executor.js';
export * from './types.js';

/* ================================================================
 * MOVEMENT
 * ================================================================ */

import './implementations/movement.js';
import './implementations/travel.js';
import './implementations/movement-bot.js';

/* ================================================================
 * GATHERING
 * ================================================================ */

import './implementations/gathering.js';
import './implementations/woodcutting.js';
import './implementations/mining.js';
import './implementations/fishing.js';

/* ================================================================
 * GATHERING EQUIPMENT
 * ================================================================ */

import './implementations/ensure-woodcutting-tool.js';
import './implementations/ensure-mining-tool.js';
import './implementations/ensure-fishing-tool.js';

/* ================================================================
 * BANKING / INVENTORY
 * ================================================================ */

import './implementations/banking.js';
import './implementations/inventory.js';

/* ================================================================
 * Provision / Cooking
 * ================================================================ */

import "./implementations/provision-food.js";
import "./implementations/cook-food.js";

/* ================================================================
 * Combat
 * ================================================================ */
import './implementations/basic_combat.js';
import './implementations/basic_combat.js';
import './implementations/equip_combat_loadout.js';

import './implementations/bronze_gear_setup.js';



