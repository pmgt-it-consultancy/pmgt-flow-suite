export function installWindowShim() {
  if (typeof globalThis.window === "undefined") {
    (globalThis as any).window = {};
  }

  if (typeof (globalThis as any).window.addEventListener !== "function") {
    (globalThis as any).window.addEventListener = () => {};
  }
  if (typeof (globalThis as any).window.removeEventListener !== "function") {
    (globalThis as any).window.removeEventListener = () => {};
  }
}
