import type {
  CodexModelCatalog,
  CodexModelInfo,
} from "../../server/translation/codex-app-server";

export interface CodexModelCatalogState {
  error: string;
  models: CodexModelInfo[];
  pending: boolean;
}

export interface CodexModelCatalogController {
  dispose: () => void;
  refresh: () => Promise<"error" | "ignored" | "success">;
}

export function createCodexModelCatalogController(input: {
  initialModels: CodexModelInfo[];
  onStateChange: (state: CodexModelCatalogState) => void;
  readCatalog: (input: { signal: AbortSignal }) => Promise<CodexModelCatalog>;
}): CodexModelCatalogController {
  let active = true;
  let generation = 0;
  let state: CodexModelCatalogState = {
    error: "",
    models: input.initialModels,
    pending: false,
  };
  let currentRequest:
    | {
      controller: AbortController;
      generation: number;
      promise: Promise<"error" | "ignored" | "success">;
    }
    | undefined;

  const publish = (next: CodexModelCatalogState): void => {
    state = next;
    input.onStateChange(next);
  };

  const isCurrent = (requestGeneration: number): boolean =>
    active && generation === requestGeneration;
  const clearCurrentRequest = (requestGeneration: number): void => {
    if (currentRequest?.generation === requestGeneration) {
      currentRequest = undefined;
    }
  };

  return {
    dispose() {
      active = false;
      generation += 1;
      currentRequest?.controller.abort();
      currentRequest = undefined;
    },
    refresh() {
      if (!active) {
        return Promise.resolve("ignored");
      }
      if (currentRequest !== undefined) {
        return currentRequest.promise;
      }

      generation += 1;
      const requestGeneration = generation;
      const controller = new AbortController();
      publish({ ...state, pending: true });
      const promise = (async (): Promise<"error" | "ignored" | "success"> => {
        try {
          const catalog = await input.readCatalog({ signal: controller.signal });
          if (!isCurrent(requestGeneration) || controller.signal.aborted) {
            return "ignored";
          }
          publish({ error: "", models: catalog.models, pending: false });
          return "success";
        } catch (error) {
          if (
            !isCurrent(requestGeneration) ||
            controller.signal.aborted ||
            isAbortError(error)
          ) {
            return "ignored";
          }
          publish({
            ...state,
            error: error instanceof Error
              ? error.message
              : "Failed to read Codex model catalog.",
            pending: false,
          });
          return "error";
        } finally {
          clearCurrentRequest(requestGeneration);
        }
      })();
      currentRequest = { controller, generation: requestGeneration, promise };
      return promise;
    },
  };
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";
}
