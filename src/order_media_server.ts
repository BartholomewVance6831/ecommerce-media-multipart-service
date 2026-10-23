import { createServer } from "node:http";
import { ensureEcommerceMediaBucket, infrai } from "./infrai_storage.js";
import { OrderMediaService } from "./order_media_service.js";

const bucket = process.env.INFRAI_MEDIA_BUCKET ?? "ecommerce-order-media";
const gateway = {
  create: infrai.storage.multipart.create,
  presignPart: infrai.storage.multipart.presign_part,
  complete: infrai.storage.multipart.complete
};
const orders = new OrderMediaService(gateway, bucket);
const bucketReady = ensureEcommerceMediaBucket(bucket);

async function json(request: import("node:http").IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function send(response: import("node:http").ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  try {
    await bucketReady;
    const match = request.url?.match(/^\/orders\/([^/]+)\/media(?:\/([^/]+)\/complete)?$/);
    if (!match) return send(response, 404, { message: "route not found" });
    const [, orderId, mediaId] = match;
    const body = await json(request);
    if (request.method === "POST" && !mediaId) return send(response, 201, await orders.start(orderId, body));
    if (request.method === "POST" && mediaId) return send(response, 200, await orders.finish(orderId, mediaId, body));
    return send(response, 405, { message: "method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    return send(response, 400, { message });
  }
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log("Order media service listening on http://localhost:3000");
});
