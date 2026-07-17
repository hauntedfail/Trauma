import type { CodexConversationClient } from "../translation/codex-app-server";
import {
  createNonQueuingAdmissionLimiter,
  type AdmissionRelease,
  type NonQueuingAdmissionLimiter,
} from "../concurrency/non-queuing-admission";

export const DEFAULT_PSYCHIATRIST_MAX_CONCURRENT_TURNS = 4;
export type PsychiatristTurnReservationResult =
  | "reserved"
  | "thread_conflict"
  | "capacity_exceeded";

export interface ActivePsychiatristTurn {
  client: CodexConversationClient;
  codexThreadId?: string;
  codexTurnId?: string;
  langCode?: string;
  memoryId: string;
  pairId: string;
  threadId: string;
  turnId: string;
  variantKind?: "source" | "translation";
}

export class ActivePsychiatristTurnRegistry {
  private readonly byTurnId = new Map<string, ActivePsychiatristTurn>();
  private readonly byThreadId = new Map<string, ActivePsychiatristTurn>();
  private readonly reservedThreadIds = new Set<string>();
  private readonly admissionReleases = new Map<string, AdmissionRelease>();
  private readonly admissionLimiter: NonQueuingAdmissionLimiter;

  constructor(
    maximumConcurrentTurns = DEFAULT_PSYCHIATRIST_MAX_CONCURRENT_TURNS,
  ) {
    this.admissionLimiter = createNonQueuingAdmissionLimiter(
      maximumConcurrentTurns,
    );
  }

  getByThreadId(threadId: string): ActivePsychiatristTurn | undefined {
    return this.byThreadId.get(threadId);
  }

  hasActiveOrReservedThread(threadId: string): boolean {
    return this.byThreadId.has(threadId) || this.reservedThreadIds.has(threadId);
  }

  getByTurnId(turnId: string): ActivePsychiatristTurn | undefined {
    return this.byTurnId.get(turnId);
  }

  getTurnIdsForMemory(memoryId: string): string[] {
    return [...this.byTurnId.values()]
      .filter((turn) => turn.memoryId === memoryId)
      .map((turn) => turn.turnId);
  }

  reserveThread(threadId: string): boolean {
    return this.tryReserveThread(threadId) === "reserved";
  }

  tryReserveThread(threadId: string): PsychiatristTurnReservationResult {
    if (this.hasActiveOrReservedThread(threadId)) {
      return "thread_conflict";
    }
    const releaseAdmission = this.admissionLimiter.tryAcquire();
    if (releaseAdmission === undefined) {
      return "capacity_exceeded";
    }
    this.reservedThreadIds.add(threadId);
    this.admissionReleases.set(threadId, releaseAdmission);
    return "reserved";
  }

  releaseThread(threadId: string): void {
    this.reservedThreadIds.delete(threadId);
    if (!this.byThreadId.has(threadId)) {
      this.releaseAdmission(threadId);
    }
  }

  register(turn: ActivePsychiatristTurn): void {
    if (!this.admissionReleases.has(turn.threadId)) {
      const releaseAdmission = this.admissionLimiter.tryAcquire();
      if (releaseAdmission === undefined) {
        throw new Error("Psychiatrist turn capacity is exhausted");
      }
      this.admissionReleases.set(turn.threadId, releaseAdmission);
    }
    this.reservedThreadIds.delete(turn.threadId);
    this.byTurnId.set(turn.turnId, turn);
    this.byThreadId.set(turn.threadId, turn);
  }

  updateCodexIds(input: {
    codexThreadId?: string;
    codexTurnId?: string;
    turnId: string;
  }): void {
    const turn = this.byTurnId.get(input.turnId);
    if (turn === undefined) {
      return;
    }
    const updated = {
      ...turn,
      codexThreadId: input.codexThreadId ?? turn.codexThreadId,
      codexTurnId: input.codexTurnId ?? turn.codexTurnId,
    };
    this.byTurnId.set(input.turnId, updated);
    this.byThreadId.set(updated.threadId, updated);
  }

  unregister(turnId: string): void {
    const turn = this.byTurnId.get(turnId);
    if (turn === undefined) {
      return;
    }
    this.byTurnId.delete(turnId);
    this.byThreadId.delete(turn.threadId);
    this.reservedThreadIds.delete(turn.threadId);
    this.releaseAdmission(turn.threadId);
  }

  clear(): void {
    for (const release of this.admissionReleases.values()) {
      release();
    }
    this.admissionReleases.clear();
    this.byTurnId.clear();
    this.byThreadId.clear();
    this.reservedThreadIds.clear();
  }

  private releaseAdmission(threadId: string): void {
    const release = this.admissionReleases.get(threadId);
    this.admissionReleases.delete(threadId);
    release?.();
  }
}

export const activePsychiatristTurns = new ActivePsychiatristTurnRegistry();
