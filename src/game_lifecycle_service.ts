import { createServer } from "node:http";
import { z } from "zod";
import { lifecycleKey, retentionSeconds } from "./game_object_lifecycle.js";
import { createStorageClient, InfraiError } from "./infrai_storage.js";

const BUCKET = "throwaway-game-objects";
const PORT = Number(process.env.PORT ?? 3000);
const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const storage = createStorageClient(apiKey);
const requestSchema = z.object({
  kind: z.enum(["player_asset", "live_event", "moderation_queue"]),
  objectId: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
  contentType: z.string().min(3).max(100),
  maxBytes: z.number().int().positive().max(20_000_000),
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/upload-intents") {
    return json(404, { error: "Route not found" });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.flatten() });

  const createdAt = new Date();
  const { key, expiresAt } = lifecycleKey({
    kind: parsed.data.kind,
    objectId: parsed.data.objectId,
    createdAt,
  });
  const upload = await storage.presignPut(BUCKET, key, {
    op: "put",
    expires_seconds: 10 * 60,
    content_type: parsed.data.contentType,
    max_bytes: parsed.data.maxBytes,
    idempotency_key: `${parsed.data.kind}:${parsed.data.objectId}`,
  });
  return json(201, {
    objectKey: key,
    uploadUrl: upload.url,
    uploadMethod: "PUT",
    expiresAt: expiresAt.toISOString(),
    retentionSeconds: retentionSeconds[parsed.data.kind],
  });
}

createServer(async (incoming, outgoing) => {
  try {
    const body: Uint8Array[] = [];
    for await (const chunk of incoming) body.push(chunk as Uint8Array);
    const request = new Request(`http://localhost${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers: incoming.headers as HeadersInit,
      body: body.length === 0 ? undefined : Buffer.concat(body),
    });
    const response = await handle(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const status = error instanceof InfraiError && error.status < 500 ? error.status : 502;
    outgoing.writeHead(status, { "content-type": "application/json" });
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
  }
}).listen(PORT, () => {
  console.log(`Game lifecycle service listening on http://localhost:${PORT}`);
});
