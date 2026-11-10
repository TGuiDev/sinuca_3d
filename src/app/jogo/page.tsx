import type { Metadata } from "next";
import GameLoader from "@/components/GameLoader";

export const metadata: Metadata = { title: "Sinuca — contra a IA" };

export default function Jogo() {
  return <GameLoader />;
}
