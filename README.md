# Abyssal: rendering and multiplayer spike

A kelp forest off Cannery Row with a glowing Pacific sea nettle, and two divers who see each
other move under an authoritative server.

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

This starts the dive server on port 2567 and the game on port 5173. Open
`http://localhost:5173` on this computer. On a second device on the same wifi, open
`http://<this computer's IP>:5173` (Vite prints the Network address). The first two players
join the same dive.

Controls: **WASD** or the arrow keys swim, **Space** or **E** rises, **Shift** or **Q** sinks. **F** or **Enter** acts on
the nearest thing in front of you: hold it to calm the lingcod or buddy-breathe a downed diver, press it to harpoon the
drone. **B** seats a bot buddy in the empty second seat, or removes it. A gamepad works too (left stick, X or right
trigger to act).

The dive is a small test reef: a reef flat at about 8 m, a sand channel (the Hollow) dropping to about 14 m,
a boulder pinnacle that rises to within 2 m of the surface, and an arch to swim under. Each diver's lamp
lights by 3D distance, so the floor only shows when you swim down to it. A shadow and a plumb line under
each diver show its height above the ground.

**The first fight.** A sick lingcod guards its egg mass on the floor of the Hollow and lunges at divers who come close;
it glows violet until you calm it, and it can only be calmed between lunges. A survey drone patrols midwater around the
pinnacle, hunts divers it can see and charges an electric shock. Air drains faster the deeper you are and refills at
the surface; bites and shocks cost air. A diver out of air sinks until the other diver holds the action key beside
them. Calm the lingcod and wreck the drone to clear the reef; it resets after a short pause, or straight away if both
divers are down.

Useful URL options:

| Option | Effect |
| --- | --- |
| `?name=Jaime` | Diver name shown to the other player |
| `?lines=600` | Render about this many rows before upscaling to the screen (default 450) |
| `?fps=0` | Draw on every display refresh instead of capping at 60 fps |
| `?webgl` | Force the WebGL2 backend instead of WebGPU |
| `?scale=0.5` | Render at lower resolution on a slow machine |
| `?server=ws://host:2567` | Point at another dive server |

If the server can't be reached, the client dives solo after a few seconds.

## Bots

`npm run bots` opens two separate browsers against a running `npm run dev`, swims both divers
with real key presses, and saves screenshots and one video per client in `bots/out`.

```bash
npx playwright install chromium   # once
npm run bots
```

Without a GPU (CI, cloud boxes) use the bundled software-rendered Chromium and slow the key
presses down to match its frame rate:

```bash
BROWSER=sparticuz PACE=4 W=800 H=450 QS='&scale=0.5' npm run bots
```

`bots/smoke.ts` checks the server alone: two headless clients join, move, and confirm the
server acknowledged every input (`npx tsx bots/smoke.ts`).

## How it fits together

| Path | Role |
| --- | --- |
| `shared/` | Level layout, constants and diver movement and collision, used identically by client and server |
| `shared/arena.ts` | The fight: air, buddy breathing, the action key's target and the reef's phases. It runs every creature through one interface. The server runs it |
| `shared/creatures/` | One file per creature's rules (`lingcod.ts`, `drone.ts`), the `Species` interface they share in `common.ts`, and the registry in `index.ts` |
| `server/buddy.ts` | The bot buddy that fills the second seat |
| `client/src/creatures/` | One file per creature's look, registered by kind in `index.ts` |
| `client/src/fight.ts` | Harpoon and shock effects, and drawing helpers the creature views share |

To add a creature: write its rules in `shared/creatures/<kind>.ts` and its look in `client/src/creatures/<kind>.ts`,
register both by kind, and place it in the level's `creatures` list. The arena, the network and the HUD need no
change.
| `server/` | Colyseus room: 30 Hz fixed step, applies queued inputs, broadcasts diver state |
| `client/src/net.ts` | Predicts your own diver, reconciles with the server, interpolates the other diver |
| `client/src/nettle.ts` | Procedural *Chrysaora fuscescens*: scalloped bell, oral arms, tentacles, pulse |
| `client/src/env.ts` | Seafloor with caustics, granite boulders, giant kelp, scatter, light shafts, marine snow |
| `client/src/diver.ts` | Procedural diver with headlamp, plumb line, fin kick and exhaled bubbles |
| `client/src/iso.ts` | Isometric view: orthographic camera, low-resolution pixels, each diver's light radius and drop shadow, bloom |
| `client/src/hud.ts` | Plate-style specimen card, specimen label, diver names |

Rendering uses three.js `WebGPURenderer` with TSL node materials; browsers without WebGPU fall
back to WebGL2 automatically.
