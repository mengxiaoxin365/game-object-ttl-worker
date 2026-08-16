import type { StorageClient } from "./infrai_storage.js";

export const retentionSeconds = {
  player_asset: 24 * 60 * 60,
  live_event: 2 * 60 * 60,
  moderation_queue: 7 * 24 * 60 * 60,
} as const;

export type ObjectKind = keyof typeof retentionSeconds;

export function lifecycleKey(input: {
  kind: ObjectKind;
  objectId: string;
  createdAt: Date;
}): { key: string; expiresAt: Date } {
  const expiresAt = new Date(
    input.createdAt.getTime() + retentionSeconds[input.kind] * 1000,
  );
  return {
    key: `${input.kind}/expires-${expiresAt.toISOString()}/${input.objectId}`,
    expiresAt,
  };
}

export function expiryFromKey(key: string): Date | null {
  const match = key.match(/^[^/]+\/expires-([^/]+)\//);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function deleteExpiredObjects(
  storage: Pick<StorageClient, "listObjects" | "deleteObject">,
  bucket: string,
  now: Date,
): Promise<string[]> {
  const { items } = await storage.listObjects(bucket);
  const expired = items.filter((item) => {
    const expiresAt = expiryFromKey(item.key);
    return expiresAt !== null && expiresAt.getTime() <= now.getTime();
  });
  await Promise.all(expired.map((item) => storage.deleteObject(bucket, item.key)));
  return expired.map((item) => item.key);
}
