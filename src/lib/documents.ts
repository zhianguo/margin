import type { DocumentSource } from "../types";

const FINGERPRINT_BYTES = 64 * 1024;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function fingerprintFile(file: File): Promise<string> {
  const head = await file.slice(0, FINGERPRINT_BYTES).arrayBuffer();
  const metadata = new TextEncoder().encode(
    `${file.name}:${file.size}:${file.lastModified}:`
  );
  const combined = new Uint8Array(metadata.length + head.byteLength);
  combined.set(metadata);
  combined.set(new Uint8Array(head), metadata.length);

  if (!crypto.subtle) {
    return `${file.name}-${file.size}-${file.lastModified}`;
  }

  const digest = await crypto.subtle.digest("SHA-256", combined);
  return toHex(digest).slice(0, 24);
}

export async function sourceFromFile(file: File): Promise<DocumentSource> {
  return {
    id: await fingerprintFile(file),
    name: file.name.replace(/\.pdf$/i, "") || "Untitled PDF",
    url: URL.createObjectURL(file),
    size: file.size
  };
}

export function demoSource(): DocumentSource {
  return {
    id: "margin-demo-control-systems-v1",
    name: "Stability Margins in Feedback Systems",
    url: "/demo-paper.pdf",
    isDemo: true
  };
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return "PDF";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
