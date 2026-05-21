import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexAuthEvent,
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

export interface CodexAuthDeleteResponse {
  status: "disabled";
  provider: "codex";
  logoutStatus: CodexLogoutResult["status"];
  message?: string;
}

export interface CodexAuthClient {
  cancelDeviceCodeLogin: (input: { loginId: string }) => Promise<void>;
  checkAuth: () => Promise<CodexAuthStatus>;
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

export async function readCodexAuthStatus(input: {
  client?: CodexAuthClient;
} = {}): Promise<CodexAuthStatusResponse> {
  const client = input.client ?? new CodexAppServerClient();
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
      return createPendingResponse(pendingLogin);
    }
    return mapAuthStatus(status);
  } catch (error) {
    return mapAuthError(error);
  }
}

export async function startCodexDeviceCodeLogin(input: {
  client?: CodexAuthClient;
} = {}): Promise<CodexDeviceCodeStartResponse> {
  const client = input.client ?? new CodexAppServerClient();
  const current = await readCodexAuthStatus({ client });
  if (current.status === "enabled" || current.status === "login_started") {
    return current;
  }

  try {
    const login = await client.startDeviceCodeLogin();
    pendingLogin = login;
    observePendingLogin(client, login.loginId);
    return createPendingResponse(login);
  } catch (error) {
    return {
      status: "failed",
      provider: "codex",
      loginId: null,
      error: safeErrorMessage(error),
    };
  }
}

export async function cancelCodexDeviceCodeLogin(input: {
  client?: CodexAuthClient;
} = {}): Promise<CodexDeviceCodeCancelResponse> {
  const current = pendingLogin;
  if (current === undefined) {
    return { status: "not_pending", provider: "codex" };
  }
  const client = input.client ?? new CodexAppServerClient();
  await client.cancelDeviceCodeLogin({ loginId: current.loginId });
  clearPendingLogin();
  return {
    status: "canceled",
    provider: "codex",
    loginId: current.loginId,
  };
}

export async function deleteCodexAuth(input: {
  client?: CodexAuthClient;
} = {}): Promise<CodexAuthDeleteResponse> {
  const client = input.client ?? new CodexAppServerClient();
  clearPendingLogin();
  const result = await client.logout();
  return {
    status: "disabled",
    provider: "codex",
    logoutStatus: result.status,
    ...(result.status === "unsupported" ? { message: result.message } : {}),
  };
}

export function resetCodexAuthForTests(): void {
  clearPendingLogin();
}

function observePendingLogin(client: CodexAuthClient, loginId: string): void {
  if (observingLoginId === loginId) {
    return;
  }
  observingLoginId = loginId;
  void (async () => {
    try {
      for await (const event of client.observeAuthEvents()) {
        if (pendingLogin?.loginId !== loginId) {
          break;
        }
        if (event.type === "auth.account.updated") {
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
    }
  })();
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
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
