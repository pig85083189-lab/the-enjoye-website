export function photoPlaceholderDataUrl(kind: "before" | "after" | "follow_up" | "other"): string {
  const svg =
    kind === "before"
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#F5E5E3" width="400" height="300"/><text x="200" y="155" text-anchor="middle" fill="#C9797D" font-family="sans-serif" font-size="18">療程前</text></svg>`
      : kind === "after"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#E8F3EC" width="400" height="300"/><text x="200" y="155" text-anchor="middle" fill="#4F7A5C" font-family="sans-serif" font-size="18">療程後</text></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#F8EEE4" width="400" height="300"/><text x="200" y="155" text-anchor="middle" fill="#B07A4A" font-family="sans-serif" font-size="18">追蹤照</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
