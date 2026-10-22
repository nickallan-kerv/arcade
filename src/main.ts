import './style.css';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCabinet, loadCabinetModel, measureScreen, type ScreenFrame } from './cabinet';
import { games } from './games';
import { CSS_SCALE, ScreenPanel } from './screen';

const ROOM_RADIUS = 7;
const ROOM_HEIGHT = 4.5;
const ARC_RADIUS = 3.2;
const ARC_STEP = 0.4;
const HALL_POS = new Vector3(0, 1.45, 0.6);
const WALK_SPEED = 2.2;
const TURN_SPEED = 1.8;
const BODY_RADIUS = 0.75;
const WALL_LIMIT = ROOM_RADIUS - 0.5;
const ZOOM_DISTANCE = 1.6;
const ZOOM_FACING = 0.93;
const FOV = 55;
const TRANSITION_MS = 1100;

const stage = document.getElementById('stage')!;
const loadingEl = document.getElementById('loading')!;
const hintEl = document.getElementById('hint')!;
const gameTitleEl = document.getElementById('game-title')!;
const backBtn = document.getElementById('back') as HTMLButtonElement;

const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
const renderer = new WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isCoarsePointer ? 1.25 : 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const cssRenderer = new CSS3DRenderer();
stage.append(cssRenderer.domElement, renderer.domElement);

const scene = new Scene();
const cssScene = new Scene();
const camera = new PerspectiveCamera(FOV, 1, 0.05, 50);
const cssCamera = new PerspectiveCamera(FOV, 1, 0.05 * CSS_SCALE, 50 * CSS_SCALE);

const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.25;
scene.add(new AmbientLight(0x4a3a7a, 0.6));

// Behind and above the row so shadows stretch toward the viewer across the floor.
const sun = new DirectionalLight(0xffe8ff, 3.5);
sun.position.set(-1.5, 6, -5.5);
sun.target.position.set(0, 0, -1);
sun.castShadow = true;
const shadowResolution = isCoarsePointer ? 1024 : 2048;
sun.shadow.mapSize.set(shadowResolution, shadowResolution);
sun.shadow.camera.left = -6;
sun.shadow.camera.right = 6;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 16;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

buildRoom();

interface Entry {
  group: Group;
  panel: ScreenPanel;
  frame: ScreenFrame;
}
const entries: Entry[] = [];

type Mode = 'hall' | 'zoom';
let mode: Mode = 'hall';
let active: Entry | null = null;
let yawTarget = 0;
let yaw = 0;
let pitchTarget = 0;
let pitch = 0;
// Set by any forward movement (keys, wheel, drag) so approaching a screen can trigger the zoom.
let forwardIntent = false;
const walkPos = HALL_POS.clone();
const keys = new Set<string>();
// Cleared on exit so walking back up to the same screen doesn't instantly re-zoom.
let zoomArmed = true;

interface Transition {
  fromPos: Vector3;
  fromQuat: Quaternion;
  toPos: Vector3;
  toQuat: Quaternion;
  start: number;
  onDone: () => void;
}
let transition: Transition | null = null;

function buildRoom(): void {
  const wall = new Mesh(
    new CylinderGeometry(ROOM_RADIUS, ROOM_RADIUS, ROOM_HEIGHT, 64, 1, true),
    new MeshStandardMaterial({ color: 0x120a24, roughness: 0.9, side: BackSide }),
  );
  wall.position.y = ROOM_HEIGHT / 2;
  scene.add(wall);

  const ceiling = new Mesh(
    new CircleGeometry(ROOM_RADIUS, 64),
    new MeshStandardMaterial({ color: 0x0a0616, roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_HEIGHT;
  scene.add(ceiling);

  const grid = document.createElement('canvas');
  grid.width = grid.height = 128;
  const g = grid.getContext('2d')!;
  g.fillStyle = '#2a1850';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#7a2bd6';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 128, 128);
  const floorTex = new CanvasTexture(grid);
  floorTex.wrapS = floorTex.wrapT = RepeatWrapping;
  floorTex.repeat.set(16, 16);
  floorTex.colorSpace = SRGBColorSpace;
  const floor = new Mesh(
    new CircleGeometry(ROOM_RADIUS, 64),
    new MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  for (const [y, color] of [
    [0.15, 0x00d9ff],
    [ROOM_HEIGHT - 0.15, 0xff2bd6],
  ] as const) {
    const ring = new Mesh(
      new TorusGeometry(ROOM_RADIUS - 0.05, 0.03, 8, 128),
      new MeshBasicMaterial({ color, toneMapped: false }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    scene.add(ring);
  }
}

async function buildCabinets(): Promise<void> {
  const template = await loadCabinetModel(`${import.meta.env.BASE_URL}models/arcade_cabinet/scene.gltf`);
  const mid = (games.length - 1) / 2;

  games.forEach((game, i) => {
    const theta = (i - mid) * ARC_STEP;
    const group = createCabinet(template, game);
    group.position.set(Math.sin(theta) * ARC_RADIUS, 0, -Math.cos(theta) * ARC_RADIUS);
    group.rotation.y = -theta;
    group.userData.index = i;
    scene.add(group);

    const light = new PointLight(game.color, 6, 5, 2);
    light.position.set(0, 2.3, 1.2).applyEuler(group.rotation).add(group.position);
    scene.add(light);

    scene.updateMatrixWorld(true);
    const frame = measureScreen(group);
    const panel = new ScreenPanel(game, frame, exitGame);
    cssScene.add(panel.object);
    entries.push({ group, panel, frame });
  });
}

function hallQuat(y: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(-0.05 + pitch, y, 0, 'YXZ'));
}

function zoomPose(frame: ScreenFrame): { pos: Vector3; quat: Quaternion } {
  const tanHalf = Math.tan((FOV * Math.PI) / 360);
  const dH = frame.height / 0.8 / 2 / tanHalf;
  const dW = frame.width / 0.8 / 2 / (tanHalf * camera.aspect);
  const pos = frame.center.clone().addScaledVector(frame.normal, Math.max(dH, dW));
  const quat = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.normal));
  return { pos, quat };
}

function startTransition(toPos: Vector3, toQuat: Quaternion, onDone: () => void): void {
  transition = {
    fromPos: camera.position.clone(),
    fromQuat: camera.quaternion.clone(),
    toPos,
    toQuat,
    start: performance.now(),
    onDone,
  };
}

function enterGame(entry: Entry): void {
  if (mode !== 'hall' || transition) return;
  mode = 'zoom';
  active = entry;
  for (const other of entries) {
    if (other !== entry) other.panel.unload();
  }
  entry.panel.load();
  renderer.domElement.style.pointerEvents = 'none';
  renderer.domElement.style.cursor = '';
  gameTitleEl.textContent = entry.panel.game.title;
  backBtn.hidden = false;
  hintEl.style.visibility = 'hidden';

  const { pos, quat } = zoomPose(entry.frame);
  startTransition(pos, quat, () => {
    entry.panel.setInteractive(true);
    entry.panel.focus();
  });
}

function exitGame(): void {
  if (mode !== 'zoom' || !active) return;
  active.panel.setInteractive(false);
  const exitingPanel = active.panel;
  active = null;
  mode = 'hall';
  gameTitleEl.textContent = '';
  backBtn.hidden = true;
  hintEl.style.visibility = '';
  keys.clear();
  zoomArmed = false;
  (document.activeElement as HTMLElement | null)?.blur();
  window.focus();
  startTransition(walkPos.clone(), hallQuat(yaw), () => {
    renderer.domElement.style.pointerEvents = '';
    exitingPanel.unload();
  });
}

const raycaster = new Raycaster();
function pickCabinet(ev: PointerEvent | MouseEvent): Entry | null {
  const ndc = new Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(entries.map((e) => e.group), true);
  for (const hit of hits) {
    let o: Object3D | null = hit.object;
    while (o && o.userData.index === undefined) o = o.parent;
    if (o) return entries[o.userData.index];
  }
  return null;
}

type NavKind = 'look' | 'orbit' | 'pan' | 'dolly';
let nav: { kind: NavKind; x: number; y: number; startX: number; startY: number; yaw: number } | null = null;
let dragged = false;
const canvas = renderer.domElement;
const LOOK_SPEED = 0.004;
const PAN_SPEED = 0.006;
const DOLLY_SPEED = 0.01;
const WHEEL_SPEED = 0.003;

// Blender-style: MMB orbits, Shift+MMB pans, Ctrl+MMB/wheel dollies. Everything stays on the floor.
canvas.addEventListener('mousedown', (ev) => {
  if (ev.button === 1) ev.preventDefault();
});
canvas.addEventListener('pointerdown', (ev) => {
  let kind: NavKind;
  if (ev.button === 0) kind = 'look';
  else if (ev.button === 1) kind = ev.shiftKey ? 'pan' : ev.ctrlKey ? 'dolly' : 'orbit';
  else return;
  canvas.setPointerCapture(ev.pointerId);
  nav = { kind, x: ev.clientX, y: ev.clientY, startX: ev.clientX, startY: ev.clientY, yaw: yawTarget };
  dragged = false;
});
canvas.addEventListener('pointermove', (ev) => {
  if (!nav) {
    if (mode === 'hall') canvas.style.cursor = pickCabinet(ev) ? 'pointer' : '';
    return;
  }
  if (mode !== 'hall') return;
  const dx = ev.clientX - nav.x;
  const dy = ev.clientY - nav.y;
  nav.x = ev.clientX;
  nav.y = ev.clientY;
  if (Math.hypot(ev.clientX - nav.startX, ev.clientY - nav.startY) > 5) dragged = true;

  if (nav.kind === 'look') {
    if (dragged) yawTarget = nav.yaw + (ev.clientX - nav.startX) * LOOK_SPEED;
  } else if (nav.kind === 'orbit') {
    yawTarget += dx * LOOK_SPEED;
    pitchTarget = Math.max(-1.2, Math.min(1.2, pitchTarget + dy * LOOK_SPEED));
  } else if (nav.kind === 'pan') {
    moveBy(dy * PAN_SPEED, -dx * PAN_SPEED);
  } else {
    moveBy(-dy * DOLLY_SPEED, 0);
  }
});
canvas.addEventListener('pointerup', (ev) => {
  const ended = nav;
  nav = null;
  if (!ended || ended.kind !== 'look' || dragged) return;
  const hit = pickCabinet(ev);
  if (hit) enterGame(hit);
});
canvas.addEventListener('pointercancel', () => {
  nav = null;
});
canvas.addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    if (mode !== 'hall' || transition) return;
    const px = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    moveBy(-Math.max(-300, Math.min(300, px)) * WHEEL_SPEED, 0);
  },
  { passive: false },
);

const WALK_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd']);

window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    exitGame();
    return;
  }
  if (mode !== 'hall' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'home') {
    walkPos.copy(HALL_POS);
    yawTarget = 0;
    pitchTarget = 0;
  } else if (WALK_KEYS.has(k)) {
    keys.add(k);
    ev.preventDefault();
  }
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());
// Games can opt in to leaving via window.parent.postMessage({ type: 'arcade-exit' }, '*').
window.addEventListener('message', (ev) => {
  if (ev.data?.type === 'arcade-exit') exitGame();
});
backBtn.addEventListener('click', exitGame);

function held(...names: string[]): boolean {
  return names.some((n) => keys.has(n));
}

function walk(dt: number): void {
  yawTarget += ((held('arrowleft', 'a') ? 1 : 0) - (held('arrowright', 'd') ? 1 : 0)) * TURN_SPEED * dt;
  const step = ((held('arrowup', 'w') ? 1 : 0) - (held('arrowdown', 's') ? 1 : 0)) * WALK_SPEED * dt;
  if (step !== 0) moveBy(step, 0);

  if (zoomArmed) {
    const dist = (e: Entry) => Math.hypot(e.frame.center.x - walkPos.x, e.frame.center.z - walkPos.z);
    const target = forwardIntent ? entries.filter(isFacingScreen).sort((a, b) => dist(a) - dist(b))[0] : undefined;
    if (target) enterGame(target);
  } else if (!entries.some(isFacingScreen)) {
    zoomArmed = true;
  }
  forwardIntent = false;
}

function moveBy(forward: number, right: number): void {
  walkPos.x += -Math.sin(yaw) * forward + Math.cos(yaw) * right;
  walkPos.z += -Math.cos(yaw) * forward - Math.sin(yaw) * right;
  if (forward > 0) forwardIntent = true;

  for (const { group } of entries) {
    const dx = walkPos.x - group.position.x;
    const dz = walkPos.z - group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < BODY_RADIUS) {
      const k = d > 1e-6 ? BODY_RADIUS / d : 0;
      walkPos.x = group.position.x + dx * k;
      walkPos.z = group.position.z + dz * k;
    }
  }
  const r = Math.hypot(walkPos.x, walkPos.z);
  if (r > WALL_LIMIT) {
    walkPos.x *= WALL_LIMIT / r;
    walkPos.z *= WALL_LIMIT / r;
  }
}

function isFacingScreen({ frame }: Entry): boolean {
  const dx = frame.center.x - walkPos.x;
  const dz = frame.center.z - walkPos.z;
  const d = Math.hypot(dx, dz);
  if (d > ZOOM_DISTANCE || d < 1e-6) return false;
  const looking = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d;
  const screenFacesUs = (-frame.normal.x * dx - frame.normal.z * dz) / d;
  return looking > ZOOM_FACING && screenFacesUs > 0.6;
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  cssRenderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  cssCamera.aspect = camera.aspect;
  cssCamera.updateProjectionMatrix();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let lastTime = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (mode === 'hall' && !transition) walk(dt);
  yaw += (yawTarget - yaw) * 0.12;
  pitch += (pitchTarget - pitch) * 0.12;

  if (transition) {
    const t = Math.min(1, (now - transition.start) / TRANSITION_MS);
    const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(transition.fromPos, transition.toPos, k);
    camera.quaternion.slerpQuaternions(transition.fromQuat, transition.toQuat, k);
    if (t >= 1) {
      const done = transition.onDone;
      transition = null;
      done();
    }
  } else if (mode === 'hall') {
    camera.position.copy(walkPos);
    camera.quaternion.copy(hallQuat(yaw));
  }

  renderer.render(scene, camera);
  cssCamera.position.copy(camera.position).multiplyScalar(CSS_SCALE);
  cssCamera.quaternion.copy(camera.quaternion);
  cssRenderer.render(cssScene, cssCamera);
}

resize();
camera.position.copy(HALL_POS);
camera.quaternion.copy(hallQuat(0));

buildCabinets()
  .then(() => {
    loadingEl.classList.add('done');
    requestAnimationFrame(frame);
  })
  .catch((err) => {
    loadingEl.textContent = 'Failed to load the arcade.';
    console.error(err);
  });
