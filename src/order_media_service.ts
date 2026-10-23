import { z } from "zod";

export const startOrderMediaSchema = z.object({
  mediaId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  bytes: z.number().int().positive()
});

export const finishOrderMediaSchema = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    etag: z.string().min(1)
  })).min(1)
});

type StartOrderMedia = z.infer<typeof startOrderMediaSchema>;
type FinishOrderMedia = z.infer<typeof finishOrderMediaSchema>;

export type MultipartGateway = {
  create(bucket: string, body: { key: string }): Promise<{ upload_id: string }>;
  presignPart(uploadId: string, partNumber: number): Promise<{ url: string }>;
  complete(uploadId: string, body: { parts: Array<{ part_number: number; etag: string }> }): Promise<unknown>;
};

type MediaRecord = {
  orderId: string;
  mediaId: string;
  uploadId: string;
  key: string;
  expectedParts: number;
  status: "awaiting_parts" | "fulfillment_ready";
};

const PART_BYTES = 8 * 1024 * 1024;

export class OrderMediaService {
  private readonly media = new Map<string, MediaRecord>();
  private readonly gateway: MultipartGateway;
  private readonly bucket: string;
  readonly fulfillmentQueue: string[] = [];
  readonly receiptQueue: string[] = [];
  readonly customerOrderUpdates: string[] = [];

  constructor(gateway: MultipartGateway, bucket: string) {
    this.gateway = gateway;
    this.bucket = bucket;
  }

  async start(orderId: string, input: unknown): Promise<{ mediaId: string; partUrls: Array<{ partNumber: number; url: string }> }> {
    const media = startOrderMediaSchema.parse(input);
    const recordId = `${orderId}:${media.mediaId}`;
    const existing = this.media.get(recordId);
    if (existing) return this.partUrls(existing);

    const key = `orders/${orderId}/fulfillment-media/${media.mediaId}-${media.filename}`;
    const created = await this.gateway.create(this.bucket, { key });
    const record: MediaRecord = {
      orderId,
      mediaId: media.mediaId,
      uploadId: created.upload_id,
      key,
      expectedParts: Math.ceil(media.bytes / PART_BYTES),
      status: "awaiting_parts"
    };
    this.media.set(recordId, record);
    return this.partUrls(record);
  }

  async finish(orderId: string, mediaId: string, input: unknown): Promise<{ orderId: string; status: string }> {
    const finished = finishOrderMediaSchema.parse(input);
    const record = this.media.get(`${orderId}:${mediaId}`);
    if (!record) throw new Error("media upload was not started");
    if (record.status === "fulfillment_ready") return { orderId, status: record.status };
    if (finished.parts.length !== record.expectedParts) throw new Error("all media parts must be present before fulfillment");

    await this.gateway.complete(record.uploadId, {
      parts: finished.parts.map((part) => ({ part_number: part.partNumber, etag: part.etag }))
    });
    record.status = "fulfillment_ready";
    this.fulfillmentQueue.push(orderId);
    this.receiptQueue.push(orderId);
    this.customerOrderUpdates.push(orderId);
    return { orderId, status: record.status };
  }

  private async partUrls(record: MediaRecord): Promise<{ mediaId: string; partUrls: Array<{ partNumber: number; url: string }> }> {
    const partUrls = await Promise.all(Array.from({ length: record.expectedParts }, async (_, index) => {
      const partNumber = index + 1;
      const signed = await this.gateway.presignPart(record.uploadId, partNumber);
      return { partNumber, url: signed.url };
    }));
    return { mediaId: record.mediaId, partUrls };
  }
}
