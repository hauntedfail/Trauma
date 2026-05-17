import type { FetchFunction } from "../memories/memory-action-requests";

export async function deleteMomentById(input: {
  fetch?: FetchFunction;
  momentId: string;
}): Promise<void> {
  const fetchFunction = input.fetch ?? fetch;
  const response = await fetchFunction(`/api/moments/${input.momentId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readMomentFailureMessage(response));
  }
}

async function readMomentFailureMessage(response: Response): Promise<string> {
  const fallback = "Moment failed";
  const body = await response.text();
  if (body.trim() === "") {
    return fallback;
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (
      typeof payload === "object" &&
      payload !== null &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string"
    ) {
      return (payload as { error: string }).error;
    }
  } catch {
    return body;
  }

  return body;
}
