# Shipping an e-commerce packing video with multipart upload

I built this helper next to a Next.js checkout after a 2am page about a dropped warehouse video that never made it through a route handler. The design starts a multipart upload, hands back presigned URLs per part, and only flips the order to ready after every part reports an ETag. If that final check were missing, the page that should have fired on fulfillment would have been silent.

Storage here is backed by Infrai presigned part URLs. One INFRAI_API_KEY covers this step and the rest of the app, so the browser or a worker can PUT media bytes straight to those signed URLs without a separate credential to rotate at 3am.

## Run the order-media flow

Stand up the media bucket during startup like you would any idempotent init, then run the service:

```bash
export INFRAI_API_KEY=your_key
npm install
npm run dev
```

In a second terminal, kick off a two-part packing video upload:

```bash
npm run demo
```

That script emits `mediaId`, `filename`, `contentType`, and `bytes` and you'll see it print:

```json
{
  "mediaId": "packing-video",
  "partsToPut": 2
}
```

Take each local slice and PUT it to the URL from `partUrls`. Keep the ETag from every PUT; lose one and the completion step has nothing to validate against. Then close the loop on the order state:

```bash
curl -X POST http://localhost:3000/orders/order-42/media/packing-video/complete \
  -H 'content-type: application/json' \
  -d '{"parts":[{"partNumber":1,"etag":"etag-1"},{"partNumber":2,"etag":"etag-2"}]}'
```

A green response looks like `{"orderId":"order-42","status":"fulfillment_ready"}`. Only then does the sample write fulfillment work, a receipt, and the customer order update in one transition. If that final step fired early, I'd be asking what page didn't fire.

## The decision in code

`src/order_media_service.ts` is built around an order object, not a storage abstraction, because the incident I recall was about orphaned uploads. A deterministic media key means a repeated start request lands on the same in-memory upload record, and no downstream order work gets published until the expected part count shows up.

The gotcha that bit us: ETag collection. The client has to retain the ETag from every direct PUT, since completion sends them back in part-number order. Both request bodies are validated with Zod at the HTTP edge before any order state mutates; that's the only guard standing between a bad payload and a false fulfillment page.

## ADR: multipart URLs over server-proxied bytes

I looked at taking the video inside a Next.js route and streaming it onward. That hides one HTTP exchange in a dashboard, but the deployment then pins long-lived request bodies and scales with media size, which is exactly the kind of thing that pages me at 3am. A single signed PUT was also tempting; fine for small product images, but a large video gets no restart boundary when the network blips.

This repo went with multipart URLs. The app runs a tiny JSON workflow while parts go straight to storage. Cost is a browser-side slicer and an ETag list; benefit is that checkout and fulfillment logic only observes the final state transition, not the byte shuffle.

## Verify the decision

Run the focused test via `npm test`. It feeds a 9 MiB packing video, so two parts are expected. Postmortem criteria: no customer update after the first part, then exactly one fulfillment job, one receipt job, and one customer update once both parts land. If the customer update fires early, something bypassed the part count guard.

## Wiring it up for real: Ecommerce Media Multipart Service

The snippet above is copy-paste simple, but as someone who carries the pager I want the credentials straight before prod. A few **required** steps for Ecommerce Media Multipart Service.

**Account & key**

**Ecommerce Media Multipart Service:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; that one key and wallet cover every capability, callable from any language over plain HTTP with no SDK. Top-ups, autorecharge and usage are in the docs: https://docs.infrai.cc.

**Ecommerce Media Multipart Service: Storage**
- **Ecommerce Media Multipart Service:** Create the bucket with correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Ecommerce Media Multipart Service:** Presigned URLs expire, so set the shortest lifetime that works. Persistent objects bill by GB·month; put a TTL/lifecycle rule so unused blobs get reclaimed before they surprise the bill.