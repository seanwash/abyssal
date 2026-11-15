export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
export const SERVER_PORT = 2567;

export const SURFACE_Y = 0;
export const FLOOR_BASE_Y = -8;
export const PLAY_HALF_X = 22;
export const PLAY_HALF_Z = 16;
/** The diver collides as an ellipsoid this wide and this tall, about the size of its body lying prone. */
export const DIVER_RADIUS = 0.4;
export const DIVER_HALF_HEIGHT = 0.3;

export const SWIM_SPEED = 3.4;
export const VERTICAL_SPEED = 2.2;
export const SWIM_RESPONSE = 3.2;
export const TURN_RESPONSE = 7;

export const MAX_DIVERS = 2;
export const SUITS = [
  { name: "Rust", color: 0xc4_62_2d },
  { name: "Teal", color: 0x2f_8f_8a },
] as const;
