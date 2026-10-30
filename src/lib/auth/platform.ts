/** Safe during server rendering; all labels use the same platform mapping. */
export function platformShortcut(
  value: string,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  return /Mac|iPhone|iPad|iPod/.test(platform)
    ? value
    : value
        .replaceAll("⌘", "Ctrl")
        .replaceAll("⌥", "Alt")
        .replaceAll("⇧", "Shift")
        .replaceAll("↵", "Enter");
}
