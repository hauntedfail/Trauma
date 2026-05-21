import { randomBytes, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

import type { TranslationChunk, CodexChunkOutput } from "./types";

export type CodexAppServerTransportKind = "unix_socket" | "websocket";

export interface CodexAppServerEndpoint {
  kind: CodexAppServerTransportKind;
  raw: string;
  socketPath?: string;
  url?: string;
}

export type CodexAppServerEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "turn.started"; turnId: string }
  | { type: "delta"; text: string }
  | { type: "item.started"; itemId: string | null }
  | { type: "item.completed"; itemId: string | null };

export interface TranslateChunkInput {
  chunk: TranslationChunk;
  onEvent?: (event: CodexAppServerEvent) => void;
  outputSchema?: unknown;
  prompt: string;
}

export interface TranslationClient {
  probe: () => Promise<void>;
  translateChunk: (input: TranslateChunkInput) => Promise<CodexChunkOutput>;
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
}

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
  if (endpoint.startsWith("ws://")) {
    const url = new URL(endpoint);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      throw new CodexAppServerError(
        "setup_required",
        "Brilliant only supports loopback WebSocket Codex app-server endpoints.",
      );
    }
    return {
      kind: "websocket",
      raw: endpoint,
      url: endpoint,
    };
  }

  throw new CodexAppServerError(
    "setup_required",
    "Unsupported Codex app-server endpoint.",
  );
}

export class CodexAppServerClient implements TranslationClient {
  private initialized = false;
  private readonly notificationListeners = new Set<(message: WireMessage) => void>();
  private requestId = 1;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private connection: CodexWireConnection | undefined;

  constructor(
    private readonly endpoint: CodexAppServerEndpoint =
      parseCodexAppServerEndpoint(),
  ) {}

  async probe(): Promise<void> {
    await this.ensureInitialized();
    const account = await this.request("account/read", { refreshToken: true });
    if (isRecord(account) && account.requiresOpenaiAuth === true) {
      throw new CodexAppServerError(
        "auth_required",
        "Codex app-server requires OpenAI authentication.",
      );
    }
  }

  async translateChunk(
    input: TranslateChunkInput,
  ): Promise<CodexChunkOutput> {
    await this.probe();
    const thread = await this.request("thread/start", {
      cwd: await createRuntimeCwd(input.chunk.jobId),
      ephemeral: true,
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
      sandbox: "read-only",
      environments: [],
      experimentalRawEvents: false,
      persistExtendedHistory: false,
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
    try {
      turn = await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, text_elements: [] }],
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        environments: [],
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
      });
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
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.connection = await openCodexWireConnection(this.endpoint, (message) =>
      this.handleMessage(message),
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
    const id = String(this.requestId);
    this.requestId += 1;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
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
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pendingRequests.delete(message.id);
      if (message.error !== undefined) {
        pending.reject(
          new CodexAppServerError(
            "app_server_unavailable",
            formatWireError(message.error),
          ),
        );
        return;
      }
      pending.resolve(message.result);
    }
  }

  private subscribeNotification(
    listener: (message: WireMessage) => void,
  ): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  private waitForTurnCompletion(input: {
    onEvent?: (event: CodexAppServerEvent) => void;
    threadId: string;
    turnId: () => string | undefined;
  }): { output: Promise<CodexChunkOutput>; unsubscribe: () => void } {
    let unsubscribe: () => void = () => undefined;
    const output = new Promise<CodexChunkOutput>((resolve, reject) => {
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
            resolve(itemOutput);
          }
          return;
        }
        if (message.method === "turn/completed") {
          if (!matchesTurnNotification(message.params, input)) {
            return;
          }
          const finalOutput = readFinalOutput(message.params);
          if (finalOutput === undefined) {
            reject(
              new CodexAppServerError(
                "invalid_final_output",
                "Codex app-server did not return a final translation payload.",
              ),
            );
            return;
          }
          resolve(finalOutput);
        }
      });
    });
    return { output, unsubscribe };
  }
}

interface CodexWireConnection {
  send: (message: WireMessage) => void;
}

async function openCodexWireConnection(
  endpoint: CodexAppServerEndpoint,
  onMessage: (message: WireMessage) => void,
): Promise<CodexWireConnection> {
  if (endpoint.kind === "websocket") {
    return openWebSocketConnection(endpoint, onMessage);
  }
  return openUnixWebSocketConnection(endpoint, onMessage);
}

async function openWebSocketConnection(
  endpoint: CodexAppServerEndpoint,
  onMessage: (message: WireMessage) => void,
): Promise<CodexWireConnection> {
  if (endpoint.url === undefined) {
    throw new CodexAppServerError("setup_required", "Missing WebSocket URL.");
  }
  const socket = new WebSocket(endpoint.url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => {
      reject(
        new CodexAppServerError(
          "app_server_unavailable",
          "Cannot connect to Codex app-server.",
        ),
      );
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      onMessage(parseWireMessage(event.data));
    }
  });
  return {
    send: (message) => socket.send(JSON.stringify(message)),
  };
}

async function openUnixWebSocketConnection(
  endpoint: CodexAppServerEndpoint,
  onMessage: (message: WireMessage) => void,
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

  const key = randomBytes(16).toString("base64");
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

  await waitForWebSocketUpgrade(socket, key);
  const decoder = new WebSocketFrameDecoder((text) =>
    onMessage(parseWireMessage(text)),
  );
  socket.on("data", (chunk) =>
    decoder.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
  );
  socket.on("error", () => undefined);

  return {
    send: (message) => socket.write(encodeClientWebSocketTextFrame(JSON.stringify(message))),
  };
}

function waitForWebSocketUpgrade(socket: net.Socket, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }
      socket.off("data", onData);
      const header = buffer.slice(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.1 101\b/i.test(header)) {
        reject(
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
        reject(
          new CodexAppServerError(
            "app_server_unavailable",
            "Codex app-server WebSocket accept key did not match.",
          ),
        );
        return;
      }
      const remaining = buffer.slice(headerEnd + 4);
      if (remaining.length > 0) {
        socket.unshift(remaining);
      }
      resolve();
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function encodeClientWebSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header: number[] = [0x81];
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

  constructor(private readonly onText: (text: string) => void) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0] ?? 0;
      const second = this.buffer[1] ?? 0;
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
      if (opcode !== 1) {
        continue;
      }
      if (mask !== undefined) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
        }
      }
      this.onText(payload.toString("utf8"));
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

function parseWireMessage(value: string): WireMessage {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) {
    throw new CodexAppServerError("app_server_unavailable", "Invalid app-server payload.");
  }
  return parsed;
}

function readFinalOutput(value: unknown): CodexChunkOutput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const output = value.output ?? value.finalOutput ?? value.structuredOutput;
  if (isRecord(output) && Array.isArray(output.blocks)) {
    return output as unknown as CodexChunkOutput;
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

function parseCodexJsonOutput(text: string): CodexChunkOutput | undefined {
  const trimmed = stripJsonFence(text.trim());
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) && Array.isArray(parsed.blocks)
      ? parsed as unknown as CodexChunkOutput
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

export class CodexAppServerError extends Error {
  constructor(
    public readonly code:
      | "auth_required"
      | "setup_required"
      | "app_server_unavailable"
      | "invalid_final_output",
    message: string,
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}
