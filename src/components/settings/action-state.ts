export interface AsyncActionToken<Action extends string> {
  action: Action;
  id: number;
}

export interface AsyncActionTracker<Action extends string> {
  begin: (action: Action) => AsyncActionToken<Action>;
  finish: (token: AsyncActionToken<Action>) => void;
  isCurrent: (token: AsyncActionToken<Action>) => boolean;
  isLatestFeedback: (token: AsyncActionToken<Action>) => boolean;
  isPending: (action: Action) => boolean;
}

export function createAsyncActionTracker<Action extends string>(
  onPendingChange: (pending: ReadonlySet<Action>) => void,
): AsyncActionTracker<Action> {
  const activeIds = new Map<Action, number>();
  let nextId = 0;
  let latestFeedbackId = 0;

  const publishPending = (): void => {
    onPendingChange(new Set(activeIds.keys()));
  };

  return {
    begin(action) {
      nextId += 1;
      latestFeedbackId = nextId;
      activeIds.set(action, nextId);
      publishPending();
      return { action, id: nextId };
    },
    finish(token) {
      if (activeIds.get(token.action) !== token.id) {
        return;
      }
      activeIds.delete(token.action);
      publishPending();
    },
    isCurrent: (token) => activeIds.get(token.action) === token.id,
    isLatestFeedback: (token) => token.id === latestFeedbackId,
    isPending: (action) => activeIds.has(action),
  };
}
