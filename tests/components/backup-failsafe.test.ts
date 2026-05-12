import { createComponent } from "solid-js/web";
import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  BackupFailsafeBanner,
  submitBackupFailsafeAction,
} from "../../src/components/backup/BackupFailsafeBanner";
import type { BackupFailsafeAlertView } from "../../src/server/backup/environment";

const alert = {
  id: "active",
  kind: "backup_path_drift",
  severity: "critical",
  message: "Backup location changed",
  previousProjectPath: "/tmp/old-data",
  previousStorePath: "/tmp/old-data/storage",
  currentProjectPath: "/tmp/new-data",
  currentStorePath: "/tmp/new-data/storage",
  gitRemote: "origin",
  gitRemoteUrl: null,
  gitBranch: "main",
  error: null,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
} satisfies BackupFailsafeAlertView;

describe("backup failsafe banner", () => {
  it("renders a red non-dismissible path drift warning", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, { alert }),
    );

    expect(html).toContain("Backup location changed");
    expect(html).toContain("/tmp/old-data");
    expect(html).toContain("/tmp/new-data");
    expect(html).toContain("Revert config");
    expect(html).toContain("Migrate backup");
    expect(html).toContain("bg-red");
    expect(html).not.toContain("Dismiss");
  });

  it("posts confirmed revert and migrate actions to their API endpoints", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await submitBackupFailsafeAction({ action: "revert", fetch });
    await submitBackupFailsafeAction({ action: "migrate", fetch });

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost/api/backup/failsafe/revert",
      "http://localhost/api/backup/failsafe/migrate",
    ]);
    expect(await requests[0]?.json()).toEqual({ confirm: true });
    expect(await requests[1]?.json()).toEqual({ confirm: true });
  });

  it("returns a fallback error when the request throws", async () => {
    const result = await submitBackupFailsafeAction({
      action: "migrate",
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Backup failsafe action request failed.",
    });
  });
});
