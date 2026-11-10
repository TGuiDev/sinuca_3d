"use client";

import { useRef } from "react";
import { Hud } from "./Hud";
import { RoomOverlay } from "./RoomOverlay";
import { btnSecondary } from "./RoomUi";
import { avisoSala, temOverlay } from "./roomHelpers";
import { type RoomSessionProps, useRoomSession } from "./useRoomSession";

export default function RoomSession(props: RoomSessionProps) {
  const container = useRef<HTMLDivElement>(null);
  const r = useRoomSession(props, container);
  const { sala, assentos, ui, oponente } = r;
  const names: [string, string] = [assentos[0]?.apelido ?? "Jogador 1", assentos[1]?.apelido ?? "Jogador 2"];
  const estado = { erro: r.erro, perdida: r.perdida, saindo: r.saindo, net: r.net, sala, oponente };
  const overlay = temOverlay(estado);
  const aviso = avisoSala({ net: r.net, fase: r.fase, revanche: r.revanche, oponente });

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#10151c]">
      <div ref={container} className="absolute inset-0 touch-none select-none" />
      {!overlay && ui && sala && (
        <Hud
          state={ui}
          names={names}
          you={sala.voce}
          opponentHint="Vez do adversário..."
          restartLabel="Revanche"
          onRestart={r.pedirRevanche}
          onToggleView={() => r.setView(ui.view === "top" ? "orbit" : "top")}
        />
      )}
      {!overlay && sala && (
        <div className="absolute bottom-4 left-4 z-10 flex flex-col items-start gap-2">
          {aviso && <div className="rounded-full bg-black/70 px-4 py-1 text-sm text-amber-200">{aviso}</div>}
          <button className={btnSecondary} onClick={r.sair}>
            Sair
          </button>
        </div>
      )}
      {overlay && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-black/50 p-4">
          <RoomOverlay
            {...estado}
            link={r.link}
            copia={r.copia}
            onCopiar={r.copiar}
            onSair={r.sair}
            onTentarDeNovo={props.onTentarDeNovo}
          />
        </div>
      )}
    </div>
  );
}
