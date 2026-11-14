import * as THREE from 'three/webgpu';
import { color, length, mix, pass, screenUV, smoothstep, vec2, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { DT } from '../../shared/constants';
import { buildLevel } from '../../shared/level';
import { initPhysics } from '../../shared/physics';
import { DiverView } from './diver';
import { buildBoulders, buildFloor, buildGodRays, buildKelp, buildMarineSnow, buildScatter, cutaway, PALETTE } from './env';
import { Hud } from './hud';
import { readSwim } from './input';
import { Net } from './net';
import { SeaNettle } from './nettle';
import './style.css';

const params = new URLSearchParams(location.search);

const CAMERA = {
  yaw: THREE.MathUtils.degToRad(32),
  pitch: THREE.MathUtils.degToRad(40),
  distance: 13,
  fov: 34,
};

async function main() {
  await initPhysics();
  const level = buildLevel(7);

  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl') });
  renderer.setPixelRatio(Number(params.get('scale') ?? Math.min(devicePixelRatio, 2)));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = params.get('shadows') !== '0';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.05);
  scene.backgroundNode = mix(color(0x081a1f), color(0x2b5b58), smoothstep(0.0, 1.0, screenUV.y.oneMinus()));

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, innerWidth / innerHeight, 0.5, 120);

  scene.add(new THREE.HemisphereLight(0x6fb3c4, 0x1a2420, 0.6));
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  scene.add(buildFloor(level), buildBoulders(level), buildScatter(level), buildKelp(level), buildGodRays());
  const snow = buildMarineSnow();
  scene.add(snow.object);

  const nettles = level.jellies.map((j) => new SeaNettle(j));
  for (const n of nettles) scene.add(n.group);
  const hero = nettles.find((_, i) => level.jellies[i].hero) ?? null;

  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const glow = bloom(sceneColor, 0.85, 0.55, 0.62);
  const d = length(screenUV.sub(vec2(0.5)).mul(vec2(1.25, 1.0)));
  const vignette = mix(float(1.0), float(0.38), smoothstep(0.3, 0.85, d));
  pipeline.outputNode = sceneColor.add(glow).mul(vignette);

  const hud = new Hud();
  const net = new Net(level);
  const name = params.get('name') ?? '';
  await net.connect(name);

  const views = new Map<string, DiverView>();
  const camTarget = new THREE.Vector3(net.sim.x, net.sim.y, net.sim.z);
  const clock = new THREE.Timer();
  let acc = 0;
  let frames = 0;
  let frameMs = 0;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const frame = () => {
    const f0 = performance.now();
    clock.update();
    const dt = Math.min(0.1, clock.getDelta());
    const t = clock.getElapsed();
    const shared = Date.now() / 1000;

    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 10) {
      net.step(readSwim(CAMERA.yaw));
      acc -= DT;
      steps++;
    }
    if (steps === 10) acc = 0;
    net.decayOffset(dt);

    const divers = net.snapshot(acc / DT);
    const live = new Set<string>();
    for (const d of divers) {
      live.add(d.id);
      let v = views.get(d.id);
      if (v && v.suit !== d.suit) { v.dispose(); v = undefined; }
      if (!v) {
        v = new DiverView(d.suit);
        views.set(d.id, v);
        scene.add(v.root, v.bubbleMesh);
      }
      v.update(dt, t, new THREE.Vector3(d.x, d.y, d.z), d.yaw, new THREE.Vector3(d.vx, d.vy, d.vz));
    }
    for (const [id, v] of views) if (!live.has(id)) { v.dispose(); views.delete(id); }

    const me = divers[0];
    const lead = new THREE.Vector3(me.vx, 0, me.vz).multiplyScalar(0.35);
    const goal = new THREE.Vector3(me.x, me.y, me.z).add(lead);
    camTarget.lerp(goal, 1 - Math.exp(-3.5 * dt));
    const cp = Math.cos(CAMERA.pitch);
    camera.position.set(
      camTarget.x + Math.sin(CAMERA.yaw) * cp * CAMERA.distance,
      camTarget.y + Math.sin(CAMERA.pitch) * CAMERA.distance,
      camTarget.z + Math.cos(CAMERA.yaw) * cp * CAMERA.distance,
    );
    camera.lookAt(camTarget);

    cutaway.diver.value.set(me.x, me.y, me.z);
    cutaway.camDir.value.set(Math.sin(CAMERA.yaw), Math.cos(CAMERA.yaw));
    snow.target.value.copy(camTarget);
    sun.position.set(camTarget.x - 8, 18, camTarget.z + 12);
    sun.target.position.copy(camTarget);

    for (const n of nettles) n.update(shared);

    pipeline.render();
    hud.update(divers, net.status, camera, hero ? hero.worldPosition : null, innerWidth, innerHeight);
    frames++;
    frameMs += (performance.now() - f0 - frameMs) * 0.1;
    (window as unknown as { __abyssal: unknown }).__abyssal = { status: net.status, divers, corrections: net.corrections, frames, frameMs };
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#ece4ce;padding:24px;font:14px monospace">${String(err?.stack ?? err)}</pre>`);
});
