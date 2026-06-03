import type { CodexConversationClient } from "../translation/codex-app-server";

export interface ActivePsychiatristTurn {
  client: CodexConversationClient;
  codexThreadId?: string;
  codexTurnId?: string;
  memoryId: string;
  pairId: string;
  threadId: string;
  turnId: string;
}

export class ActivePsychiatristTurnRegistry {
  private readonly byTurnId = new Map<string, ActivePsychiatristTurn>();
  private readonly byThreadId = new Map<string, ActivePsychiatristTurn>();

  getByThreadId(threadId: string): ActivePsychiatristTurn | undefined {
    return this.byThreadId.get(threadId);
  }

  getByTurnId(turnId: string): ActivePsychiatristTurn | undefined {
    return this.byTurnId.get(turnId);
  }

  register(turn: ActivePsychiatristTurn): void {
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
  }

  clear(): void {
    this.byTurnId.clear();
    this.byThreadId.clear();
  }
}

export const activePsychiatristTurns = new ActivePsychiatristTurnRegistry();
