import {
  Box3,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  Object3D,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Game } from './games';

const TARGET_HEIGHT = 1.9;
const TEXTURE_SCALE = window.matchMedia('(pointer: coarse)').matches ? 0.5 : 1;

export interface ScreenFrame {
  center: Vector3;
  right: Vector3;
  up: Vector3;
  normal: Vector3;
  width: number;
  height: number;
}

export async function loadCabinetModel(url: string): Promise<Group> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  const box = new Box3().setFromObject(model);
  const s = TARGET_HEIGHT / (box.max.y - box.min.y);
  const c = box.getCenter(new Vector3());
  model.scale.setScalar(s);
  model.position.set(-c.x * s, -box.min.y * s, -c.z * s);

  // Writes alpha 0 so the CSS3D layer behind the canvas shows through.
  const hole = new MeshBasicMaterial({ color: 0x000000, blending: NoBlending, opacity: 0 });
  const screen = model.getObjectByName('Screen_Screen_0') as Mesh;
  screen.material = hole;
  model.getObjectByName('Screen_Glass_0')!.visible = false;

  const wrapper = new Group();
  wrapper.add(model);
  return wrapper;
}

export function createCabinet(template: Group, game: Game): Group {
  const cabinet = new Group();
  const model = template.clone(true);
  cabinet.add(model);

  const body = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
    const mat = mesh.material as MeshStandardMaterial | undefined;
    if (!mesh.isMesh || mat?.name !== 'Body') return;
    if (!body.has(mat)) body.set(mat, withMarquee(mat, game));
    mesh.material = body.get(mat)!;
  });
  return cabinet;
}

// The "ARCADE" marquee is baked into the Body texture; this rectangle (in 2048px texture space) covers it.
const MARQUEE = { x: 12, y: 300, w: 404, h: 98 };

function withMarquee(mat: MeshStandardMaterial, game: Game): MeshStandardMaterial {
  const clone = mat.clone();
  clone.map = paintMarquee(mat.map!, game, false);
  clone.emissiveMap = paintMarquee(mat.emissiveMap!, game, true);
  return clone;
}

function paintMarquee(source: Texture, game: Game, emissive: boolean): CanvasTexture {
  const img = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * TEXTURE_SCALE);
  canvas.height = Math.round(img.height * TEXTURE_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const { x, y, w, h } = MARQUEE;
  const scale = canvas.width / img.width;
  const scaledX = x * scale;
  const scaledY = y * scale;
  const scaledW = w * scale;
  const scaledH = h * scale;
  const css = `#${game.color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = emissive ? '#000' : '#0b0614';
  ctx.fillRect(scaledX, scaledY, scaledW, scaledH);

  // The UVs on this panel are vertically mirrored, so the text is drawn flipped to read correctly.
  ctx.save();
  ctx.translate(scaledX + scaledW / 2, scaledY + scaledH / 2);
  ctx.scale(1, -1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${64 * scale}px "Courier New", monospace`;
  ctx.fillStyle = css;
  if (emissive) {
    ctx.shadowColor = css;
    ctx.shadowBlur = 12 * scale;
  }
  ctx.fillText(game.title.toUpperCase(), 0, 4 * scale, (w - 30) * scale);
  ctx.restore();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.channel = source.channel;
  texture.anisotropy = 8;
  return texture;
}

// Derives the screen plane in world space from the glass quad (front faces its vertex normals).
export function measureScreen(cabinet: Object3D): ScreenFrame {
  cabinet.updateWorldMatrix(true, true);
  const glass = cabinet.getObjectByName('Screen_Glass_0') as Mesh;
  const geo = glass.geometry;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');

  const n = new Vector3();
  for (let i = 0; i < nrm.count; i++) n.add(new Vector3().fromBufferAttribute(nrm, i));
  n.normalize();
  const r = new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(n, r).normalize();

  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const proj = new Vector3(p.dot(r), p.dot(u), p.dot(n));
    min.min(proj);
    max.max(proj);
  }
  const mid = new Vector3().addVectors(min, max).multiplyScalar(0.5);
  const localCenter = r.clone().multiplyScalar(mid.x).addScaledVector(u, mid.y).addScaledVector(n, mid.z);

  const m = glass.matrixWorld;
  const scale = new Vector3().setFromMatrixScale(m).x;
  return {
    center: localCenter.applyMatrix4(m),
    right: r.transformDirection(m),
    up: u.transformDirection(m),
    normal: n.transformDirection(m),
    width: (max.x - min.x) * scale,
    height: (max.y - min.y) * scale,
  };
}
