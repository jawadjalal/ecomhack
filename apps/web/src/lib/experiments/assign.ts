/**
 * Deterministic, sticky variant assignment.
 * FNV-1a over `experimentId:distinctId`, then murmur3's fmix32 finalizer. Without the finalizer,
 * sequential ids (sim_h_1, sim_h_2, …) land in the same arm in long runs.
 */
export function hashToUnit(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

export function assignVariant(distinctId: string, experimentId: string, allocation = 0.5): "control" | "treatment" {
  return hashToUnit(`${experimentId}:${distinctId}`) < allocation ? "treatment" : "control";
}
