const capturedAtDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const shortMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatCapturedAtForDisplay(value: string): string {
  if (capturedAtDateOnlyPattern.test(value)) {
    const [, rawMonth, rawDay] = value.split("-");
    const monthIndex = Number(rawMonth) - 1;
    const day = Number(rawDay);

    if (
      Number.isInteger(day) &&
      day >= 1 &&
      day <= 31 &&
      monthIndex >= 0 &&
      monthIndex < shortMonthNames.length
    ) {
      return `${day} ${shortMonthNames[monthIndex]}`;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
}
