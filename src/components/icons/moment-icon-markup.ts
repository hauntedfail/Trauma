export const momentIconBookmarkPath = "M7 4h12v18l-6-3.5L7 22V4z";
export const momentIconLineOnePath = "M10 8h6";
export const momentIconLineTwoPath = "M10 11h5";

export function renderMomentIconSvgMarkup(input: {
  className: string;
  filled: boolean;
  size: number;
}): string {
  const body = input.filled
    ? [
        `<path fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5" d="${momentIconBookmarkPath}"></path>`,
        `<path fill="none" stroke="var(--bg-base)" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7" d="${momentIconLineOnePath}${momentIconLineTwoPath}"></path>`,
      ].join("")
    : [
        `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="${momentIconBookmarkPath}"></path>`,
        `<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="${momentIconLineOnePath}${momentIconLineTwoPath}"></path>`,
      ].join("");

  return `<svg aria-hidden="true" class="${input.className}" height="${input.size}" viewBox="0 0 26 26" width="${input.size}">${body}</svg>`;
}
