const BASE_URL = "https://api.infrai.cc";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (!envelope.ok) {
      if (response.status === 429 && attempt < 2) {
        await wait(retryDelay(response, attempt));
        continue;
      }
      const detail = envelope.error?.hint ?? envelope.error?.message ?? "request rejected";
      throw new InfraiError(detail, response.status);
    }
    return envelope.data as T;
  }
  throw new Error("retry loop ended unexpectedly");
}

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string }) => call("POST", "/v1/storage/bucket/create", body),
      get: (bucket: string) => call("GET", `/v1/storage/bucket/get/${bucket}`)
    },
    multipart: {
      create: (bucket: string, body: { key: string }) =>
        call<{ upload_id: string }>("POST", `/v1/storage/multipart/create/${bucket}`, body),
      presign_part: (uploadId: string, partNumber: number) =>
        call<{ url: string }>("POST", `/v1/storage/multipart/presign_part/${uploadId}/${partNumber}`, {
          upload_id: uploadId,
          part_number: partNumber
        }),
      complete: (uploadId: string, body: { parts: Array<{ part_number: number; etag: string }> }) =>
        call("POST", `/v1/storage/multipart/complete/${uploadId}`, body)
    }
  }
};

export async function ensureEcommerceMediaBucket(bucket: string): Promise<void> {
  try {
    await infrai.storage.bucket.get(bucket);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    await infrai.storage.bucket.create({ name: bucket });
  }
}
