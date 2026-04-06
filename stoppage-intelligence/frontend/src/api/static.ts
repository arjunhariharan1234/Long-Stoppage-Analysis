/**
 * Static data loader — serves pre-computed JSON from /data/ directory.
 * Falls back to the backend API when static data isn't available (new uploads).
 */

const STATIC_UPLOAD_ID = 1; // The pre-seeded JSW Steel upload

export function isStaticUpload(uploadId: number): boolean {
  return uploadId === STATIC_UPLOAD_ID;
}

export async function fetchStatic(path: string): Promise<any> {
  const res = await fetch(`/data/${path}`);
  if (!res.ok) throw new Error(`Static fetch failed: ${res.status}`);
  return res.json();
}
