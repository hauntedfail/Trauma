export interface FlashbackDurabilityWarning {
  code: "flashback_export_durability_unconfirmed";
  message: string;
  status: "unconfirmed";
}

export function readFlashbackDurabilityWarning(
  value: unknown,
): FlashbackDurabilityWarning | undefined {
  if (!isRecord(value) || !isRecord(value.result)) {
    return undefined;
  }
  const durability = value.result.durability;
  if (
    !isRecord(durability) ||
    durability.status !== "unconfirmed" ||
    !isRecord(durability.warning) ||
    durability.warning.code !== "flashback_export_durability_unconfirmed" ||
    typeof durability.warning.message !== "string" ||
    durability.warning.message.trim() === ""
  ) {
    return undefined;
  }
  return {
    code: "flashback_export_durability_unconfirmed",
    message: durability.warning.message,
    status: "unconfirmed",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
