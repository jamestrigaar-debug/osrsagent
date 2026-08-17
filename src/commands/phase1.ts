export type GatheringProfession =
  | 'woodcutting'
  | 'mining'
  | 'fishing';

export interface TravelDestination {
  id: string;
  name: string;
  category:
    | 'bank'
    | 'woodcutting'
    | 'mining'
    | 'fishing';

  x: number;
  z: number;
  tolerance: number;

  verified?: boolean;

  notes?: string;
}

export interface GatheringPreset {
  id: string;
  name: string;
  profession:
    GatheringProfession;

  locationId: string;

  resource?: string;

  method?: string;

  target?: string;
}

/* ================================================================
 * TRAVEL DESTINATIONS
 * ================================================================ */

export const TRAVEL_DESTINATIONS:
  TravelDestination[] = [

  /* ==============================================================
   * BANKS
   * ============================================================== */

  {
    id:
      'varrock-west-bank',

    name:
      'Varrock West Bank',

    category:
      'bank',

    x:
      3185,

    z:
      3436,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified in bot testing.',
  },

  {
    id:
      'draynor-bank',

    name:
      'Draynor Bank',

    category:
      'bank',

    x:
      3093,

    z:
      3244,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified coordinate.',
  },

  /* ==============================================================
   * WOODCUTTING
   * ============================================================== */

  {
    id:
      'varrock-west-trees',

    name:
      'Varrock West Trees',

    category:
      'woodcutting',

    x:
      3161,

    z:
      3471,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified tree route anchor.',
  },

  {
    id:
      'draynor-willows',

    name:
      'Draynor Willows',

    category:
      'woodcutting',

    x:
      3091,

    z:
      3225,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified coordinate supplied for Phase 1.',
  },

  {
    id:
      'draynor-oaks',

    name:
      'Draynor Oaks',

    category:
      'woodcutting',

    x:
      3101,

    z:
      3243,

    tolerance:
      3,

    verified:
      true,

    notes:
      'East of Draynor Bank.',
  },

  {
    id:
      'edgeville-yews',

    name:
      'Edgeville Yews',

    category:
      'woodcutting',

    x:
      3087,

    z:
      3476,

    tolerance:
      3,

    verified:
      true,

    notes:
      'South of Edgeville Bank.',
  },

  {
    id:
      'varrock-palace-yews',

    name:
      'Varrock Palace Yews',

    category:
      'woodcutting',

    x:
      3222,

    z:
      3503,

    tolerance:
      3,

    verified:
      true,

    notes:
      'North of Varrock Palace.',
  },

  {
    id:
      'seers-maples',

    name:
      'Seers Maples',

    category:
      'woodcutting',

    x:
      2727,

    z:
      3481,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Just outside Seers Bank.',
  },

  {
    id:
      'seers-willows',

    name:
      'Seers Willows',

    category:
      'woodcutting',

    x:
      2712,

    z:
      3471,

    tolerance:
      3,

    verified:
      true,

    notes:
      'South of Seers Bank.',
  },

  {
    id:
      'catherby-yews',

    name:
      'Catherby Yews',

    category:
      'woodcutting',

    x:
      2758,

    z:
      3431,

    tolerance:
      3,

    verified:
      true,

    notes:
      'West of Catherby Bank.',
  },

  {
    id:
      'wc-guild-willows',

    name:
      'Woodcutting Guild Willows',

    category:
      'woodcutting',

    x:
      1629,

    z:
      3486,

    tolerance:
      3,

    verified:
      true,

    notes:
      'OSRS location; not present in 2004scape.',
  },

  {
    id:
      'wc-guild-yews',

    name:
      'Woodcutting Guild Yews',

    category:
      'woodcutting',

    x:
      1591,

    z:
      3482,

    tolerance:
      3,

    verified:
      true,

    notes:
      'OSRS location; not present in 2004scape.',
  },

  {
    id:
      'wc-guild-redwoods',

    name:
      'Woodcutting Guild Redwoods',

    category:
      'woodcutting',

    x:
      1572,

    z:
      3482,

    tolerance:
      3,

    verified:
      true,

    notes:
      'OSRS location; not present in 2004scape.',
  },

  /* ==============================================================
   * MINING
   * ============================================================== */

  {
    id:
      'varrock-copper',

    name:
      'Varrock Copper',

    category:
      'mining',

    x:
      3289,

    z:
      3363,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified copper mining node/area.',
  },

  {
    id:
      'varrock-east',

    name:
      'Varrock East Mine',

    category:
      'mining',

    x:
      3281,

    z:
      3363,

    tolerance:
      3,

    verified:
      true,

    notes:
      'South-east of Varrock wall.',
  },

  {
    id:
      'lumbridge-swamp',

    name:
      'Lumbridge Swamp Mine',

    category:
      'mining',

    x:
      3226,

    z:
      3144,

    tolerance:
      3,

    verified:
      true,

    notes:
      'East Mine; copper/tin area.',
  },

  {
    id:
      'rimmington',

    name:
      'Rimmington Mine',

    category:
      'mining',

    x:
      2981,

    z:
      3233,

    tolerance:
      3,

    verified:
      true,

    notes:
      'North of Rimmington.',
  },

  {
    id:
      'falador',

    name:
      'Falador Mine',

    category:
      'mining',

    x:
      2906,

    z:
      3362,

    tolerance:
      3,

    verified:
      true,

    notes:
      'West Falador mine.',
  },

  {
    id:
      'al-kharid',

    name:
      'Al Kharid Mine',

    category:
      'mining',

    x:
      3298,

    z:
      3298,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Scorpion Mine north of Al Kharid.',
  },

  {
    id:
      'crafting-guild',

    name:
      'Crafting Guild Mine',

    category:
      'mining',

    x:
      2933,

    z:
      3285,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Ground floor of the guild.',
  },

  {
    id:
      'mining-guild',

    name:
      'Mining Guild',

    category:
      'mining',

    x:
      3021,

    z:
      3338,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Entrance ladder in Falador.',
  },

  /* ==============================================================
   * FISHING
   * ============================================================== */

  {
    id:
      'draynor-fishing',

    name:
      'Draynor Fishing',

    category:
      'fishing',

    x:
      3087,

    z:
      3227,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Verified fishing location.',
  },

  {
    id:
      'lumbridge-swamp-fishing',

    name:
      'Lumbridge Swamp Fishing',

    category:
      'fishing',

    x:
      3240,

    z:
      3150,

    tolerance:
      3,

    verified:
      true,

    notes:
      'South of Lumbridge graveyard.',
  },

  {
    id:
      'lumbridge-river',

    name:
      'Lumbridge River',

    category:
      'fishing',

    x:
      3240,

    z:
      3290,

    tolerance:
      3,

    verified:
      true,

    notes:
      'West of Lumbridge bridge.',
  },

  {
    id:
      'barbarian-village',

    name:
      'Barbarian Village Fishing',

    category:
      'fishing',

    x:
      3109,

    z:
      3433,

    tolerance:
      3,

    verified:
      true,

    notes:
      'River fishing spots near the bridge.',
  },

  {
    id:
      'catherby-fishing',

    name:
      'Catherby Fishing',

    category:
      'fishing',

    x:
      2855,

    z:
      3430,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Main Catherby beach.',
  },

  {
    id:
      'fishing-guild',

    name:
      'Fishing Guild',

    category:
      'fishing',

    x:
      2611,

    z:
      3394,

    tolerance:
      3,

    verified:
      true,

    notes:
      'OSRS location; not present in 2004scape.',
  },

  {
    id:
      'karamja-lobsters',

    name:
      'Karamja Lobsters',

    category:
      'fishing',

    x:
      2925,

    z:
      3175,

    tolerance:
      3,

    verified:
      true,

    notes:
      'Musa Point pier.',
  },

  {
    id:
      'seers-fishing',

    name:
      'Seers Fishing',

    category:
      'fishing',

    x:
      2722,

    z:
      3528,

    tolerance:
      3,

    verified:
      true,

    notes:
      'River near Sinclair Mansion.',
  },
];

/* ================================================================
 * GATHERING PRESETS
 * ================================================================ */

export const GATHERING_PRESETS:
  GatheringPreset[] = [

  {
    id:
      'woodcut-varrock',

    name:
      'Woodcutting — Varrock West',

    profession:
      'woodcutting',

    locationId:
      'varrock-west-trees',
  },

  {
    id:
      'woodcut-draynor-willows',

    name:
      'Woodcutting — Draynor Willows',

    profession:
      'woodcutting',

    locationId:
      'draynor-willows',

    resource:
      'willow',
  },

  {
    id:
      'woodcut-draynor-oaks',

    name:
      'Woodcutting — Draynor Oaks',

    profession:
      'woodcutting',

    locationId:
      'draynor-oaks',

    resource:
      'oak',
  },

  {
    id:
      'woodcut-edgeville-yews',

    name:
      'Woodcutting — Edgeville Yews',

    profession:
      'woodcutting',

    locationId:
      'edgeville-yews',

    resource:
      'yew',
  },

  {
    id:
      'woodcut-varrock-palace-yews',

    name:
      'Woodcutting — Varrock Palace Yews',

    profession:
      'woodcutting',

    locationId:
      'varrock-palace-yews',

    resource:
      'yew',
  },

  {
    id:
      'woodcut-seers-maples',

    name:
      'Woodcutting — Seers Maples',

    profession:
      'woodcutting',

    locationId:
      'seers-maples',

    resource:
      'maple',
  },

  {
    id:
      'woodcut-seers-willows',

    name:
      'Woodcutting — Seers Willows',

    profession:
      'woodcutting',

    locationId:
      'seers-willows',

    resource:
      'willow',
  },

  {
    id:
      'woodcut-catherby-yews',

    name:
      'Woodcutting — Catherby Yews',

    profession:
      'woodcutting',

    locationId:
      'catherby-yews',

    resource:
      'yew',
  },

  {
    id:
      'woodcut-wc-guild-willows',

    name:
      'Woodcutting — WC Guild Willows',

    profession:
      'woodcutting',

    locationId:
      'wc-guild-willows',

    resource:
      'willow',
  },

  {
    id:
      'woodcut-wc-guild-yews',

    name:
      'Woodcutting — WC Guild Yews',

    profession:
      'woodcutting',

    locationId:
      'wc-guild-yews',

    resource:
      'yew',
  },

  {
    id:
      'woodcut-wc-guild-redwoods',

    name:
      'Woodcutting — WC Guild Redwoods',

    profession:
      'woodcutting',

    locationId:
      'wc-guild-redwoods',

    resource:
      'redwood',
  },

  {
    id:
      'mine-varrock-copper',

    name:
      'Mining — Varrock Copper',

    profession:
      'mining',

    locationId:
      'varrock-copper',

    resource:
      'copper',
  },

  {
    id:
      'mine-varrock-east',

    name:
      'Mining — Varrock East',

    profession:
      'mining',

    locationId:
      'varrock-east',

    resource:
      'copper',
  },

  {
    id:
      'mine-lumbridge-swamp',

    name:
      'Mining — Lumbridge Swamp',

    profession:
      'mining',

    locationId:
      'lumbridge-swamp',

    resource:
      'copper',
  },

  {
    id:
      'mine-rimmington',

    name:
      'Mining — Rimmington',

    profession:
      'mining',

    locationId:
      'rimmington',

    resource:
      'copper',
  },

  {
    id:
      'mine-falador',

    name:
      'Mining — Falador',

    profession:
      'mining',

    locationId:
      'falador',

    resource:
      'iron',
  },

  {
    id:
      'mine-al-kharid',

    name:
      'Mining — Al Kharid',

    profession:
      'mining',

    locationId:
      'al-kharid',

    resource:
      'iron',
  },

  {
    id:
      'mine-crafting-guild',

    name:
      'Mining — Crafting Guild',

    profession:
      'mining',

    locationId:
      'crafting-guild',

    resource:
      'gold',
  },

  {
    id:
      'mine-mining-guild',

    name:
      'Mining — Mining Guild',

    profession:
      'mining',

    locationId:
      'mining-guild',

    resource:
      'coal',
  },

  {
    id:
      'fish-draynor-shrimp',

    name:
      'Fishing — Draynor Shrimp',

    profession:
      'fishing',

    locationId:
      'draynor-fishing',

    method:
      'net',

    target:
      'shrimp',
  },

  {
    id:
      'fish-lumbridge-swamp',

    name:
      'Fishing — Lumbridge Swamp',

    profession:
      'fishing',

    locationId:
      'lumbridge-swamp-fishing',

    method:
      'net',

    target:
      'shrimp',
  },

  {
    id:
      'fish-lumbridge-river',

    name:
      'Fishing — Lumbridge River',

    profession:
      'fishing',

    locationId:
      'lumbridge-river',

    method:
      'bait',
  },

  {
    id:
      'fish-barbarian-village',

    name:
      'Fishing — Barbarian Village',

    profession:
      'fishing',

    locationId:
      'barbarian-village',

    method:
      'bait',
  },

  {
    id:
      'fish-catherby',

    name:
      'Fishing — Catherby',

    profession:
      'fishing',

    locationId:
      'catherby-fishing',

    method:
      'net',
  },

  {
    id:
      'fish-fishing-guild',

    name:
      'Fishing — Fishing Guild',

    profession:
      'fishing',

    locationId:
      'fishing-guild',

    method:
      'net',
  },

  {
    id:
      'fish-karamja-lobsters',

    name:
      'Fishing — Karamja Lobsters',

    profession:
      'fishing',

    locationId:
      'karamja-lobsters',

    method:
      'cage',

    target:
      'lobster',
  },

  {
    id:
      'fish-seers',

    name:
      'Fishing — Seers',

    profession:
      'fishing',

    locationId:
      'seers-fishing',

    method:
      'bait',
  },
];

/* ================================================================
 * LOOKUPS
 * ================================================================ */

export function getTravelDestination(
  id:
    string,
): TravelDestination | undefined {
  return TRAVEL_DESTINATIONS.find(
    (
      destination,
    ) =>
      destination.id ===
      id,
  );
}

export function getGatheringPreset(
  id:
    string,
): GatheringPreset | undefined {
  return GATHERING_PRESETS.find(
    (
      preset,
    ) =>
      preset.id ===
      id,
  );
}
