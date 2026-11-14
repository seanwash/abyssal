import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { DT, SUITS } from '../../shared/constants';
import { buildLevel, groundHeight } from '../../shared/level';
import { pickTarget } from '../../shared/arena';
import { DiverView } from './diver';
import { buildNest, DroneView, Effects, LingcodView } from './fight';
import { buildBoulders, buildFloor, buildGodRays, buildKelp, buildMarineSnow, buildScatter, cutaway, PALETTE } from './env';
import { Hud } from './hud';
import { applyIsoScene, fitIso, ISO, isoCamera, isoDiverLight, isoOutput, isoPixelRatio } from './iso';
import { readAct, readSwim } from './input';
import { Net } from './net';
import { SeaNettle } from './nettle';
import './style.css';

const params = new URLSearchParams(location.search);

/** Frames per second to draw; 0 draws on every display refresh. */
const FPS_CAP = Number(params.get('fps') ?? 60);

function pixelRatio() {
  if (params.has('scale')) return Number(params.get('scale'));
  return isoPixelRatio(Number(params.get('lines') ?? ISO.lines));
}

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve));

function placeCamera(camera: THREE.Camera, target: THREE.Vector3) {
  const cp = Math.cos(ISO.pitch);
  camera.position.set(
    target.x + Math.sin(ISO.yaw) * cp * ISO.distance,
    target.y + Math.sin(ISO.pitch) * ISO.distance,
    target.z + Math.cos(ISO.yaw) * cp * ISO.distance,
  );
  camera.lookAt(target);
}

async function main() {
  const level = buildLevel(7);

  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: params.has('webgl') });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.style.imageRendering = 'pixelated';
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  applyIsoScene(scene);

  const camera = isoCamera();

  scene.add(new THREE.HemisphereLight(0x6fb3c4, 0x1a2420, 0.35));
  const sun = new THREE.DirectionalLight(PALETTE.sun, 0.9);
  scene.add(sun, sun.target);

  // Kelp generation is the longest synchronous step, so give the browser a turn on either side of it.
  scene.add(buildFloor(level), buildBoulders(level), buildScatter(level));
  await yieldToBrowser();
  scene.add(buildKelp(level));
  await yieldToBrowser();
  scene.add(buildGodRays());
  const snow = buildMarineSnow();
  scene.add(snow.object);

  const lingcod = new LingcodView();
  const drone = new DroneView();
  const effects = new Effects();
  scene.add(lingcod.root, drone.root, buildNest(level.nest), ...effects.objects);

  const nettles = level.jellies.map((j) => new SeaNettle(j));
  for (const n of nettles) scene.add(n.group);
  const hero = nettles.find((_, i) => level.jellies[i].hero) ?? null;
  const diverLight = isoDiverLight();
  const partnerLight = isoDiverLight();
  scene.add(diverLight, partnerLight);

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  pipeline.outputNode = isoOutput(sceneColor);

  const hud = new Hud();
  const net = new Net(level);
  const name = params.get('name') ?? '';
  await net.connect(name);

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
  await scenePass.compileAsync(renderer);

  const clock = new THREE.Timer();
  let acc = 0;
  let frames = 0;
  let frameMs = 0;

  addEventListener('keydown', (e) => { if (e.code === 'KeyB' && !e.repeat) net.toggleBuddy(); });

  addEventListener('resize', () => {
    fitIso(camera);
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
  });

  let last = 0;
  const frame = (now: number) => {
    // Skipping refreshes that arrive sooner than 60% of the frame interval halves a 120 Hz display
    // to 60 fps while 60 and 90 Hz displays still draw every refresh.
    if (FPS_CAP && now - last < 600 / FPS_CAP) { requestAnimationFrame(frame); return; }
    last = now;
    const f0 = performance.now();
    clock.update();
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.getElapsed();
    const shared = Date.now() / 1000;

    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 10) {
      net.step(readSwim(ISO.yaw), readAct());
      acc -= DT;
      steps++;
    }
    if (steps === 10) acc = 0;
    net.decayOffset(dt);

    const divers = net.snapshot(acc / DT);
    views.forEach((v, suit) => {
      const d = divers.find((x) => x.suit === suit);
      v.setPresent(!!d);
      if (d) v.update(dt, t, new THREE.Vector3(d.x, d.y, d.z), d.yaw, new THREE.Vector3(d.vx, d.vy, d.vz), groundHeight(level, d.x, d.z, d.y), d.down);
    });

    const creatures = net.creatureSnapshot();
    for (const c of creatures) {
      if (c.kind === 'lingcod') lingcod.update(dt, c); else drone.update(dt, t, c);
    }
    lingcod.root.visible = creatures.some((c) => c.kind === 'lingcod');
    drone.root.visible = creatures.some((c) => c.kind === 'drone');
    for (const f of net.fx.splice(0)) {
      if (f.k === 'harpoon' && f.p && f.q) effects.harpoon(f.p, f.q);
      else if (f.k === 'shock' && f.p) effects.shock(f.p);
      hud.event(f, divers);
    }
    effects.update(dt);

    const me = divers[0];
    const partner = divers.find((d) => !d.local);
    const lead = new THREE.Vector3(me.vx, 0, me.vz).multiplyScalar(0.35);
    const goal = new THREE.Vector3(me.x, me.y, me.z).add(lead);
    camTarget.lerp(goal, 1 - Math.exp(-3.5 * dt));
    placeCamera(camera, camTarget);

    cutaway.diver.value.set(me.x, me.y, me.z);
    camera.updateMatrixWorld();
    cutaway.diverView.value.set(me.x, me.y, me.z).applyMatrix4(camera.matrixWorldInverse);
    snow.target.value.copy(camTarget);
    if (partner) cutaway.partner.value.set(partner.x, partner.y, partner.z);
    else cutaway.partner.value.set(0, 1e4, 0);
    diverLight.position.set(me.x, me.y + 1.6, me.z);
    partnerLight.position.copy(cutaway.partner.value).y += 1.6;
    partnerLight.intensity = partner ? diverLight.intensity : 0;
    sun.position.set(camTarget.x - 8, 18, camTarget.z + 12);
    sun.target.position.copy(camTarget);

    for (const n of nettles) n.update(shared);

    pipeline.render();
    const target = me.down ? null : pickTarget(level, { id: me.id, x: me.x, y: me.y, z: me.z, yaw: me.yaw }, divers, creatures);
    hud.update(divers, net.status, camera, hero ? hero.worldPosition : null, innerWidth, innerHeight);
    hud.fight(divers, creatures, target, readAct(), net, camera, innerWidth, innerHeight);
    frames++;
    frameMs += (performance.now() - f0 - frameMs) * 0.1;
    (window as unknown as { __abyssal: unknown }).__abyssal = { status: net.status, divers, creatures, target, phase: net.phase, corrections: net.corrections, frames, frameMs };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#ece4ce;padding:24px;font:14px monospace">${String(err?.stack ?? err)}</pre>`);
});
