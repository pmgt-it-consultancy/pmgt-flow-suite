// biome-ignore lint/suspicious/noExplicitAny: randomUUID may not exist in all Hermes builds
const _crypto: { randomUUID?: () => string } = typeof crypto !== "undefined" ? (crypto as any) : {};

export function generateUUID(): string {
  if (typeof _crypto.randomUUID === "function") {
    return _crypto.randomUUID();
  }
  // Fallback for older Hermes builds
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
