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
    const [rawYear, rawMonth, rawDay] = value.split("-");
    const year = Number(rawYear);
    const monthIndex = Number(rawMonth) - 1;
    const day = Number(rawDay);
    const maxDay = daysInMonth(year, monthIndex);

    if (
      maxDay !== null &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= maxDay
    ) {
      return `${day} ${shortMonthNames[monthIndex]}`;
    }

    return value;
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

function daysInMonth(year: number, monthIndex: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    monthIndex < 0 ||
    monthIndex >= shortMonthNames.length
  ) {
    return null;
  }

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDaysByMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ] as const;

  return maxDaysByMonth[monthIndex] ?? null;
}
