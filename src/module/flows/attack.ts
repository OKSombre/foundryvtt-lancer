// Import TypeScript modules
import { LANCER } from "../config";
import { getAutomationOptions } from "../settings";
import { LancerItem, LancerMECH_WEAPON, LancerNPC_FEATURE, LancerPILOT_WEAPON } from "../item/lancer-item";
import { LancerActor } from "../actor/lancer-actor";
import { checkForHit } from "../helpers/automation/targeting";
import { AccDiffData, AccDiffDataSerialized, RollModifier } from "../helpers/acc_diff";
import { renderTemplateStep } from "./_render";
import { SystemTemplates } from "../system-template";
import { SourceData, UUIDRef } from "../source-template";
import { LancerFlowState } from "./interfaces";
import { openSlidingHud } from "../helpers/slidinghud";
import { Tag } from "../models/bits/tag";
import { Flow, FlowState } from "./flow";

const lp = LANCER.log_prefix;

function rollStr(bonus: number, total: number): string {
  let modStr = "";
  if (total != 0) {
    let sign = total > 0 ? "+" : "-";
    let abs = Math.abs(total);
    let roll = abs == 1 ? "1d6" : `${abs}d6kh1`;
    modStr = ` ${sign} ${roll}`;
  }
  return `1d20 + ${bonus}${modStr}`;
}

function applyPluginsToRoll(str: string, plugins: RollModifier[]): string {
  return plugins.sort((p, q) => q.rollPrecedence - p.rollPrecedence).reduce((acc, p) => p.modifyRoll(acc), str);
}

/** Create the attack roll(s) for a given attack configuration */
export function attackRolls(flat_bonus: number, acc_diff: AccDiffData): LancerFlowState.AttackRolls {
  let perRoll = Object.values(acc_diff.weapon.plugins);
  let base = perRoll.concat(Object.values(acc_diff.base.plugins));
  return {
    roll: applyPluginsToRoll(rollStr(flat_bonus, acc_diff.base.total), base),
    targeted: acc_diff.targets.map(tad => {
      let perTarget = perRoll.concat(Object.values(tad.plugins));
      return {
        target: tad.target,
        roll: applyPluginsToRoll(rollStr(flat_bonus, tad.total), perTarget),
        usedLockOn: tad.usingLockOn,
      };
    }),
  };
}

// TODO: make a type for weapon attack flow state which narrows the type on item??

/**
 * Flow for rolling weapon attacks against one or more targets
 */
export class WeaponAttackFlow extends Flow<LancerFlowState.WeaponRollData> {
  constructor(uuid: UUIDRef | LancerItem | LancerActor, data?: LancerFlowState.WeaponRollData) {
    // Initialize data if not provided
    data = data || {
      type: "weapon",
      title: "",
      roll_str: "",
      flat_bonus: 0,
      attack_type: "unknown",
      defense: "",
      attack_rolls: { roll: "", targeted: [] },
      attack_results: [],
      hit_results: [],
      damage_results: [],
      crit_damage_results: [],
      reroll_data: "",
    };

    super("WeaponAttackFlow", uuid, data);
    if (!this.state.item) {
      throw new TypeError(`WeaponAttackFlow requires an Item, but none was provided`);
    }

    this.steps.set("initAttackData", initAttackData);
    this.steps.set("checkWeaponDestroyed", checkWeaponDestroyed);
    this.steps.set("checkWeaponLoaded", checkWeaponLoaded);
    this.steps.set("checkWeaponLimited", checkWeaponLimited);
    this.steps.set("setAttackTags", setAttackTags);
    this.steps.set("setAttackEffects", setAttackEffects);
    this.steps.set("setAttackTargets", setAttackTargets);
    this.steps.set("showAttackHUD", showAttackHUD);
    this.steps.set("rollAttacks", rollAttacks);
    // TODO: move damage rolling to damage flow
    this.steps.set("rollDamages", rollDamages);
    this.steps.set("applySelfHeat", applySelfHeat);
    this.steps.set("updateItemAfterAttack", updateItemAfterAttack);
    this.steps.set("printWeaponAttackCard", printWeaponAttackCard);
    // TODO: Start damage flow after attack
    // this.steps.set("applyDamage", DamageApplyFlow)
  }

  async begin(data?: LancerFlowState.WeaponRollData): Promise<boolean> {
    if (
      !this.state.item ||
      (!this.state.item.is_mech_weapon() && !this.state.item.is_pilot_weapon() && !this.state.item.is_npc_feature())
    ) {
      console.log(`${lp} WeaponAttackFlow aborted - no weapon provided!`);
      return false;
    }
    return await super.begin(data);
  }
}

// Doesn't work as a type narrower
function isWeapon(item: LancerItem | null): boolean {
  return item instanceof LancerItem && (item.is_mech_weapon() || item.is_pilot_weapon() || item.is_npc_feature());
}

async function initAttackData(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: { title?: string; flat_bonus?: number; acc_diff?: AccDiffDataSerialized }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  // If we only have an actor, it's a basic attack
  if (!state.item) {
    state.data.title = options?.title ?? "BASIC ATTACK";
    state.data.flat_bonus = 0;
    // TODO: move this actor swap into LancerActor.startAttackFlow when the actor's type is deployable
    // if (state.actor.is_deployable() && state.actor.system.owner?.value) state.actor = state.actor.system.owner?.value;
    if (state.actor.is_pilot() || state.actor.is_mech()) {
      state.data.flat_bonus = state.actor.system.grit;
    } else if (state.actor.is_npc()) {
      state.data.flat_bonus = state.actor.system.tier;
    }
    // TODO: check bonuses for flat attack bonus
    state.data.acc_diff = options?.acc_diff
      ? AccDiffData.fromObject(options.acc_diff)
      : AccDiffData.fromParams(state.actor, [], state.data.title, Array.from(game.user!.targets));
    return true;
  } else {
    // This title works for everything
    state.data.title = options?.title ?? state.item.name!;
    if (state.item.is_mech_weapon()) {
      if (!state.actor.is_mech()) {
        ui.notifications?.warn("Non-mech cannot fire a mech weapon!");
        return false;
      }
      if (!state.actor.system.pilot?.value) {
        ui.notifications?.warn("Cannot fire a weapon on a non-piloted mech!");
        return false;
      }
      let profile = state.item.system.active_profile;
      state.data.flat_bonus = state.actor.system.pilot?.value.system.grit;
      // TODO: check bonuses for flat attack bonus
      state.data.acc_diff = options?.acc_diff
        ? AccDiffData.fromObject(options.acc_diff)
        : AccDiffData.fromParams(state.item, profile.tags, state.data.title, Array.from(game.user!.targets));
      return true;
    } else if (state.item.is_npc_feature()) {
      if (!state.actor.is_npc()) {
        ui.notifications?.warn("Non-NPC cannot fire an NPC weapon!");
        return false;
      }
      let tier_index = (state.item.system.tier_override || state.actor.system.tier) - 1;

      let asWeapon = state.item.system as SystemTemplates.NPC.WeaponData;
      state.data.flat_bonus = asWeapon.attack_bonus[tier_index] ?? 0;
      state.data.acc_diff = options?.acc_diff
        ? AccDiffData.fromObject(options.acc_diff)
        : AccDiffData.fromParams(
            state.item,
            asWeapon.tags,
            state.data.title,
            Array.from(game.user!.targets),
            asWeapon.accuracy[tier_index] ?? 0
          );
      return true;
    } else if (state.item.is_pilot_weapon()) {
      if (!state.actor.is_pilot()) {
        ui.notifications?.warn("Non-pilot cannot fire a pilot weapon!");
        return false;
      }
      state.data.flat_bonus = state.actor.system.grit;
      state.data.acc_diff = options?.acc_diff
        ? AccDiffData.fromObject(options.acc_diff)
        : AccDiffData.fromParams(state.item, state.item.system.tags, state.data.title, Array.from(game.user!.targets));
      return true;
    }
    ui.notifications!.error(`Error in attack flow - ${state.item.name} is an unknown type!`);
    return false;
  }
}

async function checkWeaponDestroyed(state: FlowState<LancerFlowState.WeaponRollData>): Promise<boolean> {
  // If this automation option is not enabled, skip the check.
  if (!getAutomationOptions().limited_loading && getAutomationOptions().attacks) return true;
  if (!state.item || (!state.item.is_mech_weapon() && !state.item.is_pilot_weapon() && !state.item.is_npc_feature())) {
    return false;
  }
  if (state.item.is_pilot_weapon()) {
    return true; // Pilot weapons can't be destroyed
  }
  if (state.item.system.destroyed) {
    ui.notifications!.warn(`Weapon ${state.item.name!} is destroyed!`);
    return false;
  }
  return true;
}

async function checkWeaponLoaded(state: FlowState<LancerFlowState.WeaponRollData>): Promise<boolean> {
  // If this automation option is not enabled, skip the check.
  if (!getAutomationOptions().limited_loading && getAutomationOptions().attacks) return true;
  if (!state.item || (!state.item.is_mech_weapon() && !state.item.is_pilot_weapon() && !state.item.is_npc_feature())) {
    return false;
  }
  if (state.item.isLoading() && !state.item.system.loaded) {
    ui.notifications!.warn(`Weapon ${state.item.name} is not loaded!`);
    return false;
  }
  return true;
}

async function checkWeaponLimited(state: FlowState<LancerFlowState.WeaponRollData>): Promise<boolean> {
  // If this automation option is not enabled, skip the check.
  if (!getAutomationOptions().limited_loading && getAutomationOptions().attacks) return true;
  if (!state.item || (!state.item.is_mech_weapon() && !state.item.is_pilot_weapon() && !state.item.is_npc_feature())) {
    return false;
  }
  if (state.item.isLimited() && state.item.system.uses.value <= 0) {
    ui.notifications!.warn(`Weapon ${state.item.name} has no remaining uses!`);
    return false;
  }
  return true;
}

// TODO: AccDiffData does not allow changing tags after instantiation
async function setAttackTags(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  // Basic attacks have no tags, just continue on.
  if (!state.item) return true;
  if (state.item.is_mech_weapon()) {
    let profile = state.item.system.active_profile;
    state.data.tags = [...(profile.tags ?? []), ...(profile.bonus_tags ?? [])];
    return true;
  } else if (state.item.is_npc_feature()) {
    let asWeapon = state.item.system as SystemTemplates.NPC.WeaponData;
    state.data.tags = asWeapon.tags.map(t => t.save());
    return true;
  } else if (state.item.is_pilot_weapon()) {
    state.data.tags = state.item.system.tags.map(t => t.save());
    return true;
  }
  return false;
}

async function setAttackEffects(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  // Basic attacks have no tags, just continue on.
  if (!state.item) return true;
  if (state.item.is_mech_weapon()) {
    let profile = state.item.system.active_profile;
    state.data.effect = profile.effect;
    state.data.on_attack = profile.on_attack;
    state.data.on_hit = profile.on_hit;
    state.data.on_crit = profile.on_crit;
    return true;
  } else if (state.item.is_npc_feature()) {
    let asWeapon = state.item.system as SystemTemplates.NPC.WeaponData;
    state.data.effect = asWeapon.effect;
    state.data.on_hit = asWeapon.on_hit;
    return true;
  } else if (state.item.is_pilot_weapon()) {
    state.data.effect = state.item.system.effect;
    return true;
  }
  return false;
}

async function setAttackTargets(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  // TODO: AccDiffData does not facilitate setting targets after instantiation?
  // TODO: set metadata for origin and target spaces
  // state.data.target_spaces;
  return true;
}

async function showAttackHUD(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  state.data.acc_diff = await openSlidingHud("attack", state.data.acc_diff!);
  // TODO: click cancel on HUD?
  return true;
}

async function rollAttacks(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);

  state.data.attack_rolls = attackRolls(state.data.flat_bonus, state.data.acc_diff!);
  const hydratedTags = state.data.tags?.map(t => new Tag(t)) ?? [];
  const isSmart = hydratedTags.some(tag => tag.is_smart);

  if (getAutomationOptions().attacks && state.data.attack_rolls.targeted.length > 0) {
    let data = await Promise.all(
      state.data.attack_rolls.targeted.map(async targetingData => {
        let target = targetingData.target;
        let actor = target.actor as LancerActor;
        let attack_roll = await new Roll(targetingData.roll).evaluate({ async: true });
        // @ts-expect-error DSN options aren't typed
        attack_roll.dice.forEach(d => (d.options.rollOrder = 1));
        const attack_tt = await attack_roll.getTooltip();

        if (targetingData.usedLockOn) {
          targetingData.usedLockOn.delete();
        }

        return {
          attack: { roll: attack_roll, tt: attack_tt },
          hit: {
            // @ts-expect-error Token structure has changed
            token: { name: target.name!, img: target.document.texture?.src },
            total: String(attack_roll.total).padStart(2, "0"),
            hit: await checkForHit(isSmart, attack_roll, actor),
            crit: (attack_roll.total || 0) >= 20,
          },
        };
      })
    );

    state.data.attack_results = data.map(d => d.attack);
    state.data.hit_results = data.map(d => d.hit);
    return true;
  } else {
    let attack_roll = await new Roll(state.data.attack_rolls.roll).evaluate({ async: true });
    const attack_tt = await attack_roll.getTooltip();
    state.data.attack_results = [{ roll: attack_roll, tt: attack_tt }];
    state.data.hit_results = [];
    return true;
  }
}

async function rollDamages(state: FlowState<LancerFlowState.WeaponRollData>, options?: {}): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);

  const has_normal_hit =
    (state.data.hit_results.length === 0 && state.data.attack_results.some(attack => (attack.roll.total ?? 0) < 20)) ||
    state.data.hit_results.some(hit => hit.hit && !hit.crit);
  const has_crit_hit =
    (state.data.hit_results.length === 0 && state.data.attack_results.some(attack => (attack.roll.total ?? 0) >= 20)) ||
    state.data.hit_results.some(hit => hit.crit);

  // TODO: move damage rolling into its own flow
  // If we hit evaluate normal damage, even if we only crit, we'll use this in
  // the next step for crits
  if (has_normal_hit || has_crit_hit) {
    for (const x of state.data.damage ?? []) {
      if (!x.val || x.val == "0") continue; // Skip undefined and zero damage
      let damageRoll: Roll | undefined = new Roll(x.val);
      // Add overkill if enabled.
      if (state.data.overkill) {
        damageRoll.terms.forEach(term => {
          if (term instanceof Die) term.modifiers = ["x1", `kh${term.number}`].concat(term.modifiers);
        });
      }

      await damageRoll.evaluate({ async: true });
      // @ts-expect-error DSN options aren't typed
      damageRoll.dice.forEach(d => (d.options.rollOrder = 2));
      const tooltip = await damageRoll.getTooltip();

      state.data.damage_results.push({
        roll: damageRoll,
        tt: tooltip,
        d_type: x.type,
      });
    }
  }

  // If there is at least one crit hit, evaluate crit damage
  if (has_crit_hit) {
    await Promise.all(
      state.data.damage_results.map(async result => {
        const c_roll = await getCritRoll(result.roll);
        // @ts-expect-error DSN options aren't typed
        c_roll.dice.forEach(d => (d.options.rollOrder = 2));
        const tt = await c_roll.getTooltip();
        state.data!.crit_damage_results.push({
          roll: c_roll,
          tt,
          d_type: result.d_type,
        });
      })
    );
  }
  // Calculate overkill heat
  if (state.data.overkill) {
    state.data.overkill_heat = 0;
    (has_crit_hit ? state.data.crit_damage_results : state.data.damage_results).forEach(result => {
      result.roll.terms.forEach(p => {
        if (p instanceof DiceTerm) {
          p.results.forEach(r => {
            if (r.exploded) state.data!.overkill_heat! += 1;
          });
        }
      });
    });
  }
  return true;
}

async function applySelfHeat(
  state: FlowState<LancerFlowState.AttackRollData | LancerFlowState.WeaponRollData>,
  options?: {}
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  let self_heat = 0;

  if (state.data.self_heat) {
    self_heat = (await new Roll(state.data.self_heat).roll({ async: true })).total!;
  }

  if (getAutomationOptions().attack_self_heat) {
    if (state.actor.is_mech() || state.actor.is_npc()) {
      // TODO: overkill heat to move to damage flow
      await state.actor.update({
        "system.heat.value": state.actor.system.heat.value + (state.data.overkill_heat ?? 0) + self_heat,
      });
    }
  }

  return true;
}

async function updateItemAfterAttack(state: FlowState<LancerFlowState.WeaponRollData>, options?: {}): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  if (state.item && getAutomationOptions().limited_loading && getAutomationOptions().attacks) {
    let item_changes: DeepPartial<SourceData.MechWeapon | SourceData.NpcFeature | SourceData.PilotWeapon> = {};
    if (state.item.isLoading()) item_changes.loaded = false;
    if (state.item.isLimited()) item_changes.uses = Math.max(state.item.system.uses.value - 1, 0);
    await state.item.update({ system: item_changes });
  }
  return true;
}

async function printWeaponAttackCard(
  state: FlowState<LancerFlowState.WeaponRollData>,
  options?: { template?: string }
): Promise<boolean> {
  if (!state.data) throw new TypeError(`Attack flow state missing!`);
  const template = options?.template || `systems/${game.system.id}/templates/chat/attack-card.hbs`;
  const flags = {
    attackData: {
      origin: state.actor.id,
      targets: state.data.attack_rolls.targeted.map(t => {
        return { id: t.target.id, lockOnConsumed: !!t.usedLockOn };
      }),
    },
  };
  await renderTemplateStep(state.actor, template, state.data, flags);
  return true;
}

/**
 * Given an evaluated roll, create a new roll that doubles the dice and reuses
 * the dice from the original roll.
 * @param normal The orignal Roll
 * @returns An evaluated Roll
 */
async function getCritRoll(normal: Roll) {
  const t_roll = new Roll(normal.formula);
  await t_roll.evaluate({ async: true });

  const dice_rolls = Array<DiceTerm.Result[]>(normal.terms.length);
  const keep_dice: number[] = Array(normal.terms.length).fill(0);
  normal.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i] = term.results.map(r => {
        return { ...r };
      });
      const kh = parseInt(term.modifiers.find(m => m.startsWith("kh"))?.substr(2) ?? "0");
      keep_dice[i] = kh || term.number;
    }
  });
  t_roll.terms.forEach((term, i) => {
    if (term instanceof Die) {
      dice_rolls[i].push(...term.results);
    }
  });

  // Just hold the active results in a sorted array, then mutate them
  const actives: DiceTerm.Result[][] = Array(normal.terms.length).fill([]);
  dice_rolls.forEach((dice, i) => {
    actives[i] = dice.filter(d => d.active).sort((a, b) => a.result - b.result);
  });
  actives.forEach((dice, i) =>
    dice.forEach((d, j) => {
      d.active = j >= keep_dice[i];
      d.discarded = j < keep_dice[i];
    })
  );

  // We can rebuild him. We have the technology. We can make him better than he
  // was. Better, stronger, faster
  const terms = normal.terms.map((t, i) => {
    if (t instanceof Die) {
      return new Die({
        ...t,
        modifiers: (t.modifiers.filter(m => m.startsWith("kh")).length
          ? t.modifiers
          : [...t.modifiers, `kh${t.number}`]) as (keyof Die.Modifiers)[],
        results: dice_rolls[i],
        number: t.number * 2,
      });
    } else {
      return t;
    }
  });

  return Roll.fromTerms(terms);
}
