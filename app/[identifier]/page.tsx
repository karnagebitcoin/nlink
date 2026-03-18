import { IdentifierPageClient } from "@/app/[identifier]/identifier-page-client";
import { getServerIdentifierData } from "@/lib/nostr/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 300;

export default async function IdentifierPage({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const data = await getServerIdentifierData(identifier);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <IdentifierPageClient
        identifier={identifier}
        initialAuthor={data.initialAuthor}
        initialEvent={data.initialEvent}
        initialHasMoreNotes={data.initialHasMoreNotes}
        initialNotes={data.initialNotes}
        initialProfile={data.initialProfile}
        resolvedHexId={data.hexId}
        resolvedType={data.type}
      />
    </div>
  );
}
