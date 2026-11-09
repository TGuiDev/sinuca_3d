import * as THREE from "three";

const COLORS = ["#f2c500", "#1c4fd8", "#d62d20", "#5b2a86", "#f07a10", "#1b8a3a", "#7a1f1f"];

export function ballColor(id: number): string {
  if (id === 0) return "#f5f5f0";
  if (id === 8) return "#111111";
  return COLORS[(id < 8 ? id : id - 8) - 1];
}

export function makeBallTexture(id: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const color = ballColor(id);
  const stripe = id > 8;

  g.fillStyle = stripe || id === 0 ? "#f5f5f0" : color;
  g.fillRect(0, 0, w, h);
  if (stripe) {
    g.fillStyle = color;
    g.fillRect(0, h * 0.25, w, h * 0.5);
  }
  if (id > 0) {
    for (const cx of [w * 0.25, w * 0.75]) {
      g.fillStyle = "#f5f5f0";
      g.beginPath();
      g.arc(cx, h / 2, 34, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#111";
      g.font = "bold 40px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(id), cx, h / 2 + 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
