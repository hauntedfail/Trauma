import { describe, expect, it } from "vitest";

import { acquireBackupFailsafeActionLease } from "../../../src/server/backup/failsafe-action-coordination";
import { withBackupFailsafeActionLease } from "../../../src/server/backup/failsafe-action-coordination";

describe("backup failsafe action coordination", () => {
  it("grants one config identity lease at a time in arrival order", async () => {
    const identity = "/tmp/trauma-failsafe-coordination.sqlite";
    const firstRelease = await acquireBackupFailsafeActionLease(identity);
    const granted: string[] = [];

    const second = acquireBackupFailsafeActionLease(identity).then((release) => {
      granted.push("second");
      return release;
    });
    const third = acquireBackupFailsafeActionLease(identity).then((release) => {
      granted.push("third");
      return release;
    });

    await Promise.resolve();
    expect(granted).toEqual([]);

    firstRelease();
    const secondRelease = await second;
    expect(granted).toEqual(["second"]);

    secondRelease();
    const thirdRelease = await third;
    expect(granted).toEqual(["second", "third"]);
    thirdRelease();
  });

  it("allows coordinated environment writers to re-enter the active action", async () => {
    const identity = "/tmp/trauma-failsafe-reentrant.sqlite";
    const events: string[] = [];

    await withBackupFailsafeActionLease(identity, async () => {
      events.push("action");
      await withBackupFailsafeActionLease(identity, async () => {
        events.push("writer");
      });
    });

    expect(events).toEqual(["action", "writer"]);
  });

  it("does not let a detached stale context bypass a later lease owner", async () => {
    const identity = "/tmp/trauma-failsafe-detached-reentry.sqlite";
    let resumeDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => {
      resumeDetached = resolve;
    });
    const events: string[] = [];
    let detached!: Promise<void>;

    await withBackupFailsafeActionLease(identity, async () => {
      detached = (async () => {
        await detachedGate;
        await withBackupFailsafeActionLease(identity, async () => {
          events.push("detached");
        });
      })();
    });

    const releaseNextOwner = await acquireBackupFailsafeActionLease(identity);
    resumeDetached();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseNextOwner();
    await detached;
    expect(events).toEqual(["detached"]);
  });
});
