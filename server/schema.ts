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
}, 'DiverState');
export type DiverState = SchemaType<typeof DiverState>;

export const DiveState = schema({
  seed: t.uint32(),
  serverTick: t.uint32(),
  divers: t.map(DiverState),
}, 'DiveState');
export type DiveState = SchemaType<typeof DiveState>;
