import type { Metadata } from "next";
import { Suspense } from "react";
import RoomLoader, { Carregando } from "@/components/RoomLoader";

export const metadata: Metadata = { title: "Sinuca — sala online" };

// Com cacheComponents e sem generateStaticParams, `params` é dado de runtime:
// o acesso fica dentro de <Suspense> para o shell estático ser prerenderizado.
export default function Sala({ params }: PageProps<"/sala/[codigo]">) {
  return (
    <Suspense fallback={<Carregando />}>
      {params.then(({ codigo }) => (
        <RoomLoader codigo={codigo} />
      ))}
    </Suspense>
  );
}
