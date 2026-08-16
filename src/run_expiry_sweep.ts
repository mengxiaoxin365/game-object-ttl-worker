import { deleteExpiredObjects } from "./game_object_lifecycle.js";
import { createStorageClient } from "./infrai_storage.js";

const BUCKET = "throwaway-game-objects";
const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the sweep");

const storage = createStorageClient(apiKey);
await storage.createBucket(BUCKET);
const deletedKeys = await deleteExpiredObjects(storage, BUCKET, new Date());
console.log(JSON.stringify({ deletedCount: deletedKeys.length, deletedKeys }, null, 2));
