import { customAlphabet } from "nanoid";

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

/** Short, prefixed, URL-safe id: `id("exp")` → "exp_k3j9x0a1b2". */
export function id(prefix: string) {
  return `${prefix}_${nano()}`;
}

/** RFC 4122 v4 uuid (for event uuids). */
export function uuid() {
  return crypto.randomUUID();
}
