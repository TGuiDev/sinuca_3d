# Multiplayer Etapa 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela inicial com "Jogar contra a IA" e salas multiplayer por código/link, com servidor autoritativo de física, no ar em `https://sinuca.guidev.site`.

**Architecture:** Um servidor Node + `ws` (`server/`) mantém salas em memória e roda `src/physics` e `src/rules` (compartilhados com o cliente). O cliente envia só a tacada; o servidor simula e transmite snapshots a ~30 Hz. O modo IA (`src/game/Game.ts`) permanece local e intocado. O servidor é um segundo app no Dokploy, roteado por `/socket` no mesmo domínio.

**Tech Stack:** Next 16 (App Router) + three + Tailwind v4, Vitest, Node 22, `ws`, `esbuild`, Docker, Dokploy.

**Spec:** `docs/superpowers/specs/2026-11-10-multiplayer-etapa1-design.md`

## Global Constraints

- Payload máximo de mensagem do cliente: **1024 bytes** (UTF-8). Toda mensagem é validada em tempo de execução; desconhecida ou malformada é descartada.
- `forca` limitada a **[0, 1]**; `angulo` finito e normalizado; `x`/`y` finitos; `posicionar_branca` sempre passa por `clampCuePlacement` no servidor.
- Apelido: **2 a 16** caracteres, caracteres de controle removidos, exibido só como texto do React (nunca `innerHTML`).
- Token de assento: **128 bits** via `crypto.randomBytes`, 32 hex; nunca enviado ao adversário. Código de sala: **6 caracteres** de `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sem `0 O 1 I L`).
- Reconexão: **60 s** de tolerância; depois, W.O. para o adversário.
- Snapshots a ~30 Hz (`TICK_MS = 33`) apenas enquanto as bolas rolam.
- WebSocket em `/socket`; só aceita `Origin` igual a `ALLOWED_ORIGIN` (padrão `https://sinuca.guidev.site`). IP do cliente: `CF-Connecting-IP`, com fallback para o IP do socket (confiável só porque o servidor fica atrás do Traefik/Cloudflare, sem porta publicada).
- Limites: mensagens por conexão (balde de fichas), salas por IP, salas totais, tentativas de entrar/reconectar por IP por minuto, conexões por IP, salas ociosas expiram.
- Erros ao cliente são códigos genéricos; nunca stack trace.
- Container: Node 22, usuário não-root, sem porta publicada no host. `npm audit --audit-level=high` sem achados antes do deploy.
- `Game.ts`, `soak.test.ts` e os testes de física/regras existentes não mudam de comportamento; `npm test`, `npm run lint` e `npm run build` seguem verdes.
- No app Next do Dokploy, manter `NIXPACKS_NODE_VERSION=22` e `NODE_OPTIONS=--experimental-require-module`.
- Commits com a identidade git já configurada no clone e **sem** linha `Co-Authored-By` nem rodapé do Claude. Mensagens em português, estilo `feat(server): ...`.
- Antes de escrever páginas Next, ler o guia relevante em `node_modules/next/dist/docs/` (AGENTS.md: esta versão tem mudanças incompatíveis; `cacheComponents` está ligado).

## Review Focus

1. Tacada em fase errada, repetida durante `rolando`, ou com a sala ainda `aguardando` o 2º jogador: ignorada, sem efeito (Tasks 4 e 5).
2. Reconexão com o token certo enquanto a conexão antiga ainda está aberta: a antiga é fechada e a nova assume o assento (Task 5).
3. Os dois jogadores caem no meio da partida: sala removida após 60 s, sem contadores por IP vazados (Task 6).
4. JSON válido porém hostil: `1e999` (vira `Infinity`), `__proto__`, campos extras, números como string, apelido só com espaços/controle (Task 1).
5. Branca encaçapada junto com a 8 na tacada final: vitória/derrota decidida, sem pedir branca na mão (Task 3).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/online/protocol.ts` | Tipos das mensagens e constantes compartilhadas (cliente e servidor) |
| `server/validate.ts` | `parseClientMessage`, `cleanNickname` |
| `server/limits.ts` | `TokenBucket`, `WindowCounter` |
| `src/game/turn.ts` | `settleShot`, `HEAD_SPOT` (fim de tacada, puro) |
| `server/match.ts` | Partida autoritativa: mundo, regras, simulação |
| `server/room.ts` | Assentos, reconexão, W.O., revanche, difusão de mensagens |
| `server/rooms.ts` | Gerenciador: códigos, limites, expiração |
| `server/index.ts` | `startServer`: HTTP, upgrade, origem, heartbeat, despacho |
| `server/main.ts` | Entrada: lê env, sobe o servidor, trata SIGTERM |
| `server/Dockerfile` | Imagem do servidor |
| `src/online/net.ts` | `RoomClient`: WebSocket com reconexão |
| `src/online/interp.ts` | `parseSnapshot`, `easeToward` |
| `src/game/OnlineGame.ts` | Cena + input do modo online |
| `src/app/page.tsx`, `src/app/jogo/page.tsx`, `src/app/sala/[codigo]/page.tsx` + componentes | Menu, modo IA, sala |

---

### Task 1: Protocolo, validação e dependências

**Files:**
- Create: `src/online/protocol.ts`, `server/validate.ts`, `server/validate.test.ts`
- Modify: `package.json` (deps e scripts)

**Interfaces:**
- Produces (`protocol.ts`): `MAX_MESSAGE_BYTES = 1024`; `ALFABETO`; `ROOM_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/`; `TOKEN_RE = /^[0-9a-f]{32}$/`; `ClientMsg` (`criar_sala{apelido}`, `entrar_sala{codigo,apelido}`, `reconectar{codigo,token}`, `tacada{angulo,forca}`, `posicionar_branca{x,y}`, `revanche`, `sair`, todos com discriminante `t`); `Fase = "aguardando"|"mira"|"rolando"|"posicionando"|"fim"`; `Assento = {apelido:string; conectado:boolean} | null`; `ErroCodigo = "mensagem_invalida"|"sala_inexistente"|"sala_cheia"|"token_invalido"|"limite"|"origem"|"tente_depois"`; `ServerMsg` (`sala{codigo,assentos:[Assento,Assento],voce:0|1,token}`, `assentos{assentos}`, `estado{turno,grupos,encacapadas:number[],mensagem,vencedor:0|1|null,fase}`, `snapshot{bolas:[id,x,y,pocketed:0|1][]}`, `erro{codigo}`).
- Produces (`validate.ts`): `parseClientMessage(raw: string): ClientMsg | null`; `cleanNickname(input: unknown): string | null`.

- [ ] **Step 1:** `git checkout -b feat/multiplayer-etapa1`. `npm install --save-exact ws` e `npm install --save-exact -D @types/ws esbuild`. Adicionar scripts: `"server:build": "esbuild server/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist-server/server.mjs"` e `"server:start": "node dist-server/server.mjs"`; adicionar `/dist-server/` ao `.gitignore`.
- [ ] **Step 2: Escrever `server/validate.test.ts` (falhando).** Casos, todos com as asserções exatas:
  - `parseClientMessage` aceita cada um dos 7 tipos válidos e devolve objeto novo contendo só as chaves conhecidas (`Object.keys` igual ao esperado, mesmo com campos extras e `__proto__` na entrada; `({} as any).polluted` segue `undefined`).
  - Retorna `null` para: texto que não é JSON; array; `t` desconhecido; `angulo` como string `"1"`; `'{"t":"tacada","angulo":1e999,"forca":1}'`; `codigo` fora de `ROOM_CODE_RE`; `token` que não casa `TOKEN_RE`; payload com mais de 1024 bytes UTF-8 (apelido de 2000 caracteres e também 600 emojis, que passam de 1024 bytes com menos de 1024 caracteres).
  - `codigo` minúsculo com espaços (`" abc234 "`) vira `"ABC234"`; apelido passa por `cleanNickname` (apelido inválido faz a mensagem inteira ser `null`).
  - `cleanNickname`: `"  Ana  Maria "` → `"Ana Maria"`; `"a"` → `null`; 17 caracteres → `null`; só espaços → `null`; `"\u0000‮Ana"` → `"Ana"`; `42`/`undefined` → `null`; `"Zé🎱"` → `"Zé🎱"` (conta por pontos de código).
- [ ] **Step 3:** `npx vitest run server/validate.test.ts` — Expected: FAIL (módulos não existem).
- [ ] **Step 4: Implementar** `protocol.ts` e `validate.ts` com as assinaturas acima. `parseClientMessage` mede bytes com `Buffer.byteLength`, usa `JSON.parse` em try/catch, e monta o objeto de saída campo a campo (nunca espalha a entrada). `cleanNickname` remove `\p{C}`, normaliza espaços, conta com `Array.from`.
- [ ] **Step 5:** `npx vitest run server/validate.test.ts` — Expected: PASS. `npx tsc --noEmit` sem erros.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(server): protocolo e validação de mensagens"`

### Task 2: Limites de taxa

**Files:**
- Create: `server/limits.ts`, `server/limits.test.ts`

**Interfaces:**
- Produces: `class TokenBucket { constructor(ratePerSec: number, burst: number); take(now: number): boolean }`; `class WindowCounter { constructor(limit: number, windowMs: number); hit(key: string, now: number): boolean; readonly size: number }` (`hit` devolve `true` se permitido e prune chaves expiradas).

- [ ] **Step 1: Testes (falhando):** balde com `(2, 3)`: 3 `take(0)` verdadeiros e o 4º falso; em `now=500` reabastece 1 ficha (um `true`, depois `false`); nunca passa de `burst`. `WindowCounter(2, 1000)`: 2 `hit("a", 0)` verdadeiros, 3º falso; `hit("b", 0)` independente; `hit("a", 1001)` volta a `true`; depois de `1001`, `size` não conta chaves expiradas.
- [ ] **Step 2:** `npx vitest run server/limits.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** as duas classes com tempo injetado (sem `Date.now()` interno).
- [ ] **Step 4:** `npx vitest run server/limits.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(server): limites de taxa"` (incluindo os arquivos novos via `git add`).

### Task 3: Fim de tacada compartilhado

**Files:**
- Create: `src/game/turn.ts`, `src/game/turn.test.ts`

**Interfaces:**
- Consumes: `resolveShot`, `GameState` (`src/rules/eightBall.ts`); `World` (`src/physics/types.ts`); `TABLE_W`, `TABLE_H` (`src/physics/table.ts`).
- Produces: `HEAD_SPOT: Vec2` (`{x: TABLE_W/4, y: TABLE_H/2}`); `settleShot(world: World, rules: GameState, pocketed: number[]): { rules: GameState; pocketed: number[]; needsPlacement: boolean }`. Replica o `finishShot` de `Game.ts` para dois humanos: acumula encaçapadas (sem a branca), chama `resolveShot` com as bolas restantes, e, se houver `ballInHand`, devolve a branca para `HEAD_SPOT` com velocidade zero quando encaçapada e `needsPlacement = true`; com vencedor, `needsPlacement = false`. Muta apenas a bola branca de `world`.

- [ ] **Step 1: Testes (falhando)** montando mundos pequenos à mão (`createWorld` + bolas): (a) tacada que encaçapa uma lisa com mesa aberta → `rules.groups[0] === "solids"`, `rules.current === 0`, `needsPlacement === false`, `pocketed` contém a bola e não contém `0`; (b) branca encaçapada → `rules.current === 1`, `needsPlacement === true`, branca em `HEAD_SPOT`, `pocketed: false`, velocidade `{0,0}`; (c) **Review Focus 5:** relatório com `pocketed: [0, 8]` → `rules.winner === 1` (shooter 0 perde), `needsPlacement === false`; (d) `pocketed` de entrada é preservado e estendido, nunca mutado.
- [ ] **Step 2:** `npx vitest run src/game/turn.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `turn.ts` conforme acima. Não alterar `Game.ts`.
- [ ] **Step 4:** `npx vitest run` (suíte inteira) — Expected: PASS, incluindo `soak.test.ts`.
- [ ] **Step 5: Commit** — `git add src/game/turn.ts src/game/turn.test.ts && git commit -m "feat(game): fim de tacada compartilhável"`

### Task 4: Partida autoritativa (`Match`)

**Files:**
- Create: `server/match.ts`, `server/match.test.ts`

**Interfaces:**
- Consumes: `createWorld`, `strike`, `step`, `isMoving` (`src/physics/engine.ts`); `rackBalls` (`src/physics/table.ts`); `newGame` (`src/rules/eightBall.ts`); `settleShot`, `HEAD_SPOT`; `clampCuePlacement` (`src/game/placement.ts`); tipos de `protocol.ts`.
- Produces:
  ```ts
  export type MatchEstado = Omit<Extract<ServerMsg, {t:"estado"}>, "t">;
  export type Snapshot = Extract<ServerMsg, {t:"snapshot"}>["bolas"];
  export type Advance = "idle" | "moving" | "settled";
  export class Match {
    constructor(opts?: { rack?: Ball[]; maxShotSeconds?: number }); // padrão: rackBalls(), 30
    estado(): MatchEstado;            // fase: "mira"|"rolando"|"posicionando"|"fim"
    snapshot(): Snapshot;             // [id, x, y, pocketed] com x,y arredondados a 4 casas
    shoot(seat: 0|1, angulo: number, forca: number): boolean;
    place(seat: 0|1, x: number, y: number): boolean;
    advance(dtMs: number): Advance;
    forfeit(loser: 0|1, mensagem: string): void;
  }
  ```
  `advance` acumula tempo real, executa passos de `1/120` s, no máximo `MAX_STEPS_PER_ADVANCE = 12` por chamada; ao parar chama `settleShot`; se a simulação passar de `maxShotSeconds`, zera as velocidades e encerra a tacada (proteção contra travar CPU).

- [ ] **Step 1: Testes (falhando):**
  - `shoot` devolve `false` e não altera o mundo quando: `seat` não é o do turno; fase não é `mira`; `forca < 0.03`; `angulo`/`forca` não finitos. **Review Focus 1:** um 2º `shoot` válido durante `rolando` devolve `false` e a velocidade da branca não muda.
  - `forca: 5` e `forca: 1` produzem a mesma velocidade inicial da branca (`Math.hypot` igual) — força clampada em 1.
  - Tacada válida: `estado().fase === "rolando"`; chamando `advance(33)` em laço (limite de 2000 chamadas) chega a `"settled"` e a fase volta a `mira` ou `posicionando`.
  - Após falta (branca encaçapada, usar `rack` customizado), `estado().fase === "posicionando"` e `turno` é o adversário; `place` só aceita desse assento; `place(seat, -5, -5)` resulta na branca em posição dentro da mesa (clampada); depois `fase === "mira"`.
  - Com `rack` de só branca + bola 8 mirando na caçapa: o jogador que a encaçapa cedo perde (`vencedor` é o adversário) e `fase === "fim"`.
  - `maxShotSeconds: 0.05` encerra a tacada à força (`"settled"`) com todas as velocidades zeradas.
  - `forfeit(1, "W.O.")` → `vencedor === 0`, `fase === "fim"`, `mensagem === "W.O."`.
  - `snapshot()` tem 16 entradas no início e valores arredondados a 4 casas.
- [ ] **Step 2:** `npx vitest run server/match.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `Match` conforme acima. Em `estado()`, `encacapadas` é a lista acumulada sem a branca e `mensagem` vem de `rules.message`.
- [ ] **Step 4:** `npx vitest run server/match.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/match.ts server/match.test.ts && git commit -m "feat(server): partida autoritativa"`

### Task 5: Sala (assentos, reconexão, W.O., revanche)

**Files:**
- Create: `server/room.ts`, `server/room.test.ts`

**Interfaces:**
- Consumes: `Match`; tipos de `protocol.ts`. O apelido já chega limpo por `cleanNickname`.
- Produces:
  ```ts
  export type Conn = { send(msg: ServerMsg): void; close(): void };
  export const GRACE_MS = 60_000;
  export const IDLE_TTL_MS = 600_000;
  export class Room {
    constructor(readonly code: string, newToken?: () => string); // padrão: randomBytes(16).toString("hex")
    join(nick: string, conn: Conn, now: number): { seat: 0|1; token: string } | null; // null = cheia
    reconnect(token: string, conn: Conn, now: number): 0 | 1 | null;
    disconnect(seat: 0|1, conn: Conn, now: number): void; // ignora conn que não é a atual do assento
    handle(seat: 0|1, msg: ClientMsg, now: number): void; // tacada, posicionar_branca, revanche, sair
    tick(now: number, dtMs: number): void;
    isDead(now: number): boolean;
    creatorIp?: string; // preenchido pelo gerenciador (Task 6) para contar salas por IP
  }
  ```
  Comportamento: 1º `join` → assento 0, fase `aguardando`; 2º `join` → assento 1, cria `Match`, envia `sala` ao novo jogador (com o token **só dele**), `assentos`, `estado` e `snapshot` aos dois. `reconnect` troca a conexão do assento (fecha a antiga), reenvia `sala`, `assentos`, `estado`, `snapshot`. `tick` avança a `Match` (`moving` → difunde `snapshot`; `settled` → `snapshot` + `estado`) e aplica W.O. quando um assento está desconectado há mais de `GRACE_MS` durante a partida. `tacada`/`posicionar_branca` só valem com a sala `jogando`. `revanche` só em `fim`; nova `Match` quando **os dois** pedirem. `sair` = W.O. contra quem saiu se a partida está em andamento, e marca o assento como ausente. `isDead`: nenhum assento conectado há mais de `GRACE_MS`, ou sem atividade há `IDLE_TTL_MS`.

- [ ] **Step 1: Testes (falhando)** com `Conn` falsas que gravam mensagens e `now` numérico:
  - Criar + 2º entrar: 3º `join` devolve `null`; o token do assento 0 **não** aparece em nenhuma mensagem recebida pela conexão 1 (e vice-versa).
  - **Review Focus 1:** `handle(0, tacada)` com sala `aguardando` não gera mensagem alguma.
  - Tacada do assento 0 → conexões recebem `snapshot` no `tick` e, ao terminar, `estado` com fase `mira`/`posicionando`; tacada do assento 1 fora de turno é ignorada.
  - **Review Focus 2:** `reconnect(tokenDoAssento0, novaConn, t)` com a conexão antiga ainda aberta → `antiga.close` chamado, `novaConn` recebe `sala`; mensagens depois vão só para `novaConn`; `disconnect(0, antiga, t)` (conexão obsoleta) não marca o assento como desconectado. Token errado → `null`.
  - W.O.: assento 1 desconecta em `t=0`; `tick(59_999)` não encerra; `tick(60_001)` → `estado.vencedor === 0` e mensagem de W.O.; reconectar em `t=30_000` cancela o W.O.
  - `revanche`: 1 pedido não reinicia; 2 pedidos (um de cada assento) em `fim` → novo `estado` com `fase === "mira"`, mesa de 15 bolas; `revanche` fora de `fim` é ignorada.
  - `sair` em jogo → adversário vence; `isDead` fica `true` após `GRACE_MS` sem ninguém conectado e após `IDLE_TTL_MS` de inatividade.
- [ ] **Step 2:** `npx vitest run server/room.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `Room` conforme acima.
- [ ] **Step 4:** `npx vitest run server/room.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/room.ts server/room.test.ts && git commit -m "feat(server): sala com reconexão, W.O. e revanche"`

### Task 6: Gerenciador de salas

**Files:**
- Create: `server/rooms.ts`, `server/rooms.test.ts`

**Interfaces:**
- Consumes: `Room`, `Conn`, `WindowCounter`, `ROOM_CODE_RE`, `ALFABETO`, `ErroCodigo`.
- Produces:
  ```ts
  export type Limits = { maxRooms: number; maxRoomsPerIp: number; maxAttemptsPerMin: number }; // padrões: 200, 3, 10
  export type Result = { ok: true; room: Room; seat: 0|1; token: string } | { ok: false; erro: ErroCodigo };
  export class RoomManager {
    constructor(limits?: Partial<Limits>);
    create(ip: string, nick: string, conn: Conn, now: number): Result;
    join(ip: string, code: string, nick: string, conn: Conn, now: number): Result;
    reconnect(ip: string, code: string, token: string, conn: Conn, now: number): Result;
    tick(now: number, dtMs: number): void; // tick em todas as salas e remove as mortas
    get(code: string): Room | undefined;
    readonly size: number;
  }
  ```
  Códigos de 6 caracteres do `ALFABETO` via `crypto.randomInt`, repetindo em colisão. `join` e `reconnect` contam na janela de 60 s por IP (`maxAttemptsPerMin`); excedido → `{erro:"tente_depois"}`. `create` acima de `maxRoomsPerIp`/`maxRooms` → `{erro:"limite"}`. Código inexistente → `sala_inexistente`; sala cheia → `sala_cheia`; token errado → `token_invalido`.

- [ ] **Step 1: Testes (falhando):** códigos gerados casam `ROOM_CODE_RE` (200 amostras, sem `0/O/1/I/L`) e são únicos; 4ª sala do mesmo IP → `limite` e de outro IP funciona; `maxRooms` respeitado; 11 tentativas de `join` com código inexistente do mesmo IP em 60 s → a 11ª é `tente_depois`; `join` na sala cheia → `sala_cheia`. **Review Focus 3:** duas conexões entram, ambas desconectam em `t=0`, `tick(60_001, 33)` → `size === 0` e o IP criador volta a poder criar até o limite novamente.
- [ ] **Step 2:** `npx vitest run server/rooms.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `RoomManager` conforme acima.
- [ ] **Step 4:** `npx vitest run server/rooms.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add server/rooms.ts server/rooms.test.ts && git commit -m "feat(server): gerenciador de salas com limites"`

### Task 7: Servidor WebSocket, entrada e teste de integração

**Files:**
- Create: `server/index.ts`, `server/main.ts`, `server/server.test.ts`

**Interfaces:**
- Consumes: `RoomManager`, `parseClientMessage`, `TokenBucket`, `MAX_MESSAGE_BYTES`.
- Produces: `startServer(opts: { port: number; allowedOrigin: string; tickMs?: number }): Promise<{ port: number; close(): Promise<void> }>`. `main.ts` lê `PORT` (padrão `8787`) e `ALLOWED_ORIGIN` (padrão `https://sinuca.guidev.site`), sobe o servidor e encerra limpo em `SIGTERM`.

Regras do servidor: `GET /health` e `GET /socket/health` → 200 `ok`; qualquer outra rota HTTP → 404. `upgrade` só em `/socket`, com `Origin === allowedOrigin`; senão responde `403` e destrói o socket. `WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })`. Por conexão: `TokenBucket(20, 30)`; estourou → `close(1008)`. IP = `CF-Connecting-IP` ou `req.socket.remoteAddress`; máximo de 10 conexões por IP. Heartbeat: ping a cada 15 s e `terminate()` de quem não respondeu ao ciclo anterior. Mensagem inválida → `erro: mensagem_invalida`; após 5 inválidas na mesma conexão → `close(1008)`. `criar_sala`/`entrar_sala`/`reconectar` só antes de ter assento; as demais só depois. Handlers dentro de `try/catch`; erro inesperado vira `close(1011)` sem detalhes. `setInterval(tickMs ?? 33)` chama `manager.tick(Date.now(), dtReal)`. Ao fechar a conexão chama `room.disconnect`.

- [ ] **Step 1: Testes de integração (falhando)** em `server/server.test.ts`, subindo `startServer({ port: 0, allowedOrigin: "http://test.local" })` e clientes `ws` com `headers: { Origin: "http://test.local" }`:
  - `GET /health` → 200; `GET /socket/health` → 200; `GET /x` → 404.
  - Conexão com `Origin` diferente (ou sem) é recusada (evento `unexpected-response` com status 403).
  - Cliente A `criar_sala` recebe `sala` com `voce: 0`; cliente B `entrar_sala` com o código recebe `sala` com `voce: 1`; ambos recebem `estado` com `fase: "mira"`, `turno: 0`.
  - B envia `tacada` (fora de turno) → nenhum `snapshot` chega por 300 ms. A envia `tacada{angulo:0.1, forca:0.8}` → ambos recebem `estado.fase: "rolando"`, ao menos um `snapshot` e, por fim, um `estado` com fase `mira` ou `posicionando`.
  - Mensagem acima de 1024 bytes derruba a conexão (código 1009). Mensagem `{"t":"x"}` devolve `erro: mensagem_invalida`.
  - B envia `sair` → A recebe `estado` com `vencedor: 0` e `fase: "fim"`.
- [ ] **Step 2:** `npx vitest run server/server.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `index.ts` e `main.ts` conforme as regras acima.
- [ ] **Step 4:** `npx vitest run` (suíte inteira) — Expected: PASS.
- [ ] **Step 5: Commit** — `git add server && git commit -m "feat(server): servidor WebSocket com origem, limites e heartbeat"`

### Task 8: Imagem Docker e auditoria

**Files:**
- Create: `server/Dockerfile`, `.dockerignore`

- [ ] **Step 1: `server/Dockerfile`** (contexto = raiz do repositório): estágio `build` em `node:22-alpine` com `npm ci`, cópia de `src/`, `server/`, `tsconfig.json`, e `npm run server:build`; estágio final `node:22-alpine` copiando só `dist-server/server.mjs`, `ENV NODE_ENV=production PORT=8787`, `USER node`, `EXPOSE 8787`, `CMD ["node","server.mjs"]` e `HEALTHCHECK` batendo em `/health`. `.dockerignore`: `node_modules`, `.next`, `.git`, `dist-server`, `docs`.
- [ ] **Step 2:** `docker build -f server/Dockerfile -t sinuca-server:test .` — Expected: build conclui.
- [ ] **Step 3:** `docker run -d --rm --name sinuca-test -p 18787:8787 -e ALLOWED_ORIGIN=http://test.local sinuca-server:test`; `curl -s localhost:18787/health` → `ok`; `docker exec sinuca-test id -u` → diferente de `0`; `docker stop sinuca-test`.
- [ ] **Step 4:** `npm audit --audit-level=high` — Expected: sai com código 0. Se houver achado alto/crítico (inclusive em dependências do Next), **parar e reportar ao usuário**; não ignorar nem silenciar.
- [ ] **Step 5:** `npm run build` e `npm run lint` — Expected: sem erros (`server/` entra no typecheck do Next).
- [ ] **Step 6: Commit** — `git add server/Dockerfile .dockerignore && git commit -m "build(server): imagem docker não-root"`

### Task 9: Cliente de rede com reconexão

**Files:**
- Create: `src/online/net.ts`, `src/online/net.test.ts`

**Interfaces:**
- Consumes: `ClientMsg`, `ServerMsg`.
- Produces:
  ```ts
  export type NetStatus = "conectando" | "online" | "reconectando" | "encerrada";
  export type SocketLike = { send(d: string): void; close(): void; onopen: (() => void) | null; onmessage: ((e: { data: string }) => void) | null; onclose: (() => void) | null };
  export class RoomClient {
    constructor(opts: { url: string; makeSocket?: (url: string) => SocketLike; onMessage: (m: ServerMsg) => void; onStatus: (s: NetStatus) => void; backoffMs?: number[] }); // padrão [500,1000,2000,4000,8000]
    send(msg: ClientMsg): void;                       // enfileira até abrir
    setCredentials(codigo: string, token: string): void; // usado para `reconectar` automático
    close(): void;
  }
  ```
  Após queda, reconecta com espera crescente e envia `reconectar{codigo,token}` ao reabrir; `erro` com `token_invalido`/`sala_inexistente` → status `encerrada` e não tenta mais; esgotadas as tentativas (somando ~60 s) → `encerrada`. Mensagens que não são JSON com `t` string são ignoradas.

- [ ] **Step 1: Testes (falhando)** com `SocketLike` falso e `vi.useFakeTimers()`: mensagens enfileiradas saem ao abrir; `onMessage` recebe JSON válido e ignora lixo; queda → status `reconectando`, nova conexão após 500 ms e envio automático de `reconectar` com as credenciais; 2ª queda espera 1000 ms; `erro: token_invalido` → `encerrada` sem novas tentativas; `close()` não reconecta.
- [ ] **Step 2:** `npx vitest run src/online/net.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `RoomClient`.
- [ ] **Step 4:** `npx vitest run src/online/net.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/online && git commit -m "feat(online): cliente WebSocket com reconexão"`

### Task 10: Cena online (`OnlineGame`) e HUD parametrizado

**Files:**
- Create: `src/online/interp.ts`, `src/online/interp.test.ts`, `src/game/OnlineGame.ts`
- Modify: `src/components/Hud.tsx`

**Interfaces:**
- Consumes: `createScene` (`SceneApi`), `clampCuePlacement`, `UiState` (de `Game.ts`, só tipo), `Snapshot`, `ClientMsg`, `ServerMsg`.
- Produces:
  ```ts
  // interp.ts
  export type BallTarget = { x: number; y: number; pocketed: boolean };
  export function parseSnapshot(bolas: Snapshot): Map<number, BallTarget>;
  export function easeToward(current: Vec2, target: Vec2, dtSec: number, rate?: number): Vec2; // rate padrão 25
  // OnlineGame.ts
  export class OnlineGame {
    constructor(container: HTMLElement, you: 0 | 1, names: [string, string], send: (m: ClientMsg) => void, onState: (s: UiState) => void);
    apply(m: ServerMsg): void;        // trata `estado` e `snapshot`
    setView(view: "top" | "orbit"): void;
    dispose(): void;
  }
  ```
  `Hud` ganha props opcionais: `names?: [string,string]` (padrão `["Você","CPU"]`), `you?: 0|1` (padrão `0`; "venceu" é `winner === you`), `opponentHint?: string` (substitui "A CPU está jogando..."), `restartLabel?: string` (padrão "Reiniciar"). O uso atual no `GameView` continua idêntico.

`OnlineGame`: mesma mira/força por mouse do `Game.ts`; a tacada vira `send({t:"tacada",angulo,forca})` só quando `turno === you` e fase `mira`; posicionar a branca mostra a bola local (clampada) e envia `posicionar_branca` no clique; bolas são desenhadas com `easeToward` rumo ao alvo do último `snapshot`. Fase para o HUD: `mira`/`posicionando` do seu turno → `"aim"`/`"placing"`; vez do adversário → `"cpu"` (com `opponentHint`); `rolando` → `"rolling"`; `fim` → `"over"`.

- [ ] **Step 1: Testes (falhando)** de `interp`: `parseSnapshot([[3,1.5,0.5,0],[8,0,0,1]])` → mapa com `3 → {x:1.5,y:0.5,pocketed:false}` e `8 → {…,pocketed:true}`; `easeToward(a, b, 0)` devolve `a`; com `dtSec = 10` fica a menos de `1e-6` de `b`; passos sucessivos aproximam monotonicamente.
- [ ] **Step 2:** `npx vitest run src/online/interp.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** `interp.ts`, depois `OnlineGame.ts` e as props do `Hud`.
- [ ] **Step 4:** `npx vitest run`, `npm run lint`, `npx tsc --noEmit` — Expected: tudo verde (a parte visual é verificada na Task 12).
- [ ] **Step 5: Commit** — `git add src && git commit -m "feat(online): cena online e HUD parametrizado"`

### Task 11: Páginas: menu, modo IA e sala

**Files:**
- Create: `src/app/jogo/page.tsx`, `src/app/sala/[codigo]/page.tsx`, `src/components/Menu.tsx`, `src/components/RoomView.tsx`
- Modify: `src/app/page.tsx` (passa a renderizar o menu)

**Interfaces:**
- Consumes: `GameLoader` (modo IA), `RoomClient`, `OnlineGame`, `ROOM_CODE_RE`, `ServerMsg`.
- Produces: rotas `/` (menu), `/jogo` (modo IA, comportamento idêntico ao de hoje), `/sala/[codigo]`.

Comportamento:
- **Menu:** campo de apelido (2–16, guardado em `sessionStorage` `sinuca:apelido`; o servidor continua validando); botões "Jogar contra a IA" (→ `/jogo`), "Criar sala" (→ `/sala/nova`) e "Entrar com código" (campo de 6 caracteres, maiúsculas, validado por `ROOM_CODE_RE`).
- **`/sala/[codigo]`:** URL do WebSocket: `ws://localhost:8787/socket` em `localhost`, senão `wss://${location.host}/socket`. `codigo === "nova"` → `criar_sala`; código válido com token em `sessionStorage` (`sinuca:token:CODIGO`) → `reconectar`; senão `entrar_sala`; código inválido → mensagem sem conectar. Ao receber `sala`: guardar o token, `setCredentials`, e (se era `nova`) `history.replaceState` para `/sala/CODIGO`. Estados: conectando; **aguardando** (mostra link e código com botão copiar); jogando (monta `OnlineGame`; HUD com `names` pelos apelidos dos assentos e `you`); `reconectando…`; `encerrada` ("A sala foi encerrada", botão voltar ao menu); erros mapeados para texto em português (`sala_cheia`, `sala_inexistente`, `limite`, `tente_depois`, `origem`). Apelidos e mensagens sempre como texto do React. Em `fim`, botão "Revanche" envia `revanche`; "Sair" envia `sair` e volta ao menu.
- Antes de escrever, ler o guia de rotas dinâmicas e `cacheComponents` em `node_modules/next/dist/docs/`.

- [ ] **Step 1:** Ler o guia de `params` em rota dinâmica e a regra de `cacheComponents` desta versão do Next; anotar no commit o ajuste necessário, se houver.
- [ ] **Step 2: Implementar** as páginas e componentes conforme o comportamento acima.
- [ ] **Step 3:** `npm run lint`, `npm test`, `npm run build` — Expected: sem erros; o build lista as rotas `/`, `/jogo` e `/sala/[codigo]`.
- [ ] **Step 4: Verificação local ponta a ponta:** `npm run server:build && ALLOWED_ORIGIN=http://localhost:3100 node dist-server/server.mjs &` e `npx next start -p 3100`; com o navegador (skill `claude-in-chrome`, se disponível) abrir duas abas: criar sala na A, entrar pelo link na B, dar uma tacada, ver as duas telas atualizarem, testar `sair`; abrir `/jogo` e confirmar que o modo IA joga como antes. Se não houver navegador disponível, pedir ao usuário para fazer esse teste e relatar.
- [ ] **Step 5: Commit** — `git add src && git commit -m "feat(ui): menu, modo IA em /jogo e salas online"`

### Task 12: Deploy no Dokploy

**Pré-requisito:** o usuário confirma o `push`. Não executar `git push` sem esse OK explícito.

- [ ] **Step 1:** Rodar `npm test`, `npm run lint`, `npm run build`, `npm audit --audit-level=high` na branch; relatar o resultado ao usuário e pedir confirmação para publicar.
- [ ] **Step 2:** Com o OK: `git checkout master && git merge --ff-only feat/multiplayer-etapa1 && git push origin master`.
- [ ] **Step 3:** Via API do Dokploy (chave em `/root/.config/dokploy/api_key`, header `x-api-key`, nunca impressa), no ambiente `Hh519YIqtFl8Vc0lwKIUD` do projeto Sinuca: `application.create` (`sinuca-server`); `application.saveGithubProvider` (`TGuiDev/sinuca_3d`, `master`, mesmo `githubId` do app web); `application.saveBuildType` com `buildType: "dockerfile"`, `dockerfile: "server/Dockerfile"`, `dockerContextPath: "."`; `application.saveEnvironment` com `ALLOWED_ORIGIN=https://sinuca.guidev.site`; `domain.create` para `sinuca.guidev.site` com `path: "/socket"`, `port: 8787`, `https: false`, `stripPath: false`. Conferir com `domain.byApplicationId` que o domínio do app web (`/`, porta 3000) segue intacto.
- [ ] **Step 4:** `application.deploy` do `sinuca-server` e do `sinuca-web` (o deploy automático continua desligado). Acompanhar `deployment.all` até `done`; em `error`, ler o log e corrigir a causa raiz.
- [ ] **Step 5: Verificação ponta a ponta pelo domínio:** `curl -s https://sinuca.guidev.site/socket/health` → `ok`; script `ws` em Node conectando em `wss://sinuca.guidev.site/socket` com `Origin: https://sinuca.guidev.site` cria e entra numa sala com dois clientes; o mesmo com `Origin: https://evil.example` é recusado (403); `curl -sI https://sinuca.guidev.site/jogo` → 200. Conferir que o container do servidor roda como não-root (`docker exec <container> id -u` ≠ 0) e que a porta 8787 não está publicada no host.
- [ ] **Step 6:** Pedir ao usuário um teste manual em dois dispositivos/abas pelo domínio real; só então dar a etapa 1 por concluída. Atualizar a memória do projeto (`project-sinuca`): etapa 1 entregue, etapas 2 (contas) e 3 (ranqueado) pendentes.
