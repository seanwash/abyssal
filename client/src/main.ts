import { pass } from "three/tsl";
import * as THREE from "three/webgpu";

import { pickTarget } from "../../shared/arena";
import type { Fx, Target } from "../../shared/arena";
import { DT, SUITS } from "../../shared/constants";
import { SPECIES } from "../../shared/creatures";
import { groundHeight, nearestStation } from "../../shared/level";
import type { Level } from "../../shared/level";
import { lootReach } from "../../shared/loot/haul";
import { ITEMS } from "../../shared/loot/items";
import { stationReach } from "../../shared/station";
import { buildLevel } from "../../shared/zones";
import { Chart } from "./chart/chart";
import { VIEWS } from "./creatures";
import { DiverView } from "./diver";
import {
  buildBoulders,
  buildFloor,
  buildGodRays,
  buildKelp,
  buildMarineSnow,
  buildScatter,
  cutaway,
  PALETTE,
} from "./env";
import { Effects } from "./fight";
import { Hud } from "./hud";
import { readAct, readSwim } from "./input";
import {
  applyIsoScene,
  fitIso,
  ISO,
  isoCamera,
  isoDiverLight,
  isoOutput,
  isoPixelRatio,
} from "./iso";
import { loader } from "./loader";
import { LootView, TINT } from "./loot/view";
import { Net } from "./net";
import type { CreatureSnapshot, DiverSnapshot, LootSnapshot } from "./net";
import { SeaNettle } from "./nettle";
import { PARTY } from "./party";
import { near, sound } from "./sound";
import { StationLine } from "./station/line";
import { StationScreen } from "./station/screen";
import { settleWater, tuneWater, water } from "./water";

import css from "./style.css?inline";

// The game's styles ship inside the script rather than as a stylesheet, which would hold back the
// first paint of the loading plate until it downloaded.
document.head.append(
  Object.assign(document.createElement("style"), { textContent: css })
);

const params = new URLSearchParams(location.search);

/** Frames per second to draw; 0 draws on every display refresh. */
const FPS_CAP = Number(params.get("fps") ?? 60);

const pixelRatio = () => {
  if (params.has("scale")) {
    return Number(params.get("scale"));
  }
  return isoPixelRatio(Number(params.get("lines") ?? ISO.lines));
};

/**
 * How walled in a diver is, 0 to 1: the share of eight directions where ground or rock rises to its
 * height within a couple of metres, as down in a crevice. A diver's light dims by it, since close
 * walls all around would catch it as a white glare.
 */
const enclosure = (level: Level, x: number, y: number, z: number) => {
  let k = 0;
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    k += Math.max(
      0,
      Math.min(
        1,
        (groundHeight(
          level,
          x + Math.cos(a) * 2.2,
          z + Math.sin(a) * 2.2,
          y + 3
        ) -
          (y + 0.3)) /
          1
      )
    );
  }
  // Slopes and a boulder beside the diver stay at full light; only a slot's walls on most sides dim it.
  const e = Math.max(0, Math.min(1, (k / 8 - 0.3) / 0.5));
  return e * e * (3 - 2 * e);
};

const yieldToBrowser = () => {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, 0);
  return promise;
};

/** Resolves after two display refreshes, by when the frame drawn in between has been submitted. */
const twoFrames = () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  requestAnimationFrame(() => {
    requestAnimationFrame(resolve);
  });
  return promise;
};

const placeCamera = (camera: THREE.Camera, target: THREE.Vector3) => {
  const cp = Math.cos(ISO.pitch);
  camera.position.set(
    target.x + Math.sin(ISO.yaw) * cp * ISO.distance,
    target.y + Math.sin(ISO.pitch) * ISO.distance,
    target.z + Math.cos(ISO.yaw) * cp * ISO.distance
  );
  camera.lookAt(target);
};

/** How loud a sound at a point is for the listening diver: by distance, or full when it has no place. */
type Loudness = (p?: ArrayLike<number>) => number;

/** What one fx needs from the frame it plays in. */
interface FxScene {
  f: Fx;
  at: ArrayLike<number> | undefined;
  divers: DiverSnapshot[];
  me: DiverSnapshot;
  loud: Loudness;
}

const main = async () => {
  const level = buildLevel();
  // Joining the party runs while the renderer starts and the reef is built.
  const net = new Net(level);
  const joining = net.connect(params.get("name") ?? "");

  loader.step("Trimming the lamps", 0.04);
  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    forceWebGL: params.has("webgl"),
  });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.style.imageRendering = "pixelated";
  document.body.append(renderer.domElement);
  await renderer.init();

  loader.step("Growing the kelp", 0.06);
  const scene = new THREE.Scene();
  applyIsoScene(scene);

  const camera = isoCamera();

  const sky = new THREE.HemisphereLight(0x6f_b3_c4, 0x1a_24_20, 0.35);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 0.9);
  scene.add(sky, sun, sun.target);
  const skyIntensity = sky.intensity;
  const sunIntensity = sun.intensity;

  // Kelp generation is the longest step, so it gives the browser a turn between cells.
  scene.add(buildFloor(level), buildBoulders(level), buildScatter(level));
  await yieldToBrowser();
  scene.add(await buildKelp(level, yieldToBrowser));
  const rays = buildGodRays();
  scene.add(rays);
  const snow = buildMarineSnow();
  scene.add(snow.object);

  // Every creature's view is built up front, so a reef reset never adds materials mid-dive.
  const creatureViews = new Map(
    level.creatures.map((s) => [s.id, VIEWS[s.kind](s)] as const)
  );
  for (const v of creatureViews.values()) {
    scene.add(...v.objects);
  }
  const effects = new Effects();
  scene.add(...effects.objects);
  const lootView = new LootView(level);
  scene.add(...lootView.objects);
  const line = new StationLine(level);
  scene.add(...line.objects);
  const stations = stationReach(level);
  const reach = [...stations];

  const nettles = level.jellies.map((j) => new SeaNettle(j));
  for (const n of nettles) {
    scene.add(n.group);
  }
  const hero = nettles.find((_, i) => level.jellies[i].hero) ?? null;
  const diverLight = isoDiverLight();
  const partnerLight = isoDiverLight();
  scene.add(diverLight, partnerLight);

  const lightIntensity = diverLight.intensity;
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  pipeline.outputNode = isoOutput(sceneColor);

  const hud = new Hud();
  const chart = new Chart(level);
  const stationScreen = new StationScreen(() => net.dive());
  loader.step(`Hailing party ${PARTY}`, 0.06);
  await joining;

  // One view per suit, both always in the scene, so a diver joining or leaving never changes the
  // number of lights. compileAsync spreads shader builds over frames instead of blocking the first render.
  const views = SUITS.map((_, suit) => {
    const v = new DiverView(suit);
    v.setPresent(false);
    scene.add(v.root, ...v.worldObjects);
    return v;
  });
  const camTarget = new THREE.Vector3(net.sim.x, net.sim.y, net.sim.z);
  placeCamera(camera, camTarget);
  settleWater(level, camTarget.x, camTarget.z);
  loader.step("Mixing the glow", 0.5);
  // The pass compiles through the renderer, which reports each finished pipeline to its own progress callback.
  const compile = renderer.compileAsync.bind(renderer);
  renderer.compileAsync = (s, c, t) =>
    compile(s, c, t, (e) => loader.progress(e.loaded / e.total));
  await scenePass.compileAsync(renderer);
  renderer.compileAsync = compile;
  // The precompile misses the bloom and output passes and a few scene materials. Their pipelines are
  // built the same non-blocking way during frames drawn under the loading plate: the renderer skips
  // an object until its pipeline is ready, so no visible frame waits on the GPU driver.
  // three's types leave out the backend's pipeline hook, which both the WebGPU and WebGL backends have.
  const backend = renderer.backend as unknown as {
    createRenderPipeline: (
      object: unknown,
      promises: Promise<void>[] | null
    ) => void;
  };
  const createPipeline = backend.createRenderPipeline;
  const warming: Promise<void>[] = [];
  backend.createRenderPipeline = (o, p) =>
    createPipeline.call(backend, o, p ?? warming);

  const clock = new THREE.Timer();
  let acc = 0;
  let frames = 0;
  let frameMs = 0;
  /** Camera shake from a hit on your own diver, 0 to 1. */
  let shake = 0;
  const soothing = new Map<
    string,
    { meter: number; rising: number; next: number }
  >();
  /** When each fossil being pried last scraped, to space out the grinding sound and grit. */
  const prying = new Map<string, number>();
  let actWas = false;
  // A tap of the action key can start and end between two frames, so key presses are caught as they happen.
  let tapped = false;
  addEventListener("keydown", (e) => {
    if (!e.repeat && e.code === "Space") {
      tapped = true;
    }
  });

  addEventListener("keydown", (e) => {
    if (e.code === "KeyB" && !e.repeat) {
      net.toggleBuddy();
    }
  });

  addEventListener("resize", () => {
    fitIso(camera);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
  });

  /** Sim steps for the time since the last frame, at most ten so a stalled tab doesn't fast-forward. */
  const stepSim = (dt: number) => {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 10) {
      net.step(readSwim(ISO.yaw), readAct());
      acc -= DT;
      steps += 1;
    }
    if (steps === 10) {
      acc = 0;
    }
    net.decayOffset(dt);
  };

  const updateDivers = (divers: DiverSnapshot[], dt: number, t: number) => {
    for (const [suit, v] of views.entries()) {
      const d = divers.find((x) => x.suit === suit);
      v.setPresent(!!d && !d.aboard);
      if (d && !d.aboard) {
        const ahead = groundHeight(
          level,
          d.x + Math.sin(d.yaw),
          d.z + Math.cos(d.yaw),
          d.y + 1
        );
        v.update(
          dt,
          t,
          new THREE.Vector3(d.x, d.y, d.z),
          d.yaw,
          new THREE.Vector3(d.vx, d.vy, d.vz),
          groundHeight(level, d.x, d.z, d.y),
          d.down,
          ahead
        );
      }
    }
  };

  const updateCreatures = (
    creatures: CreatureSnapshot[],
    dt: number,
    t: number
  ) => {
    for (const [id, v] of creatureViews) {
      const c = creatures.find((x) => x.id === id);
      v.root.visible = !!c;
      if (c) {
        v.update(dt, t, c);
      }
    }
  };

  const collected = ({ f, me, loud }: FxScene) => {
    const it = f.item ? ITEMS[f.item] : undefined;
    const big = f.k === "pried";
    if (f.p) {
      effects.collect(f.p, TINT[it?.category ?? "specimen"], big);
    }
    const v = f.by === me.id ? 1 : loud(f.p) * 0.7;
    if (big) {
      sound.pried(v);
    } else {
      sound.bagged(v, it?.category === "fossil" || it?.category === "evidence");
    }
  };
  /** The effect and sound each kind of fx plays; kinds left out only show in the HUD. */
  const fxPlayers: Partial<Record<Fx["k"], (s: FxScene) => void>> = {
    harpoon: ({ f, loud }) => {
      if (f.p && f.q) {
        effects.harpoon(f.p, f.q);
        sound.harpoon(loud(f.q));
      }
    },
    shock: ({ f, loud }) => {
      if (f.p) {
        effects.shock(f.p);
        sound.shock(loud(f.p));
      }
    },
    bite: ({ f, divers, loud }) => {
      const d = divers.find((x) => x.id === f.id);
      if (d) {
        views[d.suit]?.hurt(d.local ? 1 : 0.7);
      }
      if (f.p) {
        effects.hurt(f.p);
      }
      if (d?.local) {
        shake = 1;
        hud.hurt();
      }
      sound.hurt(d?.local ? 1 : loud(f.p) * 0.6);
    },
    calmed: ({ at, loud }) => {
      if (at) {
        effects.calmed(at);
        sound.calmed(Math.max(0.5, loud(at)));
      }
    },
    wrecked: ({ at, loud }) => {
      if (at) {
        effects.wrecked(at);
        sound.wrecked(loud(at));
      }
    },
    scattered: ({ f, loud }) => {
      if (f.p) {
        effects.scattered(f.p);
        sound.scattered(loud(f.p));
      }
    },
    down: () => {
      sound.down();
    },
    revived: () => {
      sound.revived();
    },
    bagged: collected,
    pried: collected,
    dropped: ({ f, loud }) => {
      if (f.p) {
        effects.collect(f.p, TINT[ITEMS[f.item ?? ""]?.category ?? "evidence"]);
        sound.dropped(loud(f.p));
      }
    },
    returned: ({ f, me }) => {
      if (f.id === me.id) {
        sound.returned();
      }
    },
    aboard: ({ f, me }) => {
      if (f.id === me.id) {
        sound.aboard();
      }
    },
    dived: ({ f, me }) => {
      if (f.id === me.id) {
        sound.dived();
      }
    },
  };

  const playFx = (
    divers: DiverSnapshot[],
    creatures: CreatureSnapshot[],
    me: DiverSnapshot,
    loud: Loudness
  ) => {
    for (const f of net.fx.splice(0)) {
      const c = creatures.find((x) => x.id === f.id);
      const at = c ? [c.x, c.y, c.z] : f.p;
      if (c) {
        creatureViews.get(c.id)?.react(f);
      }
      fxPlayers[f.k]?.({ f, at, divers, me, loud });
      hud.event(f, divers, creatures);
    }
  };

  /** While a diver calms an animal, it gives off a soft ripple and a chime that climbs as it settles. */
  const soothe = (creatures: CreatureSnapshot[], t: number, loud: Loudness) => {
    for (const c of creatures) {
      if (SPECIES[c.kind]?.action !== "calm") {
        continue;
      }
      let s = soothing.get(c.id);
      if (!s) {
        s = { meter: c.meter, rising: 0, next: 0 };
        soothing.set(c.id, s);
      }
      if (c.meter > s.meter + 1e-4) {
        s.rising = t;
      }
      s.meter = c.meter;
      if (t - s.rising < 0.25 && t >= s.next) {
        s.next = t + 0.55;
        effects.soothe([c.x, c.y, c.z]);
        sound.soothe(c.meter, Math.max(0.4, loud([c.x, c.y, c.z])));
      }
    }
  };

  /** Two divers prying a fossil grind it loose: grit and a scrape every few tenths of a second. */
  const grind = (loot: LootSnapshot[], t: number, loud: Loudness) => {
    for (const l of loot) {
      if (!ITEMS[l.item]?.pry || l.hands < 2 || l.work <= 0) {
        continue;
      }
      if (t < (prying.get(l.id) ?? 0)) {
        continue;
      }
      prying.set(l.id, t + 0.35);
      effects.grit([l.x, l.y + 0.1, l.z]);
      sound.scrape(Math.max(0.4, loud([l.x, l.y, l.z])));
    }
  };

  /** Moves the camera after your diver, and the cutaway, lights and sun with it. */
  const updateCamera = (
    divers: DiverSnapshot[],
    me: DiverSnapshot,
    dt: number
  ) => {
    const partner = divers.find((d) => !d.local && !d.aboard);
    // At the station the camera rests above the line, so the reef shows behind the station's screen.
    const moor = nearestStation(level, me.x, me.z);
    const at = me.aboard ? { x: moor.x, y: -1, z: moor.z } : me;
    const lead = me.aboard
      ? new THREE.Vector3()
      : new THREE.Vector3(me.vx, 0, me.vz).multiplyScalar(0.35);
    const goal = new THREE.Vector3(at.x, me.aboard ? -2.5 : at.y, at.z).add(
      lead
    );
    camTarget.lerp(goal, 1 - Math.exp(-3.5 * dt));
    shake *= Math.exp(-8 * dt);
    const jitter = shake * 0.18;
    placeCamera(
      camera,
      jitter > 1e-3
        ? camTarget
            .clone()
            .add(
              new THREE.Vector3(
                (Math.random() - 0.5) * jitter,
                (Math.random() - 0.5) * jitter,
                (Math.random() - 0.5) * jitter
              )
            )
        : camTarget
    );

    cutaway.diver.value.set(at.x, at.y, at.z);
    camera.updateMatrixWorld();
    cutaway.diverView.value
      .set(at.x, at.y, at.z)
      .applyMatrix4(camera.matrixWorldInverse);
    snow.target.value.copy(camTarget);
    if (partner) {
      cutaway.partner.value.set(partner.x, partner.y, partner.z);
    } else {
      cutaway.partner.value.set(0, 1e4, 0);
    }
    diverLight.position.set(at.x, at.y + 1.6, at.z);
    // Two lamps lighting the same patch would add up to a glare, so each dims as the divers close in.
    const shared = partner
      ? Math.max(
          0,
          1 -
            Math.hypot(partner.x - at.x, partner.y - at.y, partner.z - at.z) /
              (ISO.radius * 2)
        )
      : 0;
    const lamp = lightIntensity * (1 - 0.4 * shared);
    diverLight.intensity =
      lamp * (1 - 0.85 * enclosure(level, at.x, at.y, at.z));
    partnerLight.position.copy(cutaway.partner.value).y += 1.6;
    partnerLight.intensity = partner
      ? lamp * (1 - 0.85 * enclosure(level, partner.x, partner.y, partner.z))
      : 0;
    sun.position.set(camTarget.x - 8, 18, camTarget.z + 12);
    sun.target.position.copy(camTarget);
    rays.position.set(camTarget.x, 0, camTarget.z);

    const area = tuneWater(level, at.x, at.z, dt);
    hud.place(area);
    sky.intensity = skyIntensity * (0.45 + 0.55 * water.sun.value);
    sun.intensity = sunIntensity * water.sun.value;
    diverLight.distance = ISO.radius * 2.2 * water.reach.value;
    partnerLight.distance = diverLight.distance;
  };

  /** Picks what the action key aims at and acts on a press, then draws the labels, station screen and HUD. */
  const updateAction = (
    divers: DiverSnapshot[],
    me: DiverSnapshot,
    creatures: CreatureSnapshot[],
    loot: LootSnapshot[],
    dt: number,
    t: number
  ) => {
    reach.length = stations.length;
    reach.push(...lootReach(loot));
    const target =
      me.down || me.aboard
        ? null
        : pickTarget(
            level,
            { id: me.id, x: me.x, y: me.y, z: me.z, yaw: me.yaw },
            divers,
            creatures,
            reach
          );
    // The action key climbs out at the line on a press, and dives again from the station.
    const act = readAct();
    if (tapped || (act && !actWas)) {
      if (me.aboard) {
        net.dive();
      } else if (target?.kind === "climb") {
        net.climb();
      }
    }
    actWas = act;
    tapped = false;
    lootView.update(
      dt,
      t,
      loot,
      divers,
      target,
      camera,
      innerWidth,
      innerHeight
    );
    lootView.hideLabels(me.aboard);
    stationScreen.update(divers, net.status === "online");
    hud.update(
      divers,
      net.status,
      camera,
      hero ? hero.worldPosition : null,
      innerWidth,
      innerHeight
    );
    hud.fight(
      divers,
      creatures,
      loot,
      nearestStation(level, me.x, me.z),
      target,
      act,
      net,
      camera,
      innerWidth,
      innerHeight
    );
    return target;
  };

  /** The debug hook bots/record.ts reads. */
  const publishDebug = (
    divers: DiverSnapshot[],
    creatures: CreatureSnapshot[],
    loot: LootSnapshot[],
    target: Target | null
  ) => {
    (window as unknown as { abyssal: unknown }).abyssal = {
      status: net.status,
      divers,
      creatures,
      loot,
      target,
      phase: net.phase,
      corrections: net.corrections,
      frames,
      frameMs,
      log: net.station?.log ?? null,
    };
  };

  let last = 0;
  const frame = (now: number) => {
    // Skipping refreshes that arrive sooner than 60% of the frame interval halves a 120 Hz display
    // to 60 fps while 60 and 90 Hz displays still draw every refresh.
    if (FPS_CAP && now - last < 600 / FPS_CAP) {
      requestAnimationFrame(frame);
      return;
    }
    last = now;
    const f0 = performance.now();
    clock.update();
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.getElapsed();
    const shared = Date.now() / 1000;

    stepSim(dt);
    const divers = net.snapshot(acc / DT);
    updateDivers(divers, dt, t);
    const creatures = net.creatureSnapshot();
    updateCreatures(creatures, dt, t);
    const { loot } = net;
    const [me] = divers;
    for (const m of net.stationNews.splice(0)) {
      stationScreen.news(m, divers);
    }
    const loud: Loudness = (p) =>
      p ? near(Math.hypot(p[0] - me.x, p[1] - me.y, p[2] - me.z)) : 1;
    playFx(divers, creatures, me, loud);
    soothe(creatures, t, loud);
    grind(loot, t, loud);
    effects.update(dt);

    updateCamera(divers, me, dt);
    for (const n of nettles) {
      n.update(shared);
    }
    line.update(t);

    pipeline.render();
    const target = updateAction(divers, me, creatures, loot, dt, t);
    chart.update(divers);
    frames += 1;
    frameMs += (performance.now() - f0 - frameMs) * 0.1;
    hud.stats(net, frameMs);
    publishDebug(divers, creatures, loot, target);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  loader.step("Letting the silt settle", 0.3);
  // Waits out each batch of pipelines the frames add, until a frame adds none.
  let made = 0;
  let done = 0;
  const warmUp = async (): Promise<void> => {
    await twoFrames();
    const batch = warming.splice(0);
    if (!batch.length) {
      return;
    }
    made += batch.length;
    await Promise.all(
      batch.map(async (p) => {
        await p;
        done += 1;
        loader.progress(done / made);
      })
    );
    await warmUp();
  };
  await warmUp();
  backend.createRenderPipeline = createPipeline;
  loader.finish();
};

try {
  await main();
} catch (error) {
  console.error(error);
  loader.fail();
  const stack =
    typeof error === "object" && error !== null && "stack" in error
      ? error.stack
      : undefined;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="color:#ece4ce;padding:24px;font:14px monospace">${String(stack ?? error)}</pre>`
  );
}
