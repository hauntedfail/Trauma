import { afterEach, describe, expect, it } from "vitest";

import {
  cancelCodexDeviceCodeLogin,
  deleteCodexAuth,
  readCodexAuthStatus,
  resetCodexAuthForTests,
  startCodexDeviceCodeLogin,
  type CodexAuthClient,
} from "../../../src/server/settings/codex-auth";
import type {
  CodexAuthEvent,
  CodexAuthStatus,
  CodexDeviceCodeLogin,
  CodexLogoutResult,
} from "../../../src/server/translation/codex-app-server";

afterEach(() => {
  resetCodexAuthForTests();
});

describe("Codex auth settings service", () => {
  it("returns enabled only after app-server auth is confirmed", async () => {
    const client = createCodexAuthClient({
      authStatus: { status: "enabled" },
    });

    await expect(readCodexAuthStatus({ client })).resolves.toEqual({
      status: "enabled",
      provider: "codex",
      message: "Codex ChatGPT sign-in is enabled.",
    });
  });

  it("starts a safe device-code login and reuses pending metadata", async () => {
    resetCodexAuthForTests();
    const client = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      login: {
        loginId: "login-1",
        verificationUrl: "https://example.com/device",
        userCode: "ABCD-EFGH",
      },
    });

    await expect(startCodexDeviceCodeLogin({ client })).resolves.toEqual({
      status: "login_started",
      provider: "codex",
      loginId: "login-1",
      verificationUrl: "https://example.com/device",
      userCode: "ABCD-EFGH",
    });
    await expect(readCodexAuthStatus({ client })).resolves.toEqual({
      status: "login_started",
      provider: "codex",
      loginId: "login-1",
      verificationUrl: "https://example.com/device",
      userCode: "ABCD-EFGH",
    });
  });

  it("cancels pending device-code setup through Codex app-server", async () => {
    resetCodexAuthForTests();
    const canceled: string[] = [];
    const client = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      cancel: async ({ loginId }) => {
        canceled.push(loginId);
      },
      login: {
        loginId: "login-2",
        verificationUrl: "https://example.com/device",
        userCode: "WXYZ-1234",
      },
    });

    await startCodexDeviceCodeLogin({ client });
    await expect(cancelCodexDeviceCodeLogin({ client })).resolves.toEqual({
      status: "canceled",
      provider: "codex",
      loginId: "login-2",
    });
    expect(canceled).toEqual(["login-2"]);
  });

  it("logs out via Codex app-server without deleting credential files", async () => {
    const client = createCodexAuthClient({
      authStatus: { status: "enabled" },
      logout: async () => ({ status: "logged_out" }),
    });

    await expect(deleteCodexAuth({ client })).resolves.toEqual({
      status: "disabled",
      provider: "codex",
      logoutStatus: "logged_out",
    });
  });
});

function createCodexAuthClient(input: {
  authStatus: CodexAuthStatus;
  cancel?: (input: { loginId: string }) => Promise<void>;
  login?: CodexDeviceCodeLogin;
  logout?: () => Promise<CodexLogoutResult>;
}): CodexAuthClient {
  return {
    cancelDeviceCodeLogin: input.cancel ?? (async () => undefined),
    checkAuth: async () => input.authStatus,
    logout: input.logout ?? (async () => ({ status: "logged_out" })),
    observeAuthEvents: async function* (): AsyncIterable<CodexAuthEvent> {
      return;
    },
    startDeviceCodeLogin: async () => {
      if (input.login === undefined) {
        throw new Error("login unavailable");
      }
      return input.login;
    },
  };
}
