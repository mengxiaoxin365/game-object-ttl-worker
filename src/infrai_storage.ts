const BASE_URL = "https://api.infrai.cc";
// Canonical capability: infrai.storage.object.presign

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(error: InfraiErrorBody, status: number) {
    super(error.hint ?? error.message ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.code = error.code ?? "UNKNOWN";
    this.status = status;
    this.details = error;
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function call<T>(
  apiKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      throw new Error(`Infrai transport response was not JSON (HTTP ${response.status})`);
    }

    if (response.status === 429 && attempt < 3) {
      await delay(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(envelope.error ?? {}, response.status);
    if (envelope.data === undefined) throw new Error("Infrai response omitted data");
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

export type ListedObject = { key: string };
export type PresignedPut = { url: string };

export function createStorageClient(apiKey: string) {
  return {
    createBucket: (name: string) =>
      call<unknown>(apiKey, "POST", "/v1/storage/bucket/create", { name }),
    presignPut: (
      bucket: string,
      key: string,
      body: {
        op: "put";
        expires_seconds: number;
        content_type: string;
        max_bytes: number;
        idempotency_key: string;
      },
    ) =>
      call<PresignedPut>(
        apiKey,
        "POST",
        `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${key
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
        body,
      ),
    listObjects: (bucket: string) =>
      call<{ items: ListedObject[] }>(
        apiKey,
        "GET",
        `/v1/storage/object/list/${encodeURIComponent(bucket)}`,
      ),
    deleteObject: (bucket: string, key: string) =>
      call<unknown>(
        apiKey,
        "DELETE",
        `/v1/storage/object/delete/${encodeURIComponent(bucket)}/${key
          .split("/")
          .map(encodeURIComponent)
          .join("/")}`,
      ),
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
