/** Deterministic, sticky variant assignment (FNV-1a hash of distinct_id + experiment id). */
export function hashToUnit(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

export function assignVariant(distinctId: string, experimentId: string, allocation = 0.5): "control" | "treatment" {
  return hashToUnit(`${experimentId}:${distinctId}`) < allocation ? "treatment" : "control";
}
