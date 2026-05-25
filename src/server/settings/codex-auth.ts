import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexAuthEvent,
  type CodexAuthCheckOptions,
  type CodexAuthStatus,
  type CodexDeviceCodeLogin,
  type CodexLogoutResult,
} from "../translation/codex-app-server";

export type CodexAuthStatusResponse =
  | {
      status: "enabled";
      provider: "codex";
      message: string;
    }
  | {
      status: "login_started";
      provider: "codex";
      loginId: string;
      verificationUrl: string;
      userCode: string;
    }
  | {
      status: "setup_required" | "disabled" | "unknown";
      provider: "codex";
      reason: string;
    }
  | {
      status: "error";
      provider: "codex";
      error: string;
    };

export type CodexDeviceCodeStartResponse =
  | CodexAuthStatusResponse
  | {
      status: "failed";
      provider: "codex";
      loginId: string | null;
      error: string;
    };

export type CodexDeviceCodeCancelResponse =
  | {
      status: "canceled";
      provider: "codex";
      loginId: string;
    }
  | {
      status: "not_pending";
      provider: "codex";
    };

export type CodexAuthDeleteResponse =
  | {
      status: "disabled";
      provider: "codex";
      logoutStatus: "logged_out";
      message?: string;
    }
  | {
      status: "unsupported";
      provider: "codex";
      logoutStatus: "unsupported";
      message: string;
    };

export interface CodexAuthClient {
  cancelDeviceCodeLogin: (input: { loginId: string }) => Promise<void>;
  checkAuth: (input?: CodexAuthCheckOptions) => Promise<CodexAuthStatus>;
  close?: () => Promise<void> | void;
  logout: () => Promise<CodexLogoutResult>;
  observeAuthEvents: () => AsyncIterable<CodexAuthEvent>;
  startDeviceCodeLogin: () => Promise<CodexDeviceCodeLogin>;
}

interface PendingLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

let pendingLogin: PendingLogin | undefined;
let observingLoginId: string | undefined;
let stopPendingLoginObserver: (() => void) | undefined;

export async function readCodexAuthStatus(input: {
  createClient?: () => CodexAuthClient;
  client?: CodexAuthClient;
} = {}): Promise<CodexAuthStatusResponse> {
  const ownsClient = input.client === undefined;
  const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
  try {
    const status = await client.checkAuth();
    if (status.status === "enabled") {
      clearPendingLogin();
      return {
        status: "enabled",
        provider: "codex",
        message: "Codex ChatGPT sign-in is enabled.",
      };
    }
    if (pendingLogin !== undefined) {
      if (status.status !== "setup_required") {
        clearPendingLogin();
        return mapAuthStatus(status);
      }
      return createPendingResponse(pendingLogin);
    }
    return mapAuthStatus(status);
  } catch (error) {
    return mapAuthError(error);
  } finally {
    if (ownsClient) {
      await closeCodexAuthClient(client);
    }
  }
}

export async function startCodexDeviceCodeLogin(input: {
  createClient?: () => CodexAuthClient;
  client?: CodexAuthClient;
} = {}): Promise<CodexDeviceCodeStartResponse> {
  const ownsClient = input.client === undefined;
  const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
  const current = await readCodexAuthStatus({ client });
  if (current.status === "enabled" || current.status === "login_started") {
    if (ownsClient) {
      await closeCodexAuthClient(client);
    }
    return current;
  }

  try {
    const login = await client.startDeviceCodeLogin();
    pendingLogin = login;
    observePendingLogin(client, login.loginId, { closeWhenDone: ownsClient });
    return createPendingResponse(login);
  } catch (error) {
    if (ownsClient) {
      await closeCodexAuthClient(client);
    }
    return {
      status: "failed",
      provider: "codex",
      loginId: null,
      error: safeErrorMessage(error),
    };
  }
}

export async function cancelCodexDeviceCodeLogin(input: {
  createClient?: () => CodexAuthClient;
  client?: CodexAuthClient;
} = {}): Promise<CodexDeviceCodeCancelResponse> {
  const current = pendingLogin;
  if (current === undefined) {
    return { status: "not_pending", provider: "codex" };
  }
  const ownsClient = input.client === undefined;
  const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
  try {
    await client.cancelDeviceCodeLogin({ loginId: current.loginId });
    clearPendingLogin();
    return {
      status: "canceled",
      provider: "codex",
      loginId: current.loginId,
    };
  } finally {
    if (ownsClient) {
      await closeCodexAuthClient(client);
    }
  }
}

export async function deleteCodexAuth(input: {
  createClient?: () => CodexAuthClient;
  client?: CodexAuthClient;
} = {}): Promise<CodexAuthDeleteResponse> {
  const ownsClient = input.client === undefined;
  const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
  try {
    clearPendingLogin();
    const result = await client.logout();
    if (result.status === "unsupported") {
      return {
        status: "unsupported",
        provider: "codex",
        logoutStatus: "unsupported",
        message: result.message,
      };
    }
    return {
      status: "disabled",
      provider: "codex",
      logoutStatus: "logged_out",
    };
  } finally {
    if (ownsClient) {
      await closeCodexAuthClient(client);
    }
  }
}

export function resetCodexAuthForTests(): void {
  clearPendingLogin();
}

function observePendingLogin(
  client: CodexAuthClient,
  loginId: string,
  options: { closeWhenDone: boolean },
): void {
  if (observingLoginId === loginId) {
    return;
  }
  observingLoginId = loginId;
  void (async () => {
    const iterator = client.observeAuthEvents()[Symbol.asyncIterator]();
    stopPendingLoginObserver = () => {
      void iterator.return?.();
    };
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done === true) {
          break;
        }
        const event = next.value;
        if (pendingLogin?.loginId !== loginId) {
          break;
        }
        if (event.type === "account.updated") {
          const status = await client.checkAuth();
          if (status.status === "enabled") {
            clearPendingLogin();
            break;
          }
          continue;
        }
        if (event.loginId !== null && event.loginId !== loginId) {
          continue;
        }
        if (!event.success) {
          clearPendingLogin();
          break;
        }
        const status = await client.checkAuth();
        if (status.status === "enabled") {
          clearPendingLogin();
          break;
        }
      }
    } finally {
      if (observingLoginId === loginId) {
        observingLoginId = undefined;
      }
      if (stopPendingLoginObserver !== undefined) {
        stopPendingLoginObserver = undefined;
      }
      if (options.closeWhenDone) {
        await closeCodexAuthClient(client);
      }
    }
  })();
}

async function closeCodexAuthClient(client: CodexAuthClient): Promise<void> {
  try {
    await client.close?.();
  } catch {
    // Closing a transient settings client must not hide the auth result.
  }
}

function mapAuthStatus(status: CodexAuthStatus): CodexAuthStatusResponse {
  switch (status.status) {
    case "enabled":
      return {
        status: "enabled",
        provider: "codex",
        message: "Codex ChatGPT sign-in is enabled.",
      };
    case "setup_required":
    case "disabled":
    case "unknown":
      return {
        status: status.status,
        provider: "codex",
        reason: status.reason,
      };
    case "error":
      return {
        status: "error",
        provider: "codex",
        error: status.error,
      };
  }
}

function mapAuthError(error: unknown): CodexAuthStatusResponse {
  if (error instanceof CodexAppServerError) {
    if (error.code === "setup_required" || error.code === "app_server_unavailable") {
      return {
        status: "setup_required",
        provider: "codex",
        reason: "codex_app_server_unavailable",
      };
    }
    if (error.code === "auth_required") {
      return {
        status: "setup_required",
        provider: "codex",
        reason: "auth_required",
      };
    }
  }
  return {
    status: "error",
    provider: "codex",
    error: safeErrorMessage(error),
  };
}

function createPendingResponse(login: PendingLogin): Extract<
  CodexAuthStatusResponse,
  { status: "login_started" }
> {
  return {
    status: "login_started",
    provider: "codex",
    loginId: login.loginId,
    verificationUrl: login.verificationUrl,
    userCode: login.userCode,
  };
}

function clearPendingLogin(): void {
  pendingLogin = undefined;
  stopPendingLoginObserver?.();
  stopPendingLoginObserver = undefined;
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
