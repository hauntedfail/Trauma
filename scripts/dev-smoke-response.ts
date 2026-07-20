export function isExpectedDevSmokeResponse(response: Response): boolean {
  return response.status === 302 && response.headers.get("location") === "/memories";
}
