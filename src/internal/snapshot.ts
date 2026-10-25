/** Private data snapshot across an asynchronous, externally supplied callback. */
export function immutableSnapshot<T>(value: T): T {
  const copy = structuredClone(value);
  const seen = new WeakSet<object>();
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy);
  return copy;
}
