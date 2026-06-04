import { randomBytes, createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

import {
  isCodexReasoningEffort,
  type TranslationChunk,
  type RawCodexChunkOutput,
  type CodexReasoningEffort,
} from "./types";

export type CodexAppServerTransportKind = "unix_socket";

export interface CodexAppServerEndpoint {
  kind: CodexAppServerTransportKind;
  raw: string;
  socketPath?: string;
}

export type CodexAppServerEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; turnId: string }
  | { type: "delta"; text: string }
  | { type: "process"; message: string }
  | { type: "item.started"; itemId: string | null }
  | { type: "item.completed"; itemId: string | null };

export type CodexAuthStatus =
  | { status: "enabled" }
  | { status: "setup_required"; reason: string }
  | { status: "disabled"; reason: string }
  | { status: "unknown"; reason: string }
  | { status: "error"; error: string };

export interface CodexDeviceCodeLogin {
  loginId: string;
  userCode: string;
  verificationUrl: string;
}

export type CodexAuthEvent =
  | {
      type: "account.login.completed";
      loginId: string | null;
      success: boolean;
      error: string | null;
    }
  | { type: "account.updated" };

export interface CodexAuthCheckOptions {
  refreshToken?: boolean;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: CodexReasoningEffort[];
}

export interface CodexModelCatalog {
  models: CodexModelInfo[];
}

export type CodexLogoutResult =
  | { status: "logged_out" }
  | { status: "unsupported"; message: string };

export interface TranslateChunkInput {
  chunk: TranslationChunk;
  model?: string | null;
  onEvent?: (event: CodexAppServerEvent) => void;
  outputSchema?: unknown;
  prompt: string;
  reasoningEffort?: CodexReasoningEffort | null;
}

export interface TranslationClient {
  cancelTurn?: (input: { threadId: string; turnId: string }) => Promise<void>;
  close?: () => Promise<void> | void;
  listModels?: () => Promise<CodexModelCatalog>;
  probe: () => Promise<void>;
  translateChunk: (input: TranslateChunkInput) => Promise<RawCodexChunkOutput>;
}

export interface CodexConversationTurnInput {
  cwdPurpose: "translation" | "psychiatrist";
  input: string;
  model?: string | null;
  networkAccess?: "disabled" | "user_approved_web_sources";
  onEvent?: (event: CodexAppServerEvent) => void;
  reasoningEffort?: CodexReasoningEffort | null;
  sandboxPolicy?: CodexSandboxPolicy;
  threadId?: string;
}

export interface CodexConversationTurnResult {
  outputText: string;
  sourceCitations?: Array<{ sourceId: string; title: string; url: string }>;
  threadId: string;
  turnId: string;
  webSourceRequired?: boolean;
}

export interface CodexConversationClient {
  cancelTurn(input: { threadId: string; turnId: string }): Promise<void>;
  close?: () => Promise<void> | void;
  probe(): Promise<void>;
  runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult>;
}

export interface CodexSandboxPolicy {
  type: "readOnly";
  networkAccess: boolean;
}

interface WireMessage {
  id?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface PendingRequest {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS = 120_000;

export function parseCodexAppServerEndpoint(
  raw = process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT ?? "unix://",
): CodexAppServerEndpoint {
  const endpoint = raw.trim();
  if (endpoint === "" || endpoint === "stdio" || endpoint.startsWith("stdio://")) {
    throw new CodexAppServerError(
      "setup_required",
      "Configure TRAUMA_CODEX_APP_SERVER_ENDPOINT with a Codex app-server Unix socket endpoint.",
    );
  }
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    throw new CodexAppServerError(
      "setup_required",
      "HTTP endpoints are not Codex app-server wire transports.",
    );
  }
  if (endpoint === "unix://") {
    return {
      kind: "unix_socket",
      raw: endpoint,
      socketPath:
        process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH ??
        join(homedir(), ".codex/app-server-control/app-server-control.sock"),
    };
  }
  if (endpoint.startsWith("unix://")) {
    const socketPath = endpoint.slice("unix://".length);
    if (socketPath.trim() === "") {
      throw new CodexAppServerError(
        "setup_required",
        "Unix Codex app-server endpoint must include a socket path.",
      );
    }
    return {
      kind: "unix_socket",
      raw: endpoint,
      socketPath,
    };
  }
  throw new CodexAppServerError(
    "setup_required",
    "Unsupported Codex app-server endpoint.",
  );
}

export class CodexAppServerClient implements TranslationClient, CodexConversationClient {
  private initialized = false;
  private connectionClosed = false;
  private readonly closeListeners = new Set<(error: CodexAppServerError) => void>();
  private readonly notificationListeners = new Set<(message: WireMessage) => void>();
  private outputSchemaMode: "structured" | "prompt_only" | undefined;
  private requestId = 1;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private connection: CodexWireConnection | undefined;

  constructor(
    private readonly endpoint: CodexAppServerEndpoint =
      parseCodexAppServerEndpoint(),
  ) {}

  async probe(): Promise<void> {
    const status = await this.checkAuth({ refreshToken: true });
    if (status.status !== "enabled") {
      throw new CodexAppServerError(
        status.status === "setup_required" || status.status === "disabled"
          ? "auth_required"
          : "app_server_unavailable",
        "Codex app-server requires OpenAI authentication.",
      );
    }
  }

  async checkAuth(input: CodexAuthCheckOptions = {}): Promise<CodexAuthStatus> {
    await this.ensureInitialized();
    const account = await this.request("account/read", {
      refreshToken: input.refreshToken === true,
    });
    if (!isRecord(account)) {
      return { status: "unknown", reason: "invalid_account_response" };
    }
    if (
      isRecord(account.account) ||
      account.authenticated === true ||
      account.isAuthenticated === true
    ) {
      return { status: "enabled" };
    }
    if (account.requiresOpenaiAuth === true) {
      return { status: "setup_required", reason: "auth_required" };
    }
    if (account.requiresOpenaiAuth === false) {
      return { status: "enabled" };
    }
    return { status: "unknown", reason: "unrecognized_account_state" };
  }

  async startDeviceCodeLogin(): Promise<CodexDeviceCodeLogin> {
    await this.ensureInitialized();
    const result = await this.request("account/login/start", {
      type: "chatgptDeviceCode",
    });
    const login = readDeviceCodeLogin(result);
    if (login === undefined) {
      throw new CodexAppServerError(
        "app_server_unavailable",
        "Codex app-server did not return device-code login metadata.",
      );
    }
    return login;
  }

  async listModels(): Promise<CodexModelCatalog> {
    await this.ensureInitialized();
    const response = await this.request("model/list", {
      includeHidden: false,
    });
    return readCodexModelCatalog(response);
  }

  observeAuthEvents(): AsyncIterable<CodexAuthEvent> {
    const queue: CodexAuthEvent[] = [];
    let closed = false;
    let unsubscribeClose: () => void = () => undefined;
    let unsubscribeNotifications: () => void = () => undefined;
    const pendingResolvers: Array<
      (result: IteratorResult<CodexAuthEvent>) => void
    > = [];
    const flushPending = () => {
      while (pendingResolvers.length > 0) {
        const resolve = pendingResolvers.shift();
        if (resolve === undefined) {
          return;
        }
        const event = queue.shift();
        if (event === undefined) {
          if (closed) {
            resolve({ done: true, value: undefined });
          } else {
            pendingResolvers.unshift(resolve);
          }
          return;
        }
        resolve({ done: false, value: event });
      }
    };
    unsubscribeClose = this.subscribeClose(() => close());
    unsubscribeNotifications = this.subscribeNotification((message) => {
      const event = readCodexAuthEvent(message);
      if (closed || event === undefined) {
        return;
      }
      queue.push(event);
      flushPending();
    });
    const close = () => {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribeClose();
      unsubscribeNotifications();
      flushPending();
    };
    return {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<CodexAuthEvent>> => {
          if (closed) {
            return { done: true, value: undefined };
          }
          const event = queue.shift();
          if (event !== undefined) {
            return { done: false, value: event };
          }
          return new Promise<IteratorResult<CodexAuthEvent>>((resolve) => {
            pendingResolvers.push(resolve);
          });
        },
        return: async (): Promise<IteratorResult<CodexAuthEvent>> => {
          close();
          return { done: true, value: undefined };
        },
      }),
    };
  }

  async cancelDeviceCodeLogin(input: { loginId: string }): Promise<void> {
    await this.ensureInitialized();
    await this.request("account/login/cancel", { loginId: input.loginId });
  }

  async logout(): Promise<CodexLogoutResult> {
    await this.ensureInitialized();
    try {
      await this.request("account/logout", {});
      return { status: "logged_out" };
    } catch (error) {
      if (
        error instanceof CodexAppServerError &&
        error.code === "app_server_protocol_error" &&
        error.message.toLowerCase().includes("method")
      ) {
        return {
          status: "unsupported",
          message: "Codex app-server does not support account/logout.",
        };
      }
      throw error;
    }
  }

  async translateChunk(
    input: TranslateChunkInput,
  ): Promise<RawCodexChunkOutput> {
    await this.probe();
    const shouldTryStructured =
      input.outputSchema !== undefined && this.outputSchemaMode !== "prompt_only";
    if (!shouldTryStructured) {
      return this.translateChunkAttempt(input, { includeOutputSchema: false });
    }
    try {
      const output = await this.translateChunkAttempt(input, {
        includeOutputSchema: true,
      });
      this.outputSchemaMode = "structured";
      return output;
    } catch (error) {
      if (!isOutputSchemaUnsupportedError(error)) {
        throw error;
      }
      this.outputSchemaMode = "prompt_only";
      return this.translateChunkAttempt(input, { includeOutputSchema: false });
    }
  }

  async runConversationTurn(
    input: CodexConversationTurnInput,
  ): Promise<CodexConversationTurnResult> {
    await this.probe();
    const runtimeCwd = input.threadId === undefined
      ? await createRuntimeCwd(`${input.cwdPurpose}-${randomBytes(8).toString("hex")}`)
      : undefined;
    try {
      const threadId = input.threadId ?? await this.startEphemeralThread({
        cwd: runtimeCwd!,
        onEvent: input.onEvent,
      });

      let turnId: string | undefined;
      const completed = this.waitForTextTurnCompletion({
        onEvent: input.onEvent,
        threadId,
        turnId: () => turnId,
      });
      let turn: unknown;
      const networkAccess = input.networkAccess === "user_approved_web_sources";
      const turnStartParams = {
        threadId,
        input: [{ type: "text", text: input.input, text_elements: [] }],
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        sandboxPolicy: input.sandboxPolicy ?? {
          type: "readOnly",
          networkAccess,
        },
        ...(input.model === undefined || input.model === null
          ? {}
          : { model: input.model }),
        ...(input.reasoningEffort === undefined || input.reasoningEffort === null
          ? {}
          : { effort: input.reasoningEffort }),
      };
      try {
        turn = await this.request("turn/start", turnStartParams);
      } catch (error) {
        completed.unsubscribe();
        throw error;
      }
      turnId = readTurnStartResponseTurnId(turn);
      if (turnId !== undefined) {
        input.onEvent?.({ type: "turn.started", turnId });
      }
      const immediateOutput = readFinalTextTurnOutput(turn);
      if (immediateOutput !== undefined && turnId !== undefined) {
        completed.unsubscribe();
        return { ...immediateOutput, threadId, turnId };
      }

      try {
        const completedOutput = await completed.output;
        return {
          outputText: completedOutput.outputText,
          ...(completedOutput.sourceCitations === undefined
            ? {}
            : { sourceCitations: completedOutput.sourceCitations }),
          threadId,
          turnId: completedOutput.turnId,
        };
      } finally {
        completed.unsubscribe();
      }
    } finally {
      if (runtimeCwd !== undefined) {
        await removeRuntimeCwd(runtimeCwd);
      }
    }
  }

  private async startEphemeralThread(input: {
    cwd: string;
    onEvent?: (event: CodexAppServerEvent) => void;
  }): Promise<string> {
    const thread = await this.request("thread/start", {
      cwd: input.cwd,
      ephemeral: true,
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
      sandbox: "read-only",
      threadSource: "user",
    });
    const threadId = readThreadStartResponseThreadId(thread);
    if (threadId === undefined) {
      throw new CodexAppServerError(
        "app_server_unavailable",
        "Codex app-server did not return a thread id.",
      );
    }
    input.onEvent?.({ type: "thread.started", threadId });
    return threadId;
  }

  private async translateChunkAttempt(
    input: TranslateChunkInput,
    options: { includeOutputSchema: boolean },
  ): Promise<RawCodexChunkOutput> {
    const runtimeCwd = await createRuntimeCwd(input.chunk.jobId);
    try {
      const thread = await this.request("thread/start", {
        cwd: runtimeCwd,
        ephemeral: true,
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        sandbox: "read-only",
        threadSource: "user",
      });
      const threadId = readThreadStartResponseThreadId(thread);
      if (threadId === undefined) {
        throw new CodexAppServerError(
          "app_server_unavailable",
          "Codex app-server did not return a thread id.",
        );
      }
      input.onEvent?.({ type: "thread.started", threadId });

      let turnId: string | undefined;
      const completed = this.waitForTurnCompletion({
        onEvent: input.onEvent,
        threadId,
        turnId: () => turnId,
      });
      let turn: unknown;
      const turnStartParams = {
        threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        ...(input.model === undefined || input.model === null
          ? {}
          : { model: input.model }),
        ...(input.reasoningEffort === undefined || input.reasoningEffort === null
          ? {}
          : { effort: input.reasoningEffort }),
        ...(options.includeOutputSchema && input.outputSchema !== undefined
          ? { outputSchema: input.outputSchema }
          : {}),
      };
      try {
        turn = await this.request("turn/start", turnStartParams);
      } catch (error) {
        completed.unsubscribe();
        throw error;
      }
      turnId = readTurnStartResponseTurnId(turn);
      if (turnId !== undefined) {
        input.onEvent?.({ type: "turn.started", turnId });
      }
      const immediateOutput = readFinalOutput(turn);
      if (immediateOutput !== undefined) {
        completed.unsubscribe();
        return immediateOutput;
      }

      try {
        return await completed.output;
      } finally {
        completed.unsubscribe();
      }
    } finally {
      await removeRuntimeCwd(runtimeCwd);
    }
  }

  async cancelTurn(input: { threadId: string; turnId: string }): Promise<void> {
    await this.ensureInitialized();
    await this.request("turn/interrupt", {
      threadId: input.threadId,
      turnId: input.turnId,
    });
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.handleConnectionClosed(
      new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server connection closed.",
      ),
    );
    connection?.close();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.connectionClosed) {
      throw new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server connection is closed.",
      );
    }
    if (this.initialized) {
      return;
    }
    this.connection = await openCodexWireConnection(
      this.endpoint,
      (message) => this.handleMessage(message),
      (error) => this.handleConnectionClosed(error),
    );
    await this.request("initialize", {
      clientInfo: {
        name: "TRAUMA Brilliant",
        version: "0.2.0",
      },
      capabilities: null,
    });
    this.connection.send({ method: "initialized" });
    this.initialized = true;
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.connection === undefined) {
      throw new CodexAppServerError(
        "app_server_unavailable",
        "Codex app-server is not connected.",
      );
    }
    if (this.connectionClosed) {
      throw new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server connection is closed.",
      );
    }
    const id = String(this.requestId);
    this.requestId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new CodexAppServerError(
            "timeout",
            `Codex app-server request ${method} timed out.`,
          ),
        );
      }, readRequestTimeoutMs());
      this.pendingRequests.set(id, { resolve, reject, timeout });
    });
    this.connection.send({ id, method, params });
    return promise;
  }

  private handleMessage(message: WireMessage): void {
    if (message.id === undefined) {
      for (const listener of this.notificationListeners) {
        listener(message);
      }
      return;
    }
    const pending = this.pendingRequests.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error !== undefined) {
      pending.reject(createCodexWireError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  private subscribeNotification(
    listener: (message: WireMessage) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  private subscribeClose(
    listener: (error: CodexAppServerError) => void,
  ): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  private handleConnectionClosed(error: CodexAppServerError): void {
    if (this.connectionClosed) {
      return;
    }
    this.connectionClosed = true;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    for (const listener of this.closeListeners) {
      listener(error);
    }
  }

  private waitForTurnCompletion(input: {
    onEvent?: (event: CodexAppServerEvent) => void;
    threadId: string;
    turnId: () => string | undefined;
  }): { output: Promise<RawCodexChunkOutput>; unsubscribe: () => void } {
    let unsubscribe: () => void = () => undefined;
    let unsubscribeClose: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const output = new Promise<RawCodexChunkOutput>((resolve, reject) => {
      let settled = false;
      const settleResolve = (value: RawCodexChunkOutput) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        resolve(value);
      };
      const settleReject = (error: CodexAppServerError) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        reject(error);
      };
      timeout = setTimeout(() => {
        settleReject(
          new CodexAppServerError(
            "timeout",
            "Codex app-server turn timed out.",
          ),
        );
      }, readRequestTimeoutMs());
      unsubscribeClose = this.subscribeClose((error) => {
        settleReject(error);
      });
      unsubscribe = this.subscribeNotification((message) => {
        if (message.method === "turn/started") {
          const startedTurnId = readNotificationTurnId(message.params);
          if (
            readNotificationThreadId(message.params) === input.threadId &&
            startedTurnId !== undefined
          ) {
            input.onEvent?.({ type: "turn.started", turnId: startedTurnId });
          }
          return;
        }
        if (message.method === "item/agentMessage/delta") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const delta = readStringField(message.params, "delta");
          if (delta !== undefined) {
            input.onEvent?.({ type: "delta", text: delta });
          }
          return;
        }
        if (message.method === "item/started") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          input.onEvent?.({
            itemId: readNotificationItemId(message.params) ?? null,
            type: "item.started",
          });
          return;
        }
        if (message.method === "item/completed") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          input.onEvent?.({
            itemId: readNotificationItemId(message.params) ?? null,
            type: "item.completed",
          });
          const itemOutput = readFinalOutput(message.params);
          if (itemOutput !== undefined) {
            settleResolve(itemOutput);
          }
          return;
        }
        if (message.method === "turn/completed") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const finalOutput = readFinalOutput(message.params);
          if (finalOutput === undefined) {
            if (isTurnInterruptedCompletion(message.params)) {
              settleReject(
                new CodexAppServerError(
                  "turn_interrupted",
                  "Codex app-server turn was interrupted.",
                ),
              );
              return;
            }
            settleReject(
              new CodexAppServerError(
                "invalid_final_output",
                "Codex app-server did not return a final translation payload.",
              ),
            );
            return;
          }
          settleResolve(finalOutput);
        }
      });
    });
    return {
      output,
      unsubscribe: () => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        unsubscribe();
        unsubscribeClose();
      },
    };
  }

  private waitForTextTurnCompletion(input: {
    onEvent?: (event: CodexAppServerEvent) => void;
    threadId: string;
    turnId: () => string | undefined;
  }): {
    output: Promise<{
      outputText: string;
      sourceCitations?: Array<{ sourceId: string; title: string; url: string }>;
      turnId: string;
    }>;
    unsubscribe: () => void;
  } {
    let unsubscribe: () => void = () => undefined;
    let unsubscribeClose: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const output = new Promise<{
      outputText: string;
      sourceCitations?: Array<{ sourceId: string; title: string; url: string }>;
      turnId: string;
    }>((resolve, reject) => {
      let settled = false;
      const settleResolve = (value: {
        outputText: string;
        sourceCitations?: Array<{ sourceId: string; title: string; url: string }>;
        turnId: string;
      }) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        resolve(value);
      };
      const settleReject = (error: CodexAppServerError) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        reject(error);
      };
      timeout = setTimeout(() => {
        settleReject(
          new CodexAppServerError(
            "timeout",
            "Codex app-server turn timed out.",
          ),
        );
      }, readRequestTimeoutMs());
      unsubscribeClose = this.subscribeClose((error) => {
        settleReject(error);
      });
      unsubscribe = this.subscribeNotification((message) => {
        if (message.method === "turn/started") {
          const startedTurnId = readNotificationTurnId(message.params);
          if (
            readNotificationThreadId(message.params) === input.threadId &&
            startedTurnId !== undefined
          ) {
            input.onEvent?.({ type: "turn.started", turnId: startedTurnId });
          }
          return;
        }
        if (message.method === "item/agentMessage/delta") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const delta = readStringField(message.params, "delta");
          if (delta !== undefined) {
            input.onEvent?.({ type: "delta", text: delta });
          }
          return;
        }
        if (message.method === "item/process") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const processMessage = readSafeProcessMessage(message.params);
          if (processMessage !== undefined) {
            input.onEvent?.({ message: processMessage, type: "process" });
          }
          return;
        }
        if (message.method === "item/reasoning" || message.method === "raw/event") {
          return;
        }
        if (message.method === "item/started") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          input.onEvent?.({
            itemId: readNotificationItemId(message.params) ?? null,
            type: "item.started",
          });
          return;
        }
        if (message.method === "item/completed") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          input.onEvent?.({
            itemId: readNotificationItemId(message.params) ?? null,
            type: "item.completed",
          });
          const itemOutput = readFinalTextTurnOutput(message.params);
          const turnId = readNotificationTurnId(message.params) ?? input.turnId();
          if (itemOutput !== undefined && turnId !== undefined) {
            settleResolve({ ...itemOutput, turnId });
          }
          return;
        }
        if (message.method === "turn/completed") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const finalOutput = readFinalTextTurnOutput(message.params);
          const turnId = readNotificationTurnId(message.params) ?? input.turnId();
          if (finalOutput === undefined || turnId === undefined) {
            if (isTurnInterruptedCompletion(message.params)) {
              settleReject(
                new CodexAppServerError(
                  "turn_interrupted",
                  "Codex app-server turn was interrupted.",
                ),
              );
              return;
            }
            settleReject(
              new CodexAppServerError(
                "invalid_final_output",
                "Codex app-server did not return a final conversation response.",
              ),
            );
            return;
          }
          settleResolve({ ...finalOutput, turnId });
        }
      });
    });
    return {
      output,
      unsubscribe: () => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        unsubscribe();
        unsubscribeClose();
      },
    };
  }
}

interface CodexWireConnection {
  close: () => void;
  send: (message: WireMessage) => void;
}

async function openCodexWireConnection(
  endpoint: CodexAppServerEndpoint,
  onMessage: (message: WireMessage) => void,
  onClose: (error: CodexAppServerError) => void,
): Promise<CodexWireConnection> {
  return openUnixWebSocketConnection(endpoint, onMessage, onClose);
}

async function openUnixWebSocketConnection(
  endpoint: CodexAppServerEndpoint,
  onMessage: (message: WireMessage) => void,
  onClose: (error: CodexAppServerError) => void,
): Promise<CodexWireConnection> {
  if (endpoint.socketPath === undefined) {
    throw new CodexAppServerError("setup_required", "Missing Unix socket path.");
  }
  const socket = net.createConnection(endpoint.socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", () => {
      reject(
        new CodexAppServerError(
          "app_server_unavailable",
          "Cannot connect to Codex app-server Unix socket.",
        ),
      );
    });
  });

  let streamClosed = false;
  const closeWith = (error: CodexAppServerError) => {
    if (streamClosed) {
      return;
    }
    streamClosed = true;
    onClose(error);
  };
  const decoder = new WebSocketFrameDecoder(
    (text) => onMessage(parseWireMessage(text)),
    (payload) => {
      socket.write(encodeClientWebSocketPongFrame(payload));
    },
    (payload) => {
      closeWith(
        new CodexAppServerError(
          "stream_disconnected",
          "Codex app-server WebSocket stream closed.",
        ),
      );
      if (!socket.destroyed) {
        socket.write(encodeClientWebSocketCloseFrame(payload), () => {
          socket.end();
        });
      }
    },
  );
  const pushFrameData = (chunk: Buffer) => {
    try {
      decoder.push(chunk);
    } catch (error) {
      closeWith(toCodexWireProtocolError(error));
      socket.destroy();
    }
  };
  const key = randomBytes(16).toString("base64");
  const upgraded = waitForWebSocketUpgrade(socket, key, pushFrameData);
  socket.write([
    "GET / HTTP/1.1",
    "Host: localhost",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n"));

  await upgraded;
  socket.resume();
  socket.on("error", () => {
    closeWith(
      new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server Unix socket stream failed.",
      ),
    );
  });
  socket.on("end", () => {
    closeWith(
      new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server Unix socket stream closed.",
      ),
    );
  });
  socket.on("close", () => {
    closeWith(
      new CodexAppServerError(
        "stream_disconnected",
        "Codex app-server Unix socket stream closed.",
      ),
    );
  });

  return {
    close: () => socket.destroy(),
    send: (message) => socket.write(encodeClientWebSocketTextFrame(JSON.stringify(message))),
  };
}

function waitForWebSocketUpgrade(
  socket: net.Socket,
  key: string,
  onFrameData: (chunk: Buffer) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const cleanup = (keepDataListener: boolean) => {
      if (!keepDataListener) {
        socket.off("data", onData);
      }
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("end", onClose);
    };
    const settleResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(true);
      socket.resume();
      resolve();
    };
    const settleReject = (error: CodexAppServerError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(false);
      socket.destroy();
      reject(error);
    };
    const onError = () => {
      settleReject(
        new CodexAppServerError(
          "app_server_unavailable",
          "Codex app-server Unix socket failed during WebSocket upgrade.",
        ),
      );
    };
    const onClose = () => {
      settleReject(
        new CodexAppServerError(
          "app_server_unavailable",
          "Codex app-server Unix socket closed during WebSocket upgrade.",
        ),
      );
    };
    const onData = (chunk: Buffer) => {
      if (settled) {
        onFrameData(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      const header = buffer.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.1 101\b/i.test(header)) {
        settleReject(
          new CodexAppServerError(
            "app_server_unavailable",
            "Codex app-server did not accept WebSocket upgrade.",
          ),
        );
        return;
      }
      const expectedAccept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      if (!header.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
        settleReject(
          new CodexAppServerError(
            "app_server_unavailable",
            "Codex app-server WebSocket accept key did not match.",
          ),
        );
        return;
      }
      const remaining = buffer.slice(headerEnd + 4);
      if (remaining.length > 0) {
        onFrameData(remaining);
      }
      settleResolve();
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.once("end", onClose);
  });
}

function encodeClientWebSocketTextFrame(text: string): Buffer {
  return encodeClientWebSocketFrame(0x1, Buffer.from(text, "utf8"));
}

function encodeClientWebSocketPongFrame(payload: Buffer): Buffer {
  return encodeClientWebSocketFrame(0x0a, payload);
}

function encodeClientWebSocketCloseFrame(payload: Buffer): Buffer {
  return encodeClientWebSocketFrame(0x08, payload);
}

function encodeClientWebSocketFrame(opcode: number, payload: Buffer): Buffer {
  const header: number[] = [0x80 | opcode];
  if (payload.length < 126) {
    header.push(0x80 | payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    header.push(0x80 | 127, 0, 0, 0, 0);
    const length = BigInt(payload.length);
    for (let shift = 24; shift >= 0; shift -= 8) {
      header.push(Number((length >> BigInt(shift)) & BigInt(0xff)));
    }
  }
  const mask = randomBytes(4);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
  }
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

class WebSocketFrameDecoder {
  private buffer = Buffer.alloc(0);
  private fragmentedText: Buffer[] | undefined;

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onPing: (payload: Buffer) => void = () => undefined,
    private readonly onClose: (payload: Buffer) => void = () => undefined,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0] ?? 0;
      const second = this.buffer[1] ?? 0;
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      let offset = 2;
      let length = second & 0x7f;
      if (length === 126) {
        if (this.buffer.length < offset + 2) {
          return;
        }
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) {
          return;
        }
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new CodexAppServerError("app_server_unavailable", "Frame too large.");
        }
        length = Number(bigLength);
        offset += 8;
      }
      const masked = (second & 0x80) !== 0;
      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) {
        return;
      }
      const mask = masked ? this.buffer.slice(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = this.buffer.slice(offset, offset + length);
      this.buffer = this.buffer.slice(offset + length);
      if (opcode === 0x9) {
        this.onPing(Buffer.from(payload));
        continue;
      }
      if (opcode === 0x8) {
        this.fragmentedText = undefined;
        this.onClose(Buffer.from(payload));
        return;
      }
      if (opcode !== 0x1 && opcode !== 0x0) {
        continue;
      }
      if (mask !== undefined) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      if (opcode === 0x1 && fin) {
        this.onText(payload.toString("utf8"));
        continue;
      }
      if (opcode === 0x1) {
        this.fragmentedText = [Buffer.from(payload)];
        continue;
      }
      if (this.fragmentedText === undefined) {
        throw new CodexAppServerError(
          "app_server_protocol_error",
          "Codex app-server sent an unexpected WebSocket continuation frame.",
        );
      }
      this.fragmentedText.push(Buffer.from(payload));
      if (fin) {
        const text = Buffer.concat(this.fragmentedText).toString("utf8");
        this.fragmentedText = undefined;
        this.onText(text);
      }
    }
  }
}

async function createRuntimeCwd(jobId: string): Promise<string> {
  const root = process.env.TRAUMA_CODEX_RUNTIME_DIR ??
    join(tmpdir(), "trauma-codex-runtime");
  const cwd = join(root, jobId);
  await mkdir(cwd, { recursive: true });
  return cwd;
}

async function removeRuntimeCwd(cwd: string): Promise<void> {
  try {
    await rm(cwd, { recursive: true, force: true });
  } catch (error) {
    console.warn("failed to remove Codex runtime cwd", error);
  }
}

function parseWireMessage(value: string): WireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CodexAppServerError(
      "app_server_protocol_error",
      "Codex app-server sent invalid JSON.",
    );
  }
  if (!isRecord(parsed)) {
    throw new CodexAppServerError(
      "app_server_protocol_error",
      "Codex app-server sent an invalid wire payload.",
    );
  }
  return parsed;
}

function readFinalOutput(value: unknown): RawCodexChunkOutput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const output = value.output ?? value.finalOutput ?? value.structuredOutput;
  if (isRecord(output) && Array.isArray(output.segments)) {
    return output as unknown as RawCodexChunkOutput;
  }
  if (isRecord(value.turn)) {
    const turnOutput = readFinalOutput(value.turn);
    if (turnOutput !== undefined) {
      return turnOutput;
    }
  }
  if (isRecord(value.item)) {
    const itemOutput = readFinalOutput(value.item);
    if (itemOutput !== undefined) {
      return itemOutput;
    }
  }
  if (Array.isArray(value.items)) {
    for (let index = value.items.length - 1; index >= 0; index -= 1) {
      const itemOutput = readFinalOutput(value.items[index]);
      if (itemOutput !== undefined) {
        return itemOutput;
      }
    }
  }
  if (value.type === "agentMessage" && typeof value.text === "string") {
    return parseCodexJsonOutput(value.text);
  }
  return undefined;
}

function readFinalTextOutput(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const output = value.output ?? value.finalOutput ?? value.text;
  if (typeof output === "string") {
    return output;
  }
  if (isRecord(output)) {
    const text = readStringField(output, "text") ??
      readStringField(output, "outputText") ??
      readStringField(output, "content");
    if (text !== undefined) {
      return text;
    }
  }
  if (isRecord(value.turn)) {
    const turnOutput = readFinalTextOutput(value.turn);
    if (turnOutput !== undefined) {
      return turnOutput;
    }
  }
  if (isRecord(value.item)) {
    const itemOutput = readFinalTextOutput(value.item);
    if (itemOutput !== undefined) {
      return itemOutput;
    }
  }
  if (Array.isArray(value.items)) {
    for (let index = value.items.length - 1; index >= 0; index -= 1) {
      const itemOutput = readFinalTextOutput(value.items[index]);
      if (itemOutput !== undefined) {
        return itemOutput;
      }
    }
  }
  if (value.type === "agentMessage" && typeof value.text === "string") {
    return value.text;
  }
  return undefined;
}

function readFinalTextTurnOutput(value: unknown): {
  outputText: string;
  sourceCitations?: Array<{ sourceId: string; title: string; url: string }>;
} | undefined {
  const outputText = readFinalTextOutput(value);
  if (outputText === undefined) {
    return undefined;
  }
  const sourceCitations = readSourceCitations(value);
  return {
    outputText,
    ...(sourceCitations.length === 0 ? {} : { sourceCitations }),
  };
}

function readSourceCitations(value: unknown): Array<{ sourceId: string; title: string; url: string }> {
  if (!isRecord(value)) {
    return [];
  }
  const direct = readCitationArray(value.sourceCitations) ??
    readCitationArray(value.source_citations) ??
    readCitationArray(value.citations);
  if (direct !== undefined) {
    return direct;
  }
  if (isRecord(value.output)) {
    const output = readSourceCitations(value.output);
    if (output.length > 0) {
      return output;
    }
  }
  if (isRecord(value.finalOutput)) {
    const finalOutput = readSourceCitations(value.finalOutput);
    if (finalOutput.length > 0) {
      return finalOutput;
    }
  }
  if (isRecord(value.turn)) {
    const turnOutput = readSourceCitations(value.turn);
    if (turnOutput.length > 0) {
      return turnOutput;
    }
  }
  if (isRecord(value.item)) {
    const itemOutput = readSourceCitations(value.item);
    if (itemOutput.length > 0) {
      return itemOutput;
    }
  }
  if (Array.isArray(value.items)) {
    for (let index = value.items.length - 1; index >= 0; index -= 1) {
      const itemOutput = readSourceCitations(value.items[index]);
      if (itemOutput.length > 0) {
        return itemOutput;
      }
    }
  }
  return [];
}

function readCitationArray(value: unknown): Array<{ sourceId: string; title: string; url: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const citations: Array<{ sourceId: string; title: string; url: string }> = [];
  for (const row of value) {
    if (!isRecord(row)) {
      continue;
    }
    const url = readStringField(row, "url") ?? readStringField(row, "uri");
    if (url === undefined) {
      continue;
    }
    citations.push({
      sourceId: readStringField(row, "sourceId") ??
        readStringField(row, "source_id") ??
        readStringField(row, "id") ??
        `source-${citations.length + 1}`,
      title: readStringField(row, "title") ??
        readStringField(row, "name") ??
        "Source",
      url,
    });
  }
  return citations;
}

function readThreadStartResponseThreadId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.threadId === "string") {
    return value.threadId;
  }
  if (typeof value.id === "string") {
    return value.id;
  }
  if (isRecord(value.thread) && typeof value.thread.id === "string") {
    return value.thread.id;
  }
  return undefined;
}

function readTurnStartResponseTurnId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.turnId === "string") {
    return value.turnId;
  }
  if (typeof value.id === "string") {
    return value.id;
  }
  if (isRecord(value.turn) && typeof value.turn.id === "string") {
    return value.turn.id;
  }
  return undefined;
}

function readDeviceCodeLogin(value: unknown): CodexDeviceCodeLogin | undefined {
  const candidate = isRecord(value) && isRecord(value.deviceCode)
    ? value.deviceCode
    : value;
  if (!isRecord(candidate)) {
    return undefined;
  }
  const loginId = readStringField(candidate, "loginId") ??
    readStringField(candidate, "id");
  const userCode = readStringField(candidate, "userCode") ??
    readStringField(candidate, "user_code");
  const verificationUrl = readStringField(candidate, "verificationUrl") ??
    readStringField(candidate, "verification_url") ??
    readStringField(candidate, "verificationUri") ??
    readStringField(candidate, "verification_uri");
  if (loginId === undefined || userCode === undefined || verificationUrl === undefined) {
    return undefined;
  }
  return { loginId, userCode, verificationUrl };
}

function readCodexAuthEvent(message: WireMessage): CodexAuthEvent | undefined {
  if (message.method === "account/updated") {
    return { type: "account.updated" };
  }
  if (message.method !== "account/login/completed" || !isRecord(message.params)) {
    return undefined;
  }
  const loginId = readStringField(message.params, "loginId") ??
    readStringField(message.params, "login_id") ??
    null;
  const success = message.params.success === true;
  const error = typeof message.params.error === "string"
    ? message.params.error
    : null;
  return {
    type: "account.login.completed",
    loginId,
    success,
    error,
  };
}

function readCodexModelCatalog(value: unknown): CodexModelCatalog {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new CodexAppServerError(
      "app_server_protocol_error",
      "Codex app-server returned an invalid model catalog.",
    );
  }

  const models: CodexModelInfo[] = [];
  for (const row of value.data) {
    const model = readCodexModelInfo(row);
    if (model !== undefined) {
      models.push(model);
    }
  }
  return { models };
}

function readCodexModelInfo(value: unknown): CodexModelInfo | undefined {
  if (!isRecord(value)) {
    throw invalidModelCatalogError();
  }
  if (value.hidden === true) {
    return undefined;
  }
  const id = readStringField(value, "id");
  const model = readStringField(value, "model");
  const displayName = readStringField(value, "displayName");
  const description = readStringField(value, "description");
  const defaultReasoningEffort = readReasoningEffort(value.defaultReasoningEffort);
  if (
    id === undefined ||
    model === undefined ||
    displayName === undefined ||
    description === undefined ||
    defaultReasoningEffort === undefined ||
    typeof value.isDefault !== "boolean" ||
    !Array.isArray(value.supportedReasoningEfforts)
  ) {
    throw invalidModelCatalogError();
  }
  const supportedReasoningEfforts = value.supportedReasoningEfforts.map(
    readReasoningEffortOption,
  );
  if (supportedReasoningEfforts.some((effort) => effort === undefined)) {
    throw invalidModelCatalogError();
  }

  return {
    id,
    model,
    displayName,
    description,
    isDefault: value.isDefault,
    defaultReasoningEffort,
    supportedReasoningEfforts:
      supportedReasoningEfforts as CodexReasoningEffort[],
  };
}

function readReasoningEffortOption(value: unknown): CodexReasoningEffort | undefined {
  if (typeof value === "string") {
    return readReasoningEffort(value);
  }
  return isRecord(value) ? readReasoningEffort(value.reasoningEffort) : undefined;
}

function readReasoningEffort(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === "string" && isCodexReasoningEffort(value)
    ? value
    : undefined;
}

function invalidModelCatalogError(): CodexAppServerError {
  return new CodexAppServerError(
    "app_server_protocol_error",
    "Codex app-server returned an invalid model catalog.",
  );
}

function parseCodexJsonOutput(text: string): RawCodexChunkOutput | undefined {
  const trimmed = stripJsonFence(text.trim());
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) && Array.isArray(parsed.segments)
      ? parsed as unknown as RawCodexChunkOutput
      : undefined;
  } catch {
    return undefined;
  }
}

function stripJsonFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match?.[1] ?? text;
}

function matchesTurnNotification(
  params: unknown,
  input: {
    threadId: string;
    turnId: () => string | undefined;
  },
): boolean {
  if (readNotificationThreadId(params) !== input.threadId) {
    return false;
  }
  const expectedTurnId = input.turnId();
  const actualTurnId = readNotificationTurnId(params);
  return expectedTurnId === undefined ||
    actualTurnId === undefined ||
    actualTurnId === expectedTurnId;
}

function isTurnInterruptedCompletion(params: unknown): boolean {
  if (!isRecord(params)) {
    return false;
  }
  const values = [
    readStringField(params, "status"),
    readStringField(params, "state"),
    readStringField(params, "reason"),
    isRecord(params.turn) ? readStringField(params.turn, "status") : undefined,
    isRecord(params.turn) ? readStringField(params.turn, "state") : undefined,
    isRecord(params.turn) ? readStringField(params.turn, "reason") : undefined,
  ];
  return values.some((value) => {
    const normalized = value?.toLowerCase();
    return normalized === "interrupted" ||
      normalized === "canceled" ||
      normalized === "cancelled";
  });
}

function readNotificationThreadId(params: unknown): string | undefined {
  return readStringField(params, "threadId");
}

function readNotificationTurnId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return readStringField(params, "turnId") ??
    (isRecord(params.turn) ? readStringField(params.turn, "id") : undefined);
}

function readNotificationItemId(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  return readStringField(params, "itemId") ??
    (isRecord(params.item) ? readStringField(params.item, "id") : undefined);
}

function readStringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;
}

function readSafeProcessMessage(params: unknown): string | undefined {
  const message = readStringField(params, "message") ??
    readStringField(params, "summary") ??
    readStringField(params, "status");
  if (message === undefined || message.trim() === "") {
    return undefined;
  }
  const normalized = message.toLowerCase();
  if (
    normalized.includes("chain of thought") ||
    normalized.includes("hidden reasoning") ||
    containsAbsolutePath(message) ||
    normalized.includes("credential") ||
    normalized.includes("token")
  ) {
    return undefined;
  }
  return message;
}

function containsAbsolutePath(value: string): boolean {
  return /(^|[\s("'`])\/(?:[A-Za-z0-9._-]+\/)+[^\s)"'`]*/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatWireError(error: unknown): string {
  if (!isRecord(error)) {
    return String(error);
  }
  if (typeof error.message === "string") {
    return error.message;
  }
  return JSON.stringify(error);
}

function createCodexWireError(error: unknown): CodexAppServerError {
  const message = formatWireError(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("auth")) {
    return new CodexAppServerError("auth_required", message);
  }
  if (normalized.includes("usage") || normalized.includes("limit")) {
    return new CodexAppServerError("usage_limit", message);
  }
  if (normalized.includes("context")) {
    return new CodexAppServerError("context_overflow", message);
  }
  if (normalized.includes("timeout") || normalized.includes("timed out")) {
    return new CodexAppServerError("timeout", message);
  }
  if (isProtocolWireError(normalized)) {
    return new CodexAppServerError("app_server_protocol_error", message);
  }
  return new CodexAppServerError("unknown", message);
}

function toCodexWireProtocolError(error: unknown): CodexAppServerError {
  if (error instanceof CodexAppServerError) {
    return error;
  }
  return new CodexAppServerError(
    "app_server_protocol_error",
    error instanceof Error
      ? error.message
      : "Codex app-server sent an invalid wire payload.",
  );
}

function isProtocolWireError(normalizedMessage: string): boolean {
  return (
    normalizedMessage.includes("requires experimentalapi capability") ||
    normalizedMessage.includes("invalid params") ||
    normalizedMessage.includes("invalid request") ||
    normalizedMessage.includes("unknown method") ||
    normalizedMessage.includes("method not found") ||
    normalizedMessage.includes("unsupported method") ||
    normalizedMessage.includes("unexpected field") ||
    normalizedMessage.includes("unknown field") ||
    normalizedMessage.includes("unrecognized field")
  );
}

function isOutputSchemaUnsupportedError(error: unknown): boolean {
  if (!(error instanceof CodexAppServerError)) {
    return false;
  }
  const normalized = error.message.toLowerCase();
  return (
    /output\s*schema|structured|schema/.test(normalized) &&
    /unsupported|unknown|invalid|unrecognized|not supported|not allowed|unexpected/.test(
      normalized,
    )
  );
}

function readRequestTimeoutMs(): number {
  const raw = process.env.TRAUMA_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_CODEX_APP_SERVER_REQUEST_TIMEOUT_MS;
}

export class CodexAppServerError extends Error {
  constructor(
    public readonly code:
      | "auth_required"
      | "setup_required"
      | "app_server_unavailable"
      | "app_server_protocol_error"
      | "usage_limit"
      | "context_overflow"
      | "stream_disconnected"
      | "timeout"
      | "turn_interrupted"
      | "unknown"
      | "invalid_final_output",
    message: string,
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}
