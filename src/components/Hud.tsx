import { groupOf } from "@/rules/eightBall";
import type { UiState } from "@/game/Game";
import { ballColor } from "@/render/ballTexture";

const PLAYERS = ["Você", "CPU"] as const;
const GROUP_LABEL = { solids: "Lisas", stripes: "Listradas" } as const;

function Dot({ id }: { id: number }) {
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/40 text-[10px] font-bold text-white"
      style={{ background: ballColor(id) }}
    >
      {id}
    </span>
  );
}

export function Hud({
  state,
  onRestart,
  onToggleView,
}: {
  state: UiState;
  onRestart: () => void;
  onToggleView: () => void;
}) {
  const { turn, groups, pocketed, power, message, winner, phase, view } = state;
  const hint =
    phase === "placing"
      ? "Mova o mouse e clique para posicionar a branca."
      : phase === "aim"
        ? view === "orbit"
          ? "Mova o mouse para girar a mira; clique e arraste para dar a tacada."
          : "Aponte com o mouse; clique e arraste para definir a força."
        : phase === "cpu"
          ? "A CPU está jogando..."
          : "";

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 text-white">
      <div className="flex items-start justify-between gap-4">
        <div className="pointer-events-auto flex gap-3">
          {PLAYERS.map((name, i) => (
            <div
              key={name}
              className={`rounded-lg border px-4 py-2 backdrop-blur ${
                turn === i && winner === null ? "border-amber-300 bg-black/60" : "border-white/15 bg-black/40"
              }`}
            >
              <div className="text-sm font-semibold">{name}</div>
              <div className="text-xs text-white/70">
                {groups[i] ? GROUP_LABEL[groups[i]!] : "Mesa aberta"}
              </div>
              <div className="mt-1 flex min-h-5 flex-wrap gap-1">
                {pocketed
                  .filter((id) => groupOf(id) === groups[i])
                  .map((id) => (
                    <Dot key={id} id={id} />
                  ))}
              </div>
            </div>
          ))}
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={onToggleView}
            className="rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-sm hover:bg-black/70"
          >
            Câmera: {view === "top" ? "Topo" : "Orbital"} (V)
          </button>
          <button
            onClick={onRestart}
            className="rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-sm hover:bg-black/70"
          >
            Reiniciar
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        {message && (
          <div className="rounded-full bg-black/60 px-4 py-1 text-sm backdrop-blur">{message}</div>
        )}
        {hint && <div className="text-xs text-white/70">{hint}</div>}
        <div className="h-3 w-64 overflow-hidden rounded-full border border-white/30 bg-black/50">
          <div
            className="h-full bg-gradient-to-r from-green-400 via-yellow-300 to-red-500"
            style={{ width: `${Math.round(power * 100)}%` }}
          />
        </div>
      </div>

      {winner !== null && (
        <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
          <div className="text-4xl font-bold">{winner === 0 ? "Você venceu!" : "A CPU venceu."}</div>
          <div className="text-white/70">{message}</div>
          <button
            onClick={onRestart}
            className="rounded-lg bg-amber-400 px-6 py-2 font-semibold text-black hover:bg-amber-300"
          >
            Jogar de novo
          </button>
        </div>
      )}
    </div>
  );
}
