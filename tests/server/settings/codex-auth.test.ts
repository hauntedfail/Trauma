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

  it("closes owned Codex auth clients after status checks", async () => {
    let closeCalls = 0;

    await expect(
      readCodexAuthStatus({
        createClient: () =>
          createCodexAuthClient({
            authStatus: { status: "enabled" },
            close: async () => {
              closeCalls += 1;
            },
          }),
      }),
    ).resolves.toMatchObject({
      status: "enabled",
    });

    expect(closeCalls).toBe(1);
  });

  it("stops and closes the pending auth observer after local cancel", async () => {
    resetCodexAuthForTests();
    let closeCalls = 0;
    let observerReturned = false;
    const client = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      close: async () => {
        closeCalls += 1;
      },
      events: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<CodexAuthEvent>>(() => undefined),
          return: async () => {
            observerReturned = true;
            return { done: true, value: undefined };
          },
        }),
      }),
      login: {
        loginId: "login-cancel-observer",
        verificationUrl: "https://example.com/device",
        userCode: "CANCEL-1",
      },
    });

    await startCodexDeviceCodeLogin({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await cancelCodexDeviceCodeLogin({ client });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observerReturned).toBe(true);
    expect(closeCalls).toBe(0);
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

  it("drops stale pending device-code metadata when app-server auth is no longer setup-required", async () => {
    resetCodexAuthForTests();
    const client = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      login: {
        loginId: "login-stale",
        verificationUrl: "https://example.com/device",
        userCode: "STALE-1",
      },
    });

    await startCodexDeviceCodeLogin({ client });

    const disabledClient = createCodexAuthClient({
      authStatus: { status: "disabled", reason: "signed_out" },
    });
    await expect(readCodexAuthStatus({ client: disabledClient })).resolves.toEqual({
      status: "disabled",
      provider: "codex",
      reason: "signed_out",
    });
  });

  it("clears pending device-code metadata when observer auth checks fail", async () => {
    resetCodexAuthForTests();
    let checkCount = 0;
    let resolveObserverCheck: (() => void) | undefined;
    const observerCheck = new Promise<void>((resolve) => {
      resolveObserverCheck = resolve;
    });
    const client = createCodexAuthClient({
      authStatus: () => {
        checkCount += 1;
        if (checkCount === 1) {
          return { status: "setup_required", reason: "auth_required" };
        }
        resolveObserverCheck?.();
        throw new Error("auth check failed");
      },
      events: [{ type: "account.updated" }],
      login: {
        loginId: "login-observer-error",
        verificationUrl: "https://example.com/device",
        userCode: "ERROR-1",
      },
    });

    await startCodexDeviceCodeLogin({ client });
    await observerCheck;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const statusClient = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
    });
    await expect(readCodexAuthStatus({ client: statusClient })).resolves.toEqual({
      status: "setup_required",
      provider: "codex",
      reason: "auth_required",
    });
  });

  it("keeps newer observer teardown when an older observer exits", async () => {
    resetCodexAuthForTests();
    const oldEvents = createControlledAuthEvents();
    const newEvents = createControlledAuthEvents();
    const oldClient = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      events: oldEvents.events,
      login: {
        loginId: "login-old",
        verificationUrl: "https://example.com/device",
        userCode: "OLD-1",
      },
    });
    const newClient = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      events: newEvents.events,
      login: {
        loginId: "login-new",
        verificationUrl: "https://example.com/device",
        userCode: "NEW-1",
      },
    });

    await startCodexDeviceCodeLogin({ client: oldClient });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await cancelCodexDeviceCodeLogin({ client: oldClient });
    await startCodexDeviceCodeLogin({ client: newClient });

    oldEvents.resolveNext({ done: true, value: undefined });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await cancelCodexDeviceCodeLogin({ client: newClient });

    expect(newEvents.returned()).toBe(true);
  });

  it("clears pending device-code metadata after confirmed login completion", async () => {
    resetCodexAuthForTests();
    let resolveConfirmedCheck: (() => void) | undefined;
    const confirmedCheck = new Promise<void>((resolve) => {
      resolveConfirmedCheck = resolve;
    });
    let checkCount = 0;
    const client = createCodexAuthClient({
      authStatus: () => {
        checkCount += 1;
        if (checkCount === 1) {
          return { status: "setup_required", reason: "auth_required" };
        }
        resolveConfirmedCheck?.();
        return { status: "enabled" };
      },
      events: [{
        type: "account.login.completed",
        loginId: "login-1",
        success: true,
        error: null,
      }],
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
    await confirmedCheck;

    await expect(readCodexAuthStatus({ client })).resolves.toEqual({
      status: "enabled",
      provider: "codex",
      message: "Codex ChatGPT sign-in is enabled.",
    });
  });

  it("clears pending device-code metadata after a failed login completion", async () => {
    resetCodexAuthForTests();
    const client = createCodexAuthClient({
      authStatus: { status: "setup_required", reason: "auth_required" },
      events: [{
        type: "account.login.completed",
        loginId: "login-failed",
        success: false,
        error: "authorization declined",
      }],
      login: {
        loginId: "login-failed",
        verificationUrl: "https://example.com/device",
        userCode: "FAIL-CODE",
      },
    });

    await startCodexDeviceCodeLogin({ client });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await expect(readCodexAuthStatus({ client })).resolves.toEqual({
      status: "setup_required",
      provider: "codex",
      reason: "auth_required",
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

  it("does not report disabled when Codex logout is unsupported", async () => {
    const client = createCodexAuthClient({
      authStatus: { status: "enabled" },
      logout: async () => ({
        status: "unsupported",
        message: "Codex app-server does not support logout.",
      }),
    });

    await expect(deleteCodexAuth({ client })).resolves.toEqual({
      status: "unsupported",
      provider: "codex",
      logoutStatus: "unsupported",
      message: "Codex app-server does not support logout.",
    });
  });
});

function createCodexAuthClient(input: {
  authStatus: CodexAuthStatus | (() => CodexAuthStatus);
  cancel?: (input: { loginId: string }) => Promise<void>;
  close?: () => Promise<void>;
  events?: CodexAuthEvent[] | (() => AsyncIterable<CodexAuthEvent>);
  login?: CodexDeviceCodeLogin;
  logout?: () => Promise<CodexLogoutResult>;
}): CodexAuthClient {
  return {
    cancelDeviceCodeLogin: input.cancel ?? (async () => undefined),
    checkAuth: async () =>
      typeof input.authStatus === "function"
        ? input.authStatus()
        : input.authStatus,
    close: input.close,
    logout: input.logout ?? (async () => ({ status: "logged_out" })),
    observeAuthEvents: (): AsyncIterable<CodexAuthEvent> => {
      const events = input.events;
      if (typeof events === "function") {
        return events();
      }
      return (async function* () {
        for (const event of events ?? []) {
          yield event;
        }
      })();
    },
    startDeviceCodeLogin: async () => {
      if (input.login === undefined) {
        throw new Error("login unavailable");
      }
      return input.login;
    },
  };
}

function createControlledAuthEvents(): {
  events: () => AsyncIterable<CodexAuthEvent>;
  resolveNext: (value: IteratorResult<CodexAuthEvent>) => void;
  returned: () => boolean;
} {
  let returned = false;
  let resolveNext: (value: IteratorResult<CodexAuthEvent>) => void =
    () => undefined;
  const next = new Promise<IteratorResult<CodexAuthEvent>>((resolve) => {
    resolveNext = resolve;
  });
  return {
    events: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => next,
        return: async () => {
          returned = true;
          return { done: true, value: undefined };
        },
      }),
    }),
    resolveNext,
    returned: () => returned,
  };
}
