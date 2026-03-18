import { finalizeEvent } from "nostr-tools";

export interface BlossomBlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded: number;
  [key: string]: unknown;
}

const AUTH_TOKEN_TTL_SECONDS = 60 * 5;

export const DEFAULT_BLOSSOM_RELAY =
  process.env.NEXT_PUBLIC_BLOSSOM_RELAY || "https://nostr.download";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);

  return toHex(digest);
}

function createAuthorizationHeader(secretKey: Uint8Array, sha256: string, relayUrl: string): string {
  const relayHost = new URL(relayUrl).host.toLowerCase();
  const authEvent = finalizeEvent(
    {
      kind: 24242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["t", "upload"],
        ["x", sha256],
        ["expiration", String(Math.floor(Date.now() / 1000) + AUTH_TOKEN_TTL_SECONDS)],
        ["server", relayHost],
      ],
      content: "Upload Blob",
    },
    secretKey
  );

  return `Nostr ${btoa(JSON.stringify(authEvent))}`;
}

async function readRelayError(response: Response): Promise<string> {
  const relayReason = response.headers.get("x-reason") || response.headers.get("X-Reason");
  if (relayReason) {
    return relayReason;
  }

  const text = await response.text();
  if (text) {
    return text;
  }

  return `Upload failed with status ${response.status}`;
}

export async function uploadBlobToBlossom({
  file,
  secretKey,
  relayUrl = DEFAULT_BLOSSOM_RELAY,
}: {
  file: File;
  secretKey: Uint8Array;
  relayUrl?: string;
}): Promise<BlossomBlobDescriptor> {
  const sha256 = await sha256Hex(file);
  const uploadUrl = new URL("/upload", relayUrl).toString();
  const authorization = createAuthorizationHeader(secretKey, sha256, relayUrl);
  const contentType = file.type || "application/octet-stream";

  const requirementsResponse = await fetch(uploadUrl, {
    method: "HEAD",
    headers: {
      Authorization: authorization,
      "X-Content-Length": String(file.size),
      "X-Content-Type": contentType,
      "X-SHA-256": sha256,
    },
  });

  if (!requirementsResponse.ok) {
    throw new Error(await readRelayError(requirementsResponse));
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "X-SHA-256": sha256,
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(await readRelayError(uploadResponse));
  }

  return (await uploadResponse.json()) as BlossomBlobDescriptor;
}
