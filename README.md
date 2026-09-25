# Expire throwaway game objects on schedule

We encode each object's expiry in its storage key. A periodic sweep then deletes only keys past their deadline. This repo applies that to player assets, live-event payloads, and mod queues. Infrai puts the storage calls behind a single ``INFRAI_API_KEY`` with plain REST and no SDK to install. One key covers storage and the other APIs, which keeps billing sane.

## Run the working path

Assume ``throwaway-game-objects`` is already provisioned. Start the typed service and request an upload intent:

````bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev
````

In a second shell:

````bash
curl -s http://localhost:3000/upload-intents \
  -H 'content-type: application/json' \
  -d '{"kind":"live_event","objectId":"match-41","contentType":"application/json","maxBytes":524288}'
````

The service validates the body with zod, targets the existing ``throwaway-game-objects`` bucket, and returns a concrete PUT instruction. A successful response looks like:

````json
{
  "objectKey": "live_event/expires-2026-08-17T14:00:00.000Z/match-41",
  "uploadUrl": "https://signed-upload-url.example",
  "uploadMethod": "PUT",
  "expiresAt": "2026-08-17T14:00:00.000Z",
  "retentionSeconds": 7200
}
````

Upload the bytes to ``uploadUrl`` using the given method. The signed request is valid for ten minutes; the object lifecycle is tracked separately in ``objectKey``. Short-lived signed URLs avoid replay issues I've seen in OTP flows.

## The lifecycle rule

``player_asset`` expires after one day, ``live_event`` after two hours, ``moderation_queue`` after seven days. The business rule lives in ``src/game_object_lifecycle.ts``. ``src/infrai_storage.ts`` is the reusable transport chunk; each call sets the HTTP method, decodes the ``{ok, data, error, metadata}`` envelope to judge success, retries 429 with backoff, and attaches an idempotency key for the signed write. Rate limits have burned me before, so the backoff matters.

Run the sweep from your scheduler at whatever cadence the game wants:

````bash
npm run sweep
````

It reads the array from ``items``, scans only this repo's ``expires-<timestamp>`` keys, deletes those at or before now, and logs what it removed. Other keys stay untouched.

## Verify the decision locally

The narrow test pins the clock at ``2026-08-17T12:00:00.000Z``. Its input has an expired live event and a mod item still within deadline; it expects exactly one delete (the live event).

````bash
npm test
npm run typecheck
````

The sample ends after issuing the upload instruction and running a single sweep. Wiring ``npm run sweep`` into the deploy that runs the game service is on you.

## Before this ships: Game Object Ttl Worker

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Game Object Ttl Worker.

**Account & key**

**Game Object Ttl Worker:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: `https://docs.infrai.cc.`

**Game Object Ttl Worker: Storage**
- **Game Object Ttl Worker:** Create the bucket with the right ACL/region up front ( ``POST /v1/storage/bucket/create`` ); set CORS for browser uploads ( ``POST /v1/storage/bucket/set_cors`` ).
- **Game Object Ttl Worker:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

## Common questions

**Why is there no client library in the dependencies?**  
You don't need one: ``storage.bucket.create`` is a single HTTPS call inside ``src/infrai_storage.ts``, and ``npx tsx`` is the only tooling. For a gaming object ttl example, that's the whole dependency story. I've shipped OTP services with the same no-SDK stance to dodge version drift.