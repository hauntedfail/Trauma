import { afterEach, describe, expect, it } from "vitest";

import {
  CodexAppServerError,
  parseCodexAppServerEndpoint,
} from "../../../src/server/translation/codex-app-server";

const originalSocketPath = process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;

afterEach(() => {
  if (originalSocketPath === undefined) {
    delete process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH;
  } else {
    process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = originalSocketPath;
  }
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
});
