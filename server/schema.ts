import { schema, t, type SchemaType } from '@colyseus/schema';

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
}, 'DiverState');
export type DiverState = SchemaType<typeof DiverState>;

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
export type CreatureState = SchemaType<typeof CreatureState>;

export const DiveState = schema({
  seed: t.uint32(),
  serverTick: t.uint32(),
  divers: t.map(DiverState),
  creatures: t.map(CreatureState),
  phase: t.uint8(),
  phaseTime: t.float32(),
  clock: t.float32(),
}, 'DiveState');
export type DiveState = SchemaType<typeof DiveState>;
