export function applyDocumentSecurityHeaders(headers: Headers): void {
  headers.set("content-security-policy", "frame-ancestors 'none'");
  headers.set("x-frame-options", "DENY");
}
