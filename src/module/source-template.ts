import { ActionTrackingData } from "./action";
import {
  ActivationType,
  DeployableType,
  EntryType,
  FittingSize,
  FrameEffectUse,
  MechType,
  MountType,
  NpcFeatureType,
  NpcTechType,
  OrgType,
  ReserveType,
  SystemType,
  WeaponSize,
  WeaponSizeChecklist,
  WeaponType,
  WeaponTypeChecklist,
} from "./enums";
import { ActionData } from "./models/bits/action";
import { BonusData } from "./models/bits/bonus";
import { CounterData } from "./models/bits/counter";
import { DamageData } from "./models/bits/damage";
import { RangeData } from "./models/bits/range";
import { SynergyData } from "./models/bits/synergy";

export type DataTypeMap = { [key in EntryType]: object };

export interface BoundedNum {
  min?: number;
  max?: number;
  value: 0;
}

export type FullBoundedNum = Required<BoundedNum>;
export type UUIDRef = string; // A UUID. TODO: Implement a fallback lid measure?
export type EmbeddedRef = string; // A local item on an actor. Used for loadouts / active equipment
// Each tag holds a minified version of the full version, which should theoretically be accessible via clicking on it

export namespace SourceTemplates {
  export interface actor_universal {
    lid: string;
    hp: number;
    overshield: number;
    burn: number;

    resistances: {
      Kinetic: boolean;
      Energy: boolean;
      Explosive: boolean;
      Heat: boolean;
      Burn: boolean;
      Variable: boolean;
    };

    activations: number;
    custom_counters: CounterData[];
  }

  export interface item_universal {
    lid: string;
  }

  // An item that is provided as part of a license
  export interface licensed {
    manufacturer: string;
    license_level: number;
    license: string;
  }

  // The core data in virtually every lancer item
  export interface bascdt {
    actions: ActionData[];
    synergies: SynergyData[];
    counters: CounterData[];
    deployables: UUIDRef[];
    integrated: UUIDRef[];
    tags: TagField[];
    bonuses: BonusData[];
  }

  // For items and mods that can enter failing states
  export interface destructible {
    cascading: boolean;
    destroyed: boolean;
  }

  export interface action_tracking {
    action_tracker: ActionTrackingData;
  }

  export interface heat {
    heat: number;
  }

  export interface struss {
    stress: number;
    structure: number;
  }

  export interface TagField {
    lid: string;
    value: string;
    name: string;
  }

  // These are provided/modified by npc classes and features
  export interface NpcStatBlock {
    activations: number;
    armor: number;
    hp: number;
    evade: number;
    edef: number;
    heatcap: number;
    speed: number;
    sensor: number;
    save: number;
    hull: number;
    agility: number;
    systems: number;
    engineering: number;
    size: number;
    structure: number;
    stress: number;
  }

  export interface BaseNpcFeatureData {
    lid: string;
    // We strip origin - it isn't particularly helpful to store in source, but could be derived maybe
    effect: string;
    bonus: Partial<NpcStatBlock>;
    override: Partial<NpcStatBlock>;
    tags: TagField[];
    type: NpcFeatureType;

    // State tracking. Not always used
    charged: boolean;
    uses: number;
    loaded: boolean;
    destroyed: boolean;

    // If we want this feature to have a distinct tier fixed regardless of underlying npc tier
    tier_override: number;
  }

  export interface NpcWeaponData extends BaseNpcFeatureData {
    weapon_type: string;
    damage: DamageData[][]; // Damage array by tier
    range: RangeData[][]; // Range array by ties
    on_hit: string;
    accuracy: number[]; // Accuracy by tier
    attack_bonus: number[]; // Attack bonus by tier
    type: NpcFeatureType.Weapon;
  }

  export interface NpcTraitData extends BaseNpcFeatureData {
    type: NpcFeatureType.Trait;
  }

  export interface NpcReactionData extends BaseNpcFeatureData {
    type: NpcFeatureType.Reaction;
    trigger: string;
  }

  export interface NpcSystemData extends BaseNpcFeatureData {
    type: NpcFeatureType.System;
  }

  export interface NpcTechData extends BaseNpcFeatureData {
    type: NpcFeatureType.Tech;
    tech_type: NpcTechType;
    accuracy: number[]; // Accuracy by tier
    attack_bonus: number[]; // Attack bonus by tier
  }

  export type AnyNpcFeature = NpcTechData | NpcSystemData | NpcReactionData | NpcTraitData | NpcWeaponData;
}

interface SourceDataTypesMap extends DataTypeMap {
  [EntryType.CORE_BONUS]: SourceTemplates.item_universal &
    SourceTemplates.bascdt & {
      description: string;
      effect: string;
      mounted_effect: string;
      manufacturer: string;
    };
  [EntryType.DEPLOYABLE]: SourceTemplates.actor_universal &
    SourceTemplates.heat & {
      actions: ActionData[];
      bonuses: BonusData[];
      counters: CounterData[];
      synergies: SynergyData[];
      tags: SourceTemplates.TagField[];
      activation: ActivationType;
      armor: number;
      cost: number;
      max_hp: number;
      max_heat: number;
      size: number;
      speed: number; // Some have it!
      edef: number;
      evasion: number;
      instances: number;
      deactivation: ActivationType;
      detail: string;
      recall: ActivationType;
      redeploy: ActivationType;

      type: DeployableType;
      avail_mounted: boolean;
      avail_unmounted: boolean;
      deployer: UUIDRef | null;
    };
  [EntryType.FRAME]: SourceTemplates.item_universal &
    SourceTemplates.licensed & {
      description: string;
      mechtype: MechType[];
      mounts: MountType[];
      stats: {
        armor: number;
        edef: number;
        evasion: number;
        heatcap: number;
        hp: number;
        repcap: number;
        save: number;
        sensor_range: number;
        size: number;
        sp: number;
        speed: number;
        stress: number;
        structure: number;
        tech_attack: number;
      };
      traits: Array<{
        name: string;
        description: string;
        bonuses: BonusData[];
        counters: CounterData[];
        integrated: UUIDRef[];
        deployables: UUIDRef[];
        actions: ActionData[];
        synergies: SynergyData[];
        use: FrameEffectUse;
      }>;
      core_system: {
        name: string;
        description: string; // v-html
        activation: ActivationType;
        deactivation?: ActivationType;
        use?: FrameEffectUse; // This maybe should be deprecated

        active_name: string;
        active_effect: string; // v-html
        active_synergies: SynergyData[];
        active_bonuses: BonusData[];
        active_actions: ActionData[];

        // Should mirror actives exactly
        passive_name?: string;
        passive_effect?: string; // v-html,
        passive_synergies?: SynergyData[];
        passive_actions: ActionData[];
        passive_bonuses: BonusData[];

        deployables: UUIDRef[];
        counters: CounterData[];
        integrated: UUIDRef[];
        tags: SourceTemplates.TagField[];
      };
    };
  [EntryType.LICENSE]: SourceTemplates.item_universal & {
    manufacturer: string;
    key: string;
    rank: number;
  };
  [EntryType.MECH]: SourceTemplates.actor_universal &
    SourceTemplates.action_tracking &
    SourceTemplates.heat &
    SourceTemplates.struss & {
      overcharge: number;
      repairs: number;
      core_active: boolean;
      core_energy: boolean;
      loadout: {
        frame: EmbeddedRef | null; // ID to a LancerFRAME on the mech
        weapon_mounts: Array<{
          slots: Array<{
            weapon: EmbeddedRef | null; // ID to a LancerMECH_WEAPON on the mech
            mod: EmbeddedRef | null; // ID to a LancerWEAPON_MOD on the mech
            size: FittingSize;
          }>;
          type: MountType;
          bracing: boolean;
        }>;
        systems: Array<EmbeddedRef>;
      };
      meltdown_timer: number | null;
      ejected: boolean;
      notes: string;
      pilot: UUIDRef | null; // UUID to a LancerPILOT
    };
  [EntryType.MECH_SYSTEM]: SourceTemplates.item_universal &
    SourceTemplates.bascdt &
    SourceTemplates.destructible &
    SourceTemplates.licensed & {
      effect: string;
      sp: number;
      uses: number;
      description: string;
      type: SystemType;
    };
  [EntryType.MECH_WEAPON]: SourceTemplates.item_universal &
    SourceTemplates.destructible &
    SourceTemplates.licensed & {
      deployables: UUIDRef[];
      integrated: UUIDRef[];
      sp: number;
      uses: number;
      profiles: Array<{
        name: string;
        type: WeaponType;
        damage: DamageData[];
        range: RangeData[];
        tags: SourceTemplates.TagField[];
        description: string;
        effect: string;
        on_attack: string;
        on_hit: string;
        on_crit: string;
        cost: number;
        skirmishable: boolean;
        barrageable: boolean;
        actions: ActionData[];
        bonuses: BonusData[];
        synergies: SynergyData[];
        counters: CounterData[];
      }>;
      loaded: false;
      selected_profile: number;
      size: WeaponSize;
      no_core_bonuses: boolean;
      no_mods: boolean;
      no_bonuses: boolean;
      no_synergies: boolean;
      no_attack: boolean;
    };
  [EntryType.NPC]: SourceTemplates.actor_universal &
    SourceTemplates.action_tracking &
    SourceTemplates.heat &
    SourceTemplates.struss & {
      notes: string;
      meltdown_timer: number | null;
      tier: number;
    };
  [EntryType.NPC_CLASS]: SourceTemplates.item_universal & {
    role: string;
    info: {
      flavor: string;
      tactics: string;
    };
    base_features: UUIDRef[];
    optional_features: UUIDRef[];
    base_stats: Array<SourceTemplates.NpcStatBlock>;
  };
  [EntryType.NPC_FEATURE]: SourceTemplates.AnyNpcFeature;
  [EntryType.NPC_TEMPLATE]: SourceTemplates.item_universal & {
    description: string;
    base_features: UUIDRef[];
    optional_features: UUIDRef[];
  };
  [EntryType.ORGANIZATION]: SourceTemplates.item_universal & {
    actions: string;
    description: string;
    efficiency: number;
    influence: 0;
    purpose: OrgType;
  };
  [EntryType.PILOT_ARMOR]: SourceTemplates.item_universal &
    SourceTemplates.bascdt & {
      description: string;
      uses: number;
    };
  [EntryType.PILOT_GEAR]: SourceTemplates.item_universal &
    SourceTemplates.bascdt & {
      description: string;
      uses: number;
    };
  [EntryType.PILOT_WEAPON]: SourceTemplates.item_universal &
    SourceTemplates.bascdt & {
      description: string;
      range: RangeData[];
      damage: DamageData[];
      effect: string;
      loaded: boolean;
      uses: number;
    };
  [EntryType.PILOT]: SourceTemplates.actor_universal &
    SourceTemplates.action_tracking & {
      active_mech: UUIDRef | null;
      background: string;
      callsign: string;
      cloud_id: string;
      cloud_owner_id: string;
      history: string;
      last_cloud_update: string;
      level: number;
      loadout: {
        armor: UUIDRef[];
        gear: UUIDRef[];
        weapons: UUIDRef[];
      };
      mech_skills: [number, number, number, number];
      mounted: boolean;
      notes: string;
      player_name: string;
      status: string;
      text_appearance: string;
    };
  [EntryType.RESERVE]: SourceTemplates.item_universal &
    SourceTemplates.bascdt & {
      consumable: boolean;
      label: string;
      resource_name: string;
      resource_note: string;
      resource_cost: string;
      type: ReserveType;
      used: boolean;
      description: string;
    };
  [EntryType.SKILL]: SourceTemplates.item_universal & {
    description: string;
    detail: string;
    family: string;
    rank: number;
  };
  [EntryType.STATUS]: SourceTemplates.item_universal & {
    effects: string;
    type: "Status" | "Condition" | "Effect";
  };
  [EntryType.TAG]: SourceTemplates.item_universal & {
    description: string;
    hidden: boolean;
  };
  [EntryType.TALENT]: SourceTemplates.item_universal & {
    curr_rank: number;
    description: string;
    ranks: Array<{
      name: string;
      description: string;
      exclusive: boolean;
      actions: ActionData[];
      bonuses: BonusData[];
      synergies: SynergyData[];
      deployables: UUIDRef[];
      counters: CounterData[];
      integrated: UUIDRef[];
    }>;
    terse: string;
  };
  [EntryType.WEAPON_MOD]: SourceTemplates.item_universal &
    SourceTemplates.bascdt &
    SourceTemplates.destructible &
    SourceTemplates.licensed & {
      added_tags: SourceTemplates.TagField[];
      added_damage: DamageData[];
      effect: string;
      description: string;
      sp: number;
      uses: number;
      allowed_sizes: WeaponSizeChecklist;
      allowed_types: WeaponTypeChecklist;
      added_range: RangeData[];
    };
}

export type SourceDataType<T extends EntryType> = T extends keyof SourceDataTypesMap ? SourceDataTypesMap[T] : never;
