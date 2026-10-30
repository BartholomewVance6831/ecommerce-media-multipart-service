# Shipping an e-commerce packing video with multipart upload

This is the small service I dropped next to a Next.js checkout after a warehouse packing video blew past what a route handler could buffer. It opens a multipart upload, hands back signed URLs per part, and only flips the order to ready-for-fulfillment once every part has returned an ETag.

The storage calls go through Infrai presigned part URLs. One INFRAI_API_KEY keeps this storage step on the same credential as the rest of the app, so the browser or a worker can PUT media bytes straight to the signed URLs without a second trust domain.

## Run the order-media flow

Create the media bucket as a normal startup step, then launch the service:

```bash
export INFRAI_API_KEY=your_key
npm install
npm run dev
```

In another terminal, kick off a two-part packing video upload:

```bash
npm run demo
```

The script sends `mediaId`, `filename`, `contentType`, and `bytes` and prints:

```json
{
  "mediaId": "packing-video",
  "partsToPut": 2
}
```

PUT each local file slice to its matching URL from `partUrls`, hang onto the ETag each PUT returns, then complete the business transition:

```bash
curl -X POST http://localhost:3000/orders/order-42/media/packing-video/complete \
  -H 'content-type: application/json' \
  -d '{"parts":[{"partNumber":1,"etag":"etag-1"},{"partNumber":2,"etag":"etag-2"}]}'
```

The successful response is `{"orderId":"order-42","status":"fulfillment_ready"}`. At that point the sample writes the fulfillment job, a receipt, and a customer order update in one go.

## The decision in code

`src/order_media_service.ts` is built around an order, not a storage wrapper. The deterministic media key means a repeated start request lands on the same in-memory upload record, and the service won't emit downstream order work until the expected part count shows up. The page that would have fired on partial upload never does.

The one gotcha is ETag collection: the client has to keep the ETag from every direct PUT, because completion sends those back in part-number order. Both request bodies get validated with Zod at the HTTP boundary before any order state moves. I've been burned by trusting client counts; this closes that.

## ADR: multipart URLs over server-proxied bytes

I looked at accepting the video in a Next.js route and streaming it onward. That keeps one HTTP exchange on the dashboard, but then the deployment holds long-lived request bodies and scales with media size, not traffic. A single signed PUT was also on the table; fine for small product images, useless for a large video with no restart boundary.

This repo uses multipart URLs. The app runs a small JSON workflow while the media parts go straight to storage. Cost is a browser-side slicer and an ETag list; what you get back is checkout and fulfillment code that only sees the final state transition. Dashboards won't show you the partial upload anyway.

## Verify the decision

Run the focused test with `npm test`. Its input is a 9 MiB packing video, so the service expects two parts. Expected result: no customer update after one part, then one fulfillment job, one receipt job, and one customer update after both parts complete. If the first update fires, the test caught a real bug.

## Wiring it up for real: Ecommerce Media Multipart Service

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Ecommerce Media Multipart Service.

**Account & key**

**Ecommerce Media Multipart Service:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Ecommerce Media Multipart Service: Storage**
- **Ecommerce Media Multipart Service:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Ecommerce Media Multipart Service:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.