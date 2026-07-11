export type Wallpaper = "doodles" | "plain" | "dots" | "geometric";

export const WALLPAPERS: { id: Wallpaper; label: string }[] = [
  { id: "doodles", label: "Doodles" },
  { id: "plain", label: "Plain" },
  { id: "dots", label: "Dots" },
  { id: "geometric", label: "Geometric" },
];

const KEY = "nexchat_wallpaper";

export function getStoredWallpaper(): Wallpaper {
  if (typeof window === "undefined") return "doodles";
  const v = localStorage.getItem(KEY);
  return WALLPAPERS.some((w) => w.id === v) ? (v as Wallpaper) : "doodles";
}

export function applyWallpaper(w: Wallpaper) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.wallpaper = w;
}

export function setWallpaper(w: Wallpaper) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, w);
  applyWallpaper(w);
}
