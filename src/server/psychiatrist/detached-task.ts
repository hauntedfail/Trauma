/**
 * Starts a turn after its HTTP 202 response without allowing a secondary
 * persistence failure to surface as a process-level unhandled rejection.
 */
export function runDetachedPsychiatristTask(
  task: () => Promise<void>,
): void {
  void task().catch(() => {
    // The turn runner owns user-visible safe failure persistence. Once that
    // persistence itself fails there is no safe response channel left.
  });
}
