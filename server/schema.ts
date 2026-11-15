import { schema, t } from '@colyseus/schema';
import type { SchemaType } from '@colyseus/schema';

export const DiverState = schema({
  name: t.string(),
  suit: t.uint8(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  vx: t.float32(),
  vy: t.float32(),
  vz: t.float32(),
  yaw: t.float32(),
  ack: t.uint32(),
  air: t.float32(),
  down: t.uint8(),
  revive: t.float32(),
  /** 1 while the diver is out of the water at the field station. */
  aboard: t.uint8(),
  /** Item keys in the diver's dive bag. */
  bag: t.array('string'),
}, 'DiverState');
export type DiverStateType = SchemaType<typeof DiverState>;

export const CreatureState = schema({
  kind: t.string(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  yaw: t.float32(),
  pitch: t.float32(),
  mode: t.uint8(),
  meter: t.float32(),
  charge: t.float32(),
}, 'CreatureState');
export type CreatureStateType = SchemaType<typeof CreatureState>;

export const LootState = schema({
  item: t.string(),
  x: t.float32(),
  y: t.float32(),
  z: t.float32(),
  state: t.uint8(),
  work: t.float32(),
  hands: t.uint8(),
}, 'LootState');
export type LootStateType = SchemaType<typeof LootState>;

export const DiveState = schema({
  seed: t.uint32(),
  serverTick: t.uint32(),
  divers: t.map(DiverState),
  creatures: t.map(CreatureState),
  loot: t.map(LootState),
  phase: t.uint8(),
  phaseTime: t.float32(),
  clock: t.float32(),
}, 'DiveState');
export type DiveStateType = SchemaType<typeof DiveState>;
