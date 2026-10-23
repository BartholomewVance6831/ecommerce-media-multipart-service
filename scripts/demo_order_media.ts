export {};

const payload = {
  mediaId: "packing-video",
  filename: "packing.mp4",
  contentType: "video/mp4",
  bytes: 9 * 1024 * 1024
};

const started = await fetch("http://localhost:3000/orders/order-42/media", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
});
const upload = await started.json() as { mediaId: string; partUrls: Array<{ partNumber: number; url: string }> };
console.log(JSON.stringify({ mediaId: upload.mediaId, partsToPut: upload.partUrls.length }, null, 2));
