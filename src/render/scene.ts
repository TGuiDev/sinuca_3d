import * as THREE from "three";
import { BALL_R, POCKETS, POCKET_R, TABLE_H, TABLE_W } from "@/physics/table";
import type { Ball, Vec2 } from "@/physics/types";
import { makeBallTexture } from "./ballTexture";
import { createCue } from "./cue";

export type SceneApi = {
  syncBalls(balls: Ball[]): void;
  setCue(visible: boolean, from: Vec2, angle: number, pull: number): void;
  setView(mode: "top" | "orbit", focus?: Vec2, angle?: number): void;
  pick(clientX: number, clientY: number): Vec2 | null;
  render(): void;
  dispose(): void;
};

const toScene = (p: Vec2) => ({ x: p.x - TABLE_W / 2, z: p.y - TABLE_H / 2 });

export function createScene(container: HTMLElement): SceneApi {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#10151c");
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };

  scene.add(new THREE.AmbientLight("#ffffff", 0.6));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(0.5, 3, 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1, bottom: -1, near: 0.5, far: 6 });
  scene.add(sun);

  // Mesa
  const feltMat = track(new THREE.MeshStandardMaterial({ color: "#1f7a46", roughness: 0.95 }));
  const felt = new THREE.Mesh(track(new THREE.PlaneGeometry(TABLE_W, TABLE_H)), feltMat);
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const woodMat = track(new THREE.MeshStandardMaterial({ color: "#4a2c17", roughness: 0.6 }));
  const rail = 0.12;
  const railH = 0.07;
  const rails: [number, number, number, number][] = [
    [TABLE_W + rail * 2, rail, 0, -(TABLE_H / 2 + rail / 2)],
    [TABLE_W + rail * 2, rail, 0, TABLE_H / 2 + rail / 2],
    [rail, TABLE_H, -(TABLE_W / 2 + rail / 2), 0],
    [rail, TABLE_H, TABLE_W / 2 + rail / 2, 0],
  ];
  for (const [w, d, x, z] of rails) {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, railH, d)), woodMat);
    m.position.set(x, railH / 2 - 0.005, z);
    m.receiveShadow = true;
    scene.add(m);
  }

  const holeMat = track(new THREE.MeshBasicMaterial({ color: "#050505" }));
  const holeGeo = track(new THREE.CircleGeometry(POCKET_R, 32));
  for (const p of POCKETS) {
    const h = new THREE.Mesh(holeGeo, holeMat);
    const s = toScene(p);
    h.rotation.x = -Math.PI / 2;
    h.position.set(s.x, 0.002, s.z);
    scene.add(h);
  }

  // Bolas
  const ballGeo = track(new THREE.SphereGeometry(BALL_R, 32, 24));
  const meshes = new Map<number, THREE.Mesh>();
  const last = new Map<number, Vec2>();
  for (let id = 0; id <= 15; id++) {
    const tex = track(makeBallTexture(id));
    const mat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.05 }));
    const m = new THREE.Mesh(ballGeo, mat);
    m.castShadow = true;
    m.visible = false;
    meshes.set(id, m);
    scene.add(m);
  }

  const cue = createCue();
  scene.add(cue.group, cue.aim);

  // Câmera
  let mode: "top" | "orbit" = "top";
  let focus: Vec2 = { x: TABLE_W / 2, y: TABLE_H / 2 };
  let aimAngle = 0;

  function placeCamera() {
    if (mode === "top") {
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const d = Math.max((TABLE_W / 2 + 0.2) / (t * camera.aspect), (TABLE_H / 2 + 0.2) / t);
      camera.up.set(0, 0, -1);
      camera.position.set(0, d, 0.0001);
      camera.lookAt(0, 0, 0);
    } else {
      const f = toScene(focus);
      const dx = Math.cos(aimAngle);
      const dz = Math.sin(aimAngle);
      camera.up.set(0, 1, 0);
      camera.position.set(f.x - dx * 0.95, 0.5, f.z - dz * 0.95);
      camera.lookAt(f.x + dx * 0.5, 0, f.z + dz * 0.5);
    }
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_R);

  return {
    syncBalls(balls) {
      for (const b of balls) {
        const m = meshes.get(b.id);
        if (!m) continue;
        m.visible = !b.pocketed;
        if (b.pocketed) {
          last.delete(b.id);
          continue;
        }
        const s = toScene(b.pos);
        const prev = last.get(b.id);
        if (prev) {
          const dx = b.pos.x - prev.x;
          const dy = b.pos.y - prev.y;
          const d = Math.hypot(dx, dy);
          if (d > 1e-6) {
            // rolar: eixo = up x direção do movimento
            const axis = new THREE.Vector3(dy / d, 0, -dx / d);
            m.rotateOnWorldAxis(axis, d / BALL_R);
          }
        }
        last.set(b.id, { x: b.pos.x, y: b.pos.y });
        m.position.set(s.x, BALL_R, s.z);
      }
    },
    setCue(visible, from, angle, pull) {
      const s = toScene(from);
      cue.set(visible, s.x, s.z, angle, pull);
    },
    setView(m, f, a) {
      mode = m;
      if (f) focus = f;
      if (a !== undefined) aimAngle = a;
      placeCamera();
    },
    pick(clientX, clientY) {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - r.left) / r.width) * 2 - 1,
        -((clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, hit)) return null;
      return { x: hit.x + TABLE_W / 2, y: hit.z + TABLE_H / 2 };
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      ro.disconnect();
      for (const d of disposables) d.dispose();
      cue.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
