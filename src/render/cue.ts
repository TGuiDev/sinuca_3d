import * as THREE from "three";
import { BALL_R } from "@/physics/table";

const LENGTH = 1.4;
const GAP = 0.012;

export function createCue() {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.006, 0.014, LENGTH, 16);
  geo.rotateZ(Math.PI / 2); // eixo Y vira -X: ponta na origem, taco para trás
  geo.translate(-LENGTH / 2, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ color: "#c8935a", roughness: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  group.add(mesh);

  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
  ]);
  const lineMat = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45 });
  const aim = new THREE.Line(lineGeo, lineMat);

  group.visible = false;
  aim.visible = false;

  return {
    group,
    aim,
    // (cx, cz): posição da branca na cena; angle no plano da física.
    set(visible: boolean, cx: number, cz: number, angle: number, pull: number) {
      group.visible = visible;
      aim.visible = visible;
      if (!visible) return;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      const back = BALL_R + GAP + pull;
      group.position.set(cx - dx * back, BALL_R, cz - dz * back);
      group.rotation.y = -angle;
      aim.position.set(cx, BALL_R, cz);
      aim.rotation.y = -angle;
      aim.scale.set(0.9, 1, 1);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    },
  };
}
