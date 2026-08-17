/**
 * Memory store type definitions
 */

export interface SkillData {
  level: number;
  xp: number;
}

export interface Skills {
  [skillName: string]: SkillData;
}

export interface InventorySlot {
  slot: number;
  name: string;
  quantity: number;
}

export interface EquipmentSlot {
  slot: string;
  name: string;
}

export interface Location {
  worldX: number;
  worldZ: number;
  area?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface PlanStep {
  script: string;
  params: Record<string, unknown>;
  description?: string;
}

export interface LoopCondition {
  skill?: string;
  level?: number;
  itemCount?: Record<string, number>;
  custom?: string;
}

export interface ActivePlan {
  planId: string;
  goal: string;
  steps: PlanStep[];
  currentStepIndex: number;
  loopUntil?: LoopCondition;
  onMissingCapability: 'invoke_sdk_or_ask_user';
  createdAt: number;
}

export interface AccountMemory {
  accountId: string;
  skills: Skills;
  inventory: InventorySlot[];
  equipment: EquipmentSlot[];
  location: Location;
  currentGoal: string;
  activePlanId: string | null;
  activePlan: ActivePlan | null;
  lastActionResult: ActionResult | null;
  history: string[];
  updatedAt: number;
  userRequest?: string;
}

export interface MemorySnapshot {
  accountId: string;
  skills: Skills;
  inventory: InventorySlot[];
  equipment: EquipmentSlot[];
  location: Location;
  currentGoal: string;
  lastActionResult: ActionResult | null;
  historyRecent: string[];
}
