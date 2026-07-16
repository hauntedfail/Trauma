import { describe, expect, it } from "vitest";

import {
  isTrustedRequestHost,
  readTrustedHostnames,
} from "../../../src/server/http/trusted-host";

describe("trusted request host boundary", () => {
  it("allows only loopback hostnames by default", () => {
    const trustedHosts = readTrustedHostnames(undefined);

    expect(isTrustedRequestHost("127.0.0.1:4173", trustedHosts)).toBe(true);
    expect(isTrustedRequestHost("localhost:4173", trustedHosts)).toBe(true);
    expect(isTrustedRequestHost("[::1]:4173", trustedHosts)).toBe(true);
    expect(isTrustedRequestHost("attacker.example", trustedHosts)).toBe(false);
  });

  it("adds exact normalized reverse-proxy hostnames", () => {
    const trustedHosts = readTrustedHostnames("archive.example, READER.EXAMPLE.");

    expect(isTrustedRequestHost("archive.example:443", trustedHosts)).toBe(true);
    expect(isTrustedRequestHost("reader.example", trustedHosts)).toBe(true);
    expect(isTrustedRequestHost("sub.archive.example", trustedHosts)).toBe(false);
  });

  it("rejects malformed or ambiguous Host headers", () => {
    const trustedHosts = readTrustedHostnames(undefined);

    for (const host of [
      null,
      "",
      "localhost, attacker.example",
      "localhost/path",
      "user@localhost",
      "localhost:invalid",
    ]) {
      expect(isTrustedRequestHost(host, trustedHosts)).toBe(false);
    }
  });

  it("fails closed on invalid configured hostnames", () => {
    expect(() => readTrustedHostnames("https://archive.example")).toThrow(
      "Invalid TRAUMA_ALLOWED_HOSTS entry",
    );
    expect(() => readTrustedHostnames("*.example.com")).toThrow(
      "Invalid TRAUMA_ALLOWED_HOSTS entry",
    );
  });
});
