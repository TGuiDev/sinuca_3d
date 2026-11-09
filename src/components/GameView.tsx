"use client";

import { useEffect, useRef, useState } from "react";
import { Game, type UiState } from "@/game/Game";
import { Hud } from "./Hud";

export default function GameView() {
  const container = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [state, setState] = useState<UiState | null>(null);

  useEffect(() => {
    const g = new Game(container.current!, setState);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#10151c]">
      <div ref={container} className="absolute inset-0 touch-none select-none" />
      {state && (
        <Hud
          state={state}
          onRestart={() => game.current?.restart()}
          onToggleView={() => game.current?.setView(state.view === "top" ? "orbit" : "top")}
        />
      )}
    </div>
  );
}
