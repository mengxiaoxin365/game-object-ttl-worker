import { describe, expect, it, vi } from "vitest";
import { deleteExpiredObjects, lifecycleKey } from "../src/game_object_lifecycle.js";

describe("game object lifecycle", () => {
  it("deletes only keys whose encoded expiry has passed", async () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const expired = lifecycleKey({
      kind: "live_event",
      objectId: "match-41",
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
    }).key;
    const retained = lifecycleKey({
      kind: "moderation_queue",
      objectId: "report-9",
      createdAt: new Date("2026-08-17T09:00:00.000Z"),
    }).key;
    const deleteObject = vi.fn(async () => ({}));
    const storage = {
      listObjects: vi.fn(async () => ({ items: [{ key: expired }, { key: retained }] })),
      deleteObject,
    };

    const deleted = await deleteExpiredObjects(storage, "throwaway-game-objects", now);

    expect(deleted).toEqual([expired]);
    expect(deleteObject).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledWith("throwaway-game-objects", expired);
  });
});
