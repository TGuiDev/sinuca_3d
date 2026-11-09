"use client";

import dynamic from "next/dynamic";

const GameView = dynamic(() => import("./GameView"), {
  ssr: false,
  loading: () => <div className="grid h-screen w-screen place-items-center text-white/60">Carregando...</div>,
});

export default function GameLoader() {
  return <GameView />;
}
