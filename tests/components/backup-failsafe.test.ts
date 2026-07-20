import { createComponent } from "solid-js/web";
import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  BackupFailsafeBanner,
  BackupFailsafeRestartNotice,
  shouldReloadAfterBackupFailsafeAction,
  submitBackupFailsafeAction,
} from "../../src/components/backup/BackupFailsafeBanner";
import type { BackupFailsafeAlertView } from "../../src/server/backup/environment";

const alert = {
  id: "active",
  kind: "backup_path_drift",
  severity: "critical",
  message: "Backup location changed",
  availableActions: ["revert", "migrate"],
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
  generation: "a".repeat(64),
} satisfies BackupFailsafeAlertView;

describe("backup failsafe banner", () => {
  it("renders a red non-dismissible path drift warning", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, { alert }),
    );

    expect(html).toContain("Backup location changed");
    expect(html).not.toContain("/tmp/");
    expect(html).toContain("Revert config");
    expect(html).toContain("Migrate backup");
    expect(html).toContain("bg-red");
    expect(html).not.toContain("Dismiss");
  });

  it("renders a retry action for push failure alerts", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, {
        alert: {
          ...alert,
          kind: "backup_push_failed",
          message: "Backup push failed",
          availableActions: ["migrate"],
        },
      }),
    );

    expect(html).toContain("Backup push failed");
    expect(html).not.toContain("Revert config");
    expect(html).toContain("Retry backup push");
  });

  it("renders content integrity alerts without path migration actions", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, {
        alert: {
          ...alert,
          kind: "backup_content_inconsistent",
          message: "Backup content is inconsistent",
          availableActions: ["delete-missing-record"],
        },
      }),
    );

    expect(html).toContain("Backup content is inconsistent");
    expect(html).toContain(
      "backup metadata marked successful while the content file is missing",
    );
    expect(html).not.toContain("Revert config");
    expect(html).not.toContain("Migrate backup");
    expect(html).toContain("Delete missing memory record");
  });

  it("does not render delete action for non-missing content integrity alerts", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, {
        alert: {
          ...alert,
          kind: "backup_content_inconsistent",
          message: "Backup content is inconsistent",
          availableActions: [],
        },
      }),
    );

    expect(html).toContain("Backup content is inconsistent");
    expect(html).not.toContain("Delete missing memory record");
  });

  it("does not render revert when a path drift alert has no previous paths", () => {
    const html = renderToString(() =>
      createComponent(BackupFailsafeBanner, {
        alert: {
          ...alert,
          availableActions: ["migrate"],
        },
      }),
    );

    expect(html).not.toContain("Revert config");
    expect(html).toContain("Migrate backup");
  });

  it("posts confirmed backup failsafe actions to their API endpoints", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    await submitBackupFailsafeAction({
      action: "revert",
      generation: alert.generation,
      fetch,
    });
    await submitBackupFailsafeAction({
      action: "migrate",
      generation: alert.generation,
      fetch,
    });
    await submitBackupFailsafeAction({
      action: "delete-missing-record",
      generation: alert.generation,
      fetch,
    });

    expect(requests.map((request) => request.url)).toEqual([
      "http://localhost/api/backup/failsafe/revert",
      "http://localhost/api/backup/failsafe/migrate",
      "http://localhost/api/backup/failsafe/delete-missing-record",
    ]);
    expect(await requests[0]?.json()).toEqual({
      confirm: true,
      generation: alert.generation,
    });
    expect(await requests[1]?.json()).toEqual({
      confirm: true,
      generation: alert.generation,
    });
    expect(await requests[2]?.json()).toEqual({
      confirm: true,
      generation: alert.generation,
    });
  });

  it("returns a fallback error when the request throws", async () => {
    const result = await submitBackupFailsafeAction({
      action: "migrate",
      generation: alert.generation,
      fetch: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Backup failsafe action request failed.",
      restartRequired: false,
    });
  });

  it("preserves the server restart requirement instead of requesting a page reload", async () => {
    const result = await submitBackupFailsafeAction({
      action: "revert",
      generation: alert.generation,
      fetch: async () => new Response(JSON.stringify({
        ok: true,
        restartRequired: true,
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    });

    expect(result).toEqual({ ok: true, restartRequired: true });
    expect(shouldReloadAfterBackupFailsafeAction(result)).toBe(false);
    expect(
      renderToString(() => createComponent(BackupFailsafeRestartNotice, {})),
    ).toContain("Restart the TRAUMA process/server");
  });

  it("keeps a post-suspension failure terminal until the process restarts", async () => {
    const result = await submitBackupFailsafeAction({
      action: "revert",
      generation: alert.generation,
      fetch: async () => new Response(JSON.stringify({
        error: "Configuration rewrite failed.",
        restartRequired: true,
      }), {
        headers: { "content-type": "application/json" },
        status: 500,
      }),
    });

    expect(result).toEqual({
      error: "Configuration rewrite failed.",
      ok: false,
      restartRequired: true,
    });
    expect(shouldReloadAfterBackupFailsafeAction(result)).toBe(false);
  });
});
