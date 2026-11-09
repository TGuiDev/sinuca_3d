# Sinuca (Bola 8) — Design

## Objetivo
Jogo de Bola 8 no navegador, 1 jogador vs CPU simples. Sucesso: partida completa jogável, com física crível.

## Stack
Next (App Router, TypeScript) + Tailwind (HUD) + three puro. Componente cliente carregado com `dynamic(..., { ssr: false })`. Testes: Vitest.

## Módulos
- `physics/` — física 2D própria, passo fixo, sem dependência de Three. Colisão bola-bola elástica, atrito/rolamento, tabelas com restituição, caçapas.
- `rules/` — máquina de estados da Bola 8: mesa aberta, lisas/listradas, faltas, branca na mão, vitória/derrota pela bola 8.
- `ai/` — CPU: escolhe bola-alvo e caçapa, calcula ponto de contato, aplica erro aleatório de mira e ajusta força.
- `render/` — cena, mesa, bolas (texturas em canvas), taco, luzes, câmera (topo e orbital).
- `ui/` — HUD Tailwind: turno, bolas encaçapadas, barra de força, mensagens.

## Controles
Mouse mira; arrastar para trás define força; soltar dá a tacada. Após falta, mouse posiciona a branca.

## Testes
Unitários em `physics/` e `rules/`. Parte visual verificada rodando o jogo.

## Fora do escopo
Spin, multiplayer online, sons elaborados, modelos 3D externos.
