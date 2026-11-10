"use client";

import dynamic from "next/dynamic";

export function Carregando() {
  return <div className="grid h-screen w-screen place-items-center bg-[#10151c] text-white/60">Carregando...</div>;
}

// Só no cliente: usa sessionStorage, WebSocket e WebGL.
const RoomView = dynamic(() => import("./RoomView"), { ssr: false, loading: () => <Carregando /> });

export default function RoomLoader({ codigo }: { codigo: string }) {
  return <RoomView codigo={codigo} />;
}
