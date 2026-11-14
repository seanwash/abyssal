export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SERVER_PORT = 2567;

export const SURFACE_Y = 0;
export const FLOOR_BASE_Y = -11;
export const PLAY_HALF_X = 34;
export const PLAY_HALF_Z = 24;
export const DIVER_RADIUS = 0.35;
export const DIVER_HALF_LENGTH = 0.45;

export const SWIM_SPEED = 3.4;
export const VERTICAL_SPEED = 2.2;
export const SWIM_RESPONSE = 3.2;
export const TURN_RESPONSE = 7;

export const MAX_DIVERS = 2;
export const SUITS = [
  { name: 'Rust', color: 0xc4622d },
  { name: 'Teal', color: 0x2f8f8a },
] as const;
