import assert from "node:assert/strict";
import test from "node:test";
import { OrderMediaService } from "./order_media_service.js";

test("an order changes state only after every expected media part completes", async () => {
  const completed: Array<{ parts: Array<{ part_number: number; etag: string }> }> = [];
  const service = new OrderMediaService({
    create: async () => ({ upload_id: "upload-42" }),
    presignPart: async (_uploadId, partNumber) => ({ url: `https://upload.example/${partNumber}` }),
    complete: async (_uploadId, body) => { completed.push(body); }
  }, "ecommerce-order-media");

  const started = await service.start("order-42", {
    mediaId: "packing-video",
    filename: "packing.mp4",
    contentType: "video/mp4",
    bytes: 9 * 1024 * 1024
  });
  assert.equal(started.partUrls.length, 2);
  await assert.rejects(() => service.finish("order-42", "packing-video", { parts: [{ partNumber: 1, etag: "a" }] }));
  assert.deepEqual(service.customerOrderUpdates, []);

  const result = await service.finish("order-42", "packing-video", {
    parts: [{ partNumber: 1, etag: "a" }, { partNumber: 2, etag: "b" }]
  });
  assert.equal(result.status, "fulfillment_ready");
  assert.deepEqual(completed, [{ parts: [{ part_number: 1, etag: "a" }, { part_number: 2, etag: "b" }] }]);
  assert.deepEqual(service.fulfillmentQueue, ["order-42"]);
  assert.deepEqual(service.receiptQueue, ["order-42"]);
  assert.deepEqual(service.customerOrderUpdates, ["order-42"]);
});
