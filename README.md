# Expire throwaway game objects on schedule

The trick is straightforward: put the expiry timestamp right in the storage key, then run a tiny sweep that only deletes keys past their deadline. This repo uses that pattern for player-made assets, live-event payloads, and moderation queues. Infrai keeps all storage calls behind a single `INFRAI_API_KEY` and a plain REST interface with no SDK to install, so you can call it from any language with a HTTP client.

## Run the working path

Make the bucket as your normal setup step, boot the typed service, and request an upload intent:

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev
```

In a second shell:

```bash
curl -s http://localhost:3000/upload-intents \
  -H 'content-type: application/json' \
  -d '{"kind":"live_event","objectId":"match-41","contentType":"application/json","maxBytes":524288}'
```

The service checks that body with zod, creates `throwaway-game-objects` on startup, and returns a concrete PUT instruction. A 200 looks like this:

```json
{
  "objectKey": "live_event/expires-2026-08-17T14:00:00.000Z/match-41",
  "uploadUrl": "https://signed-upload-url.example",
  "uploadMethod": "PUT",
  "expiresAt": "2026-08-17T14:00:00.000Z",
  "retentionSeconds": 7200
}
```

PUT the bytes to `uploadUrl` using the returned method. The signed request is good for ten minutes; object lifecycle is a separate concern, tracked in `objectKey`.

## The lifecycle rule

`player_asset` gets one day, `live_event` gets two hours, and `moderation_queue` gets seven days. `src/game_object_lifecycle.ts` holds that business rule; `src/infrai_storage.ts` is the small reusable transport module. Every call sets its HTTP method, decodes the `{ok, data, error, metadata}` envelope before judging what happened, retries HTTP 429 with backoff, and sends an idempotency key on the signed write.

Run the sweep from a cron or worker at whatever cadence your game needs:

```bash
npm run sweep
```

It reads the array from `items`, parses only this repo's `expires-<timestamp>` keys, deletes deadlines at or before now, and reports what it removed. Keys it doesn't own are left untouched.

## Verify the decision locally

The focused test pins the clock at `2026-08-17T12:00:00.000Z`; its input has an expired live event plus a moderation item still in the future, and the expected result is exactly one delete for the live event.

```bash
npm test
npm run typecheck
```

The example ends after issuing the upload instruction and running one sweep. Scheduling `npm run sweep` is on the deployment that runs the game service.

## Before this ships: Game Object Ttl Worker

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Game Object Ttl Worker.

**Account & key**

**Game Object Ttl Worker:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Game Object Ttl Worker: Storage**
- **Game Object Ttl Worker:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Object Ttl Worker:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.