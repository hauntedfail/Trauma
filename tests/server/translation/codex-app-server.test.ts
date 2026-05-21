import { createHash } from "node:crypto";
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CodexAppServerClient,
  CodexAppServerError,
  parseCodexAppServerEndpoint,
} from "../../../src/server/translation/codex-app-server";
import type { TranslationChunk } from "../../../src/server/translation/types";

const originalSocketPath = process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalSocketPath === undefined) {
    delete process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;
  } else {
    process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = originalSocketPath;
  }
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Codex app-server endpoint parsing", () => {
  it("accepts explicitly configured Unix sockets", () => {
    expect(parseCodexAppServerEndpoint("unix:///tmp/trauma-codex.sock"))
      .toEqual({
        kind: "unix_socket",
        raw: "unix:///tmp/trauma-codex.sock",
        socketPath: "/tmp/trauma-codex.sock",
      });
  });

  it("resolves bare unix endpoints through the dedicated socket path env", () => {
    process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = "/tmp/brilliant.sock";

    expect(parseCodexAppServerEndpoint("unix://")).toMatchObject({
      kind: "unix_socket",
      socketPath: "/tmp/brilliant.sock",
    });
  });

  it("rejects HTTP and stdio as app-server wire transports", () => {
    expect(() => parseCodexAppServerEndpoint("https://localhost:1234"))
      .toThrow(CodexAppServerError);
    expect(() => parseCodexAppServerEndpoint("stdio://"))
      .toThrow(CodexAppServerError);
  });

  it("translates a chunk through the Unix-socket app-server wire protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });
      const events: string[] = [];
      const output = await client.translateChunk({
        chunk: createChunk(),
        onEvent: (event) => events.push(event.type),
        prompt: "translate chunk",
      });

      expect(output).toEqual({
        chunk_index: 0,
        blocks: [{ id: "b000001", translated_markdown: "翻訳本文" }],
        warnings: [],
      });
      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "account/read",
        "thread/start",
        "turn/start",
      ]);
      expect(events).toContain("thread.started");
      expect(events).toContain("turn.started");
      expect(events).toContain("delta");
      expect(events).toContain("item.completed");
    } finally {
      await server.close();
    }
  });

  it("uses Codex account methods for device-code auth without exposing credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-auth-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods);
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(client.startDeviceCodeLogin()).resolves.toEqual({
        loginId: "login-1",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://example.com/device",
      });
      await expect(client.cancelDeviceCodeLogin({ loginId: "login-1" }))
        .resolves.toBeUndefined();
      await expect(client.logout()).resolves.toEqual({ status: "logged_out" });

      expect(receivedMethods).toEqual([
        "initialize",
        "initialized",
        "account/login/start",
        "account/login/cancel",
        "account/logout",
      ]);
    } finally {
      await server.close();
    }
  });

  it("fails an unfinished turn when the Unix socket closes", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-codex-app-server-close-"));
    tempRoots.push(root);
    const socketPath = join(root, "app-server.sock");
    const receivedMethods: string[] = [];
    const server = await startFakeAppServer(socketPath, receivedMethods, {
      closeAfterTurnStart: true,
    });
    try {
      const client = new CodexAppServerClient({
        kind: "unix_socket",
        raw: `unix://${socketPath}`,
        socketPath,
      });

      await expect(
        client.translateChunk({
          chunk: createChunk(),
          prompt: "translate chunk",
        }),
      ).rejects.toMatchObject({ code: "stream_disconnected" });
    } finally {
      await server.close();
    }
  });
});

function createChunk(): TranslationChunk {
  return {
    blockIds: ["b000001"],
    chunkCount: 1,
    chunkIndex: 0,
    docTitle: "Source",
    documentType: "article",
    glossary: {},
    jobId: "019e3906-0000-7000-8000-000000000123",
    langCode: "ja-JP",
    memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f999",
    sectionPath: ["1"],
    sourceChunkHash: "sha256:chunk",
    sourceHash: "sha256:source",
    sourceMarkdown: "Source body",
    sourceUrl: "https://example.com",
    styleProfile: null,
  };
}

async function startFakeAppServer(
  socketPath: string,
  receivedMethods: string[],
  options: { closeAfterTurnStart?: boolean } = {},
): Promise<{ close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([
        buffer,
        typeof chunk === "string" ? Buffer.from(chunk) : chunk,
      ]);
      if (!upgraded) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) {
          return;
        }
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const key = /^Sec-WebSocket-Key:\s*(.+)$/im.exec(header)?.[1]?.trim();
        if (key === undefined) {
          socket.destroy(new Error("missing websocket key"));
          return;
        }
        socket.write(createUpgradeResponse(key));
        buffer = buffer.slice(headerEnd + 4);
        upgraded = true;
      }

      for (const message of drainClientMessages()) {
        handleClientMessage(socket, receivedMethods, message, options);
      }
    });

    function drainClientMessages(): unknown[] {
      const messages: unknown[] = [];
      while (buffer.length >= 2) {
        const second = buffer[1] ?? 0;
        let offset = 2;
        let length = second & 0x7f;
        if (length === 126) {
          if (buffer.length < offset + 2) {
            break;
          }
          length = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (length === 127) {
          if (buffer.length < offset + 8) {
            break;
          }
          length = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }
        const masked = (second & 0x80) !== 0;
        const maskLength = masked ? 4 : 0;
        if (buffer.length < offset + maskLength + length) {
          break;
        }
        const mask = masked ? buffer.slice(offset, offset + 4) : undefined;
        offset += maskLength;
        const payload = Buffer.from(buffer.slice(offset, offset + length));
        buffer = buffer.slice(offset + length);
        if (mask !== undefined) {
          for (let index = 0; index < payload.length; index += 1) {
            payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
          }
        }
        messages.push(JSON.parse(payload.toString("utf8")));
      }
      return messages;
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function handleClientMessage(
  socket: net.Socket,
  receivedMethods: string[],
  value: unknown,
  options: { closeAfterTurnStart?: boolean } = {},
): void {
  if (!isRecord(value) || typeof value.method !== "string") {
    return;
  }
  receivedMethods.push(value.method);
  const id = typeof value.id === "string" ? value.id : undefined;
  switch (value.method) {
    case "initialize":
      sendJson(socket, { id, result: {} });
      break;
    case "account/read":
      sendJson(socket, { id, result: { requiresOpenaiAuth: false } });
      break;
    case "account/login/start":
      sendJson(socket, {
        id,
        result: {
          loginId: "login-1",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://example.com/device",
        },
      });
      break;
    case "account/login/cancel":
    case "account/logout":
      sendJson(socket, { id, result: {} });
      break;
    case "thread/start":
      sendJson(socket, { id, result: { threadId: "thread-1" } });
      break;
    case "turn/start":
      sendJson(socket, { id, result: { turnId: "turn-1" } });
      if (options.closeAfterTurnStart === true) {
        socket.end();
        break;
      }
      sendJson(socket, {
        method: "turn/started",
        params: { threadId: "thread-1", turnId: "turn-1" },
      });
      sendJson(socket, {
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", turnId: "turn-1", delta: "翻訳" },
      });
      sendJson(socket, {
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "item-1",
            text: JSON.stringify({
              chunk_index: 0,
              blocks: [{ id: "b000001", translated_markdown: "翻訳本文" }],
              warnings: [],
            }),
            type: "agentMessage",
          },
        },
      });
      break;
  }
}

function createUpgradeResponse(key: string): string {
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n");
}

function sendJson(socket: net.Socket, value: unknown): void {
  socket.write(encodeServerWebSocketTextFrame(JSON.stringify(value)));
}

function encodeServerWebSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  return Buffer.concat([
    Buffer.from([0x81, 126, (payload.length >> 8) & 0xff, payload.length & 0xff]),
    payload,
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
