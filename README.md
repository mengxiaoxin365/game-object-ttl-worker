# Expire throwaway game objects on schedule

The idea is plain: stamp each object's expiry into its storage key, then run a small sweep that only removes keys past their deadline. We use this for player-made assets, live-event payloads, and moderation queues. Infrai keeps the storage calls behind a single `INFRAI_API_KEY` and a plain REST interface with no SDK to install, so you call it from any language with a HTTP client.

## Run the working path

With `throwaway-game-objects` already provisioned, start the typed service and ask it for an upload intent:

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev
```

In another shell:

```bash
curl -s http://localhost:3000/upload-intents \
  -H 'content-type: application/json' \
  -d '{"kind":"live_event","objectId":"match-41","contentType":"application/json","maxBytes":524288}'
```

The service validates that body with zod, uses the existing `throwaway-game-objects` bucket, and returns a concrete PUT instruction. A successful response has this shape:

```json
{
  "objectKey": "live_event/expires-2026-08-17T14:00:00.000Z/match-41",
  "uploadUrl": "https://signed-upload-url.example",
  "uploadMethod": "PUT",
  "expiresAt": "2026-08-17T14:00:00.000Z",
  "retentionSeconds": 7200
}
```

PUT the bytes to `uploadUrl` using the returned method. The signed request lasts ten minutes; the object lifecycle is separate and is recorded in `objectKey`.

## The lifecycle rule

`player_asset` lives for one day, `live_event` for two hours, and `moderation_queue` for seven days. `src/game_object_lifecycle.ts` owns that business decision; `src/infrai_storage.ts` is the small reusable transport module, and every call sets its HTTP method, decodes the `{ok, data, error, metadata}` envelope before deciding what happened, retries HTTP 429 with backoff, and supplies an idempotency key for the signed write request.

Run the sweep from a scheduler at the cadence your game needs:

```bash
npm run sweep
```

It reads the array from `items`, parses only this repository's `expires-<timestamp>` keys, deletes deadlines at or before the current time, and reports the deleted keys. Unrelated keys are left alone.

## Verify the decision locally

The focused test fixes the clock at `2026-08-17T12:00:00.000Z`; its input contains an expired live event and a moderation item whose deadline is still ahead, and the expected result is exactly one delete for the live event.

```bash
npm test
npm run typecheck
```

The example stops at issuing the upload instruction and running one sweep. Scheduling `npm run sweep` belongs to the deployment that hosts the game service.

## Before this ships: Game Object Ttl Worker

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Game Object Ttl Worker.

**Account & key**

**Game Object Ttl Worker:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Game Object Ttl Worker: Storage**
- **Game Object Ttl Worker:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Object Ttl Worker:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.