# Abyssal: rendering and multiplayer spike

A kelp forest off Cannery Row with a glowing Pacific sea nettle, and two divers who see each other move under an authoritative server.

## Run it

Needs Node 22.18 or newer.

```bash
npm install
npm run dev
```

This starts the dive server on port 2567 and the game on port 5173. Open `http://localhost:5173` on this computer. On a second device on the same wifi, open `http://<this computer's IP>:5173` (Vite prints the Network address).

Opening the game without a party code starts a new party and puts its code in the address bar, for example `?party=KQTD`. **Copy invite link** in the bottom-right card copies a link to the same party; whoever opens it joins your dive. A party holds two divers.

If a tab reloads, a laptop sleeps or the connection drops, the tab rejoins on its own and gets its diver back where it was. The server holds a dropped diver's seat for 15 minutes. Each tab or window is its own diver, so two windows on one computer make a party of two.

Controls: **WASD** or the arrow keys swim, **Space** or **E** rises, **Shift** or **Q** sinks. **F** or **Enter** acts on the nearest thing in front of you: hold it to calm the lingcod, buddy-breathe a downed diver or bag a find, press it to harpoon the drone, climb out at the station's line or dive again. **Alt** shows the labels of every find your lamp reaches. **B** seats a bot buddy in the empty second seat, or removes it. **M** mutes the sound. A gamepad works too (left stick, X or right trigger to act).

The dive is zone 1, Cannery Row: a shore dive from San Carlos Beach north along the breakwater, then west under the kelp past McAbee Boulders and the Urchin Barren, through a gap in a granite wall (the Surge Gate) to the cannery's ruins, about 250 m in all. The Anchovy Line runs off it north-east into the bay. Each part of the route has its own water: green-gold and bright in the shallows, darker and bluer out on the Anchovy Line and past the Surge Gate, nearly black at the ruins. Its name shows top left as you swim into it. The zone is authored in `shared/zones/cannery-row.ts` as layers (ground and its reef, barren and fill, crevices, rocks, kelp groves and the lanes kept clear through them, and what lives and lies in each part), and `shared/zones/build.ts` turns that into the level the server and both browsers share. Each diver's lamp lights by 3D distance, so the floor only shows when you swim down to it. A shadow and a plumb line under each diver show its height above the ground.

**The first fight.** A sick lingcod guards its egg mass among the rocks of the Kelp Corridors and lunges at divers who come close; it glows violet until you calm it, and it can only be calmed between lunges. A survey drone patrols midwater over the Urchin Barren, hunts divers it can see and charges an electric shock. Air drains faster the deeper you are and refills at the surface; bites and shocks cost air. A diver out of air sinks until the other diver holds the action key beside them. Calm the lingcod and wreck the drone to clear the reef; it resets after a short pause, or straight away if both divers are down.

**Bag, surface, come back tomorrow.** Each diver starts the evening at the field station, the dive's town, with the party's shelf of everything logged so far, and dives from there. Finds lie on the reef with their Latin names on the ground, coloured by kind the way Diablo II colours items: specimens plain, water samples blue, fossils green, evidence gold. Some lie in the open; the rest are low in the kelp, out on the Anchovy Line, and at the far ends of crevices you have to swim down into. The ammonite lies in McAbee's rubble, a heap of pale fill that doesn't match the granite around it. Holding the action key on a find bags it, six to a bag. A fossil or the ammonite takes both divers holding the key on it at once to pry free (the bot buddy helps, and swims over from wherever it is). The wrecked drone drops a housing with a maker's mark. Finds count once a diver climbs out at a station's line, the float with the lantern, which logs and saves them; there is one at San Carlos Beach and one at the exit past the ruins. A bag that is never logged is lost if both divers go down, and its finds go back where they lay. Logged fossils and evidence are gone from the reef for good; specimens and samples grow back when the reef resets.

The save is one file per party code, written each time a diver logs finds: in the deployment's data directory on an Amp Box (`$AMP_DEPLOYMENT_DATA_DIRECTORY/saves`), which survives deploys and restarts, and in `./saves` otherwise (`ABYSSAL_SAVES` picks another folder). Coming back with the same party link picks up the same log.

Useful URL options:

| Option | Effect |
| --- | --- |
| `?party=KQTD` | Join this party instead of starting a new one |
| `?name=Jaime` | Diver name shown to the other player |
| `?lines=600` | Render about this many rows before upscaling to the screen (default 450) |
| `?fps=0` | Draw on every display refresh instead of capping at 60 fps |
| `?webgl` | Force the WebGL2 backend instead of WebGPU |
| `?scale=0.5` | Render at lower resolution on a slow machine |
| `?server=ws://host:2567` | Point at another dive server |

If the server can't be reached, the client dives solo after a few seconds and keeps trying to join.

The card in the bottom-right corner also shows the frame time, the frame rate and the ping.

## Host it

```bash
npm run build   # the client into dist/, the server into build/server.mjs
npm start       # serves both on $PORT (default 2567)
```

One process serves the built client and the dive server's websocket on one port, so the game is one link. `build/server.mjs` bundles the server's dependencies and needs only `dist/` beside it. `.amp/box.yaml` deploys it to an Amp Box with `amp boxes deploy`.

## Check it

Run these before committing:

```bash
npm run typecheck      # tsc
npm run lint           # oxlint with Ultracite's core preset (oxlint.config.ts)
npm run format:check   # oxfmt with Ultracite's preset (oxfmt.config.ts); npm run format rewrites files in place
```

Fix what the linter reports rather than turning its rules off. GitHub Actions runs the same three on every push to main and every pull request (`.github/workflows/check.yml`).

## Bots

`npm run bots` opens two separate browsers against a running `npm run dev`, swims both divers with real key presses, and saves screenshots and one video per client in `bots/out`.

```bash
npx playwright install chromium   # once
npm run bots
```

Without a GPU (CI, cloud boxes) use the bundled software-rendered Chromium and slow the key presses down to match its frame rate:

```bash
BROWSER=sparticuz PACE=4 W=800 H=450 QS='&scale=0.5' npm run bots
```

`bots/smoke.ts` checks the server alone: party rooms, input acknowledgement, a full party, and a dropped diver rejoining its own seat and position (`npx tsx bots/smoke.ts`; set `SERVER_URL` to check another server).

`bots/save.ts` checks bagging, prying with the bot buddy, logging at the station and the save against the built server, run the way a Box runs it: it stops the server, starts a second read-only release on the same data directory, and checks the party's log and the reef are as they were (`npm run build && npx tsx bots/save.ts`).

## How it fits together

| Path | Role |
| --- | --- |
| `shared/` | Level layout, constants and diver movement and collision, used identically by client and server |
| `server/` | Colyseus room per party: 30 Hz fixed step, applies queued inputs, broadcasts diver state, holds dropped divers' seats; serves the built client in production |
| `client/src/net.ts` | Predicts your own diver, reconciles with the server, interpolates the other diver, rejoins after a drop |
| `client/src/party.ts` | Party code, invite link, this tab's diver id, frame time and ping card |
| `shared/arena.ts` | The fight: air, buddy breathing, the action key's target and the reef's phases. It runs every creature through one interface. The server runs it |
| `shared/creatures/` | One file per creature's rules (`lingcod.ts`, `drone.ts`), the `Species` interface they share in `common.ts`, and the registry in `index.ts` |
| `server/buddy.ts` | The bot buddy that fills the second seat |
| `client/src/creatures/` | One file per creature's look, registered by kind in `index.ts` |
| `client/src/fight.ts` | Fight effects (harpoon line, shock, the calm release), built from `sparks.ts`, `pulses.ts` (soothing ripples and flashes) and the drawing helpers in `fight-kit.ts` that the creature views share |
| `client/src/sound.ts` | Fight sounds synthesised with Web Audio, so they add nothing to the download |
| `client/src/nettle.ts` | Procedural _Chrysaora fuscescens_: scalloped bell, oral arms, tentacles, pulse |
| `client/src/env.ts` | Seafloor with caustics, granite boulders, giant kelp, scatter, light shafts, marine snow |
| `client/src/diver.ts` | Procedural diver with headlamp, plumb line, fin kick and exhaled bubbles |
| `client/src/iso.ts` | Isometric view: orthographic camera, low-resolution pixels, each diver's light radius and drop shadow, bloom |
| `client/src/hud.ts` | Plate-style specimen card with depth, air and bag, specimen label, diver names, action prompts, the station marker |
| `shared/loot/items.ts` | Every find: its Latin and common name, kind, field note, and whether it takes both divers |
| `shared/loot/haul.ts` | Finds on the reef and in the divers' bags: bagging, prying, drops, lost bags. The server runs it |
| `shared/station.ts` | The field station: where divers climb out, and the party's log of finds, which is the save |
| `server/save.ts` | Reads and writes each party's log as a file, replacing it in one rename |
| `client/src/loot/` | Each find's look (`looks.ts`), and its glint and ground label (`view.ts`) |
| `client/src/station/` | The station's line and lantern on the reef (`line.ts`), and its screen with the shelf (`screen.ts`) |

To add a find: add it to `shared/loot/items.ts`, give it a look in `client/src/loot/looks.ts`, and place it in the level's `loot` list. A creature that leaves something behind names it in its species' `drops`.

To add a creature: write its rules in `shared/creatures/<kind>.ts` and its look in `client/src/creatures/<kind>.ts`, register both by kind (the rules through `anySpecies` with a type guard, as `isLingcod` does), and place it in the level's `creatures` list. The arena, the network and the HUD need no change.

Rendering uses three.js `WebGPURenderer` with TSL node materials; browsers without WebGPU fall back to WebGL2 automatically.
