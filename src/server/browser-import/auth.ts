import { createHash, timingSafeEqual } from "node:crypto";

export function verifyBrowserImportAuthorization(
  authorization: string | null,
  expectedToken: string | null,
) {
  if (expectedToken === null || expectedToken.length === 0) {
    return false;
  }

  const token = readBearerToken(authorization);
  if (token === null) {
    return false;
  }

  const expectedDigest = digestToken(expectedToken);
  const actualDigest = digestToken(token);
  return timingSafeEqual(expectedDigest, actualDigest);
}

function readBearerToken(value: string | null) {
  if (value === null) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (match === null) {
    return null;
  }

  const token = match[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function digestToken(token: string) {
  return createHash("sha256").update(token).digest();
}
