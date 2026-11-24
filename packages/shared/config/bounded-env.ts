/**
 * Integer settings from the environment with bounds and a safe default.
 *
 * `Number(process.env.X || default)` turns a typo ("30s", "abc", "") into NaN
 * or 0, and every timeout built from it then fires at once or never (ARC-013:
 * a non-numeric LLM timeout made every LLM call fail immediately). Here an
 * unset value means the default, and an invalid or out-of-range value logs a
 * warning ONCE (the variable name and the bounds, never the value) and uses
 * the default.
 */

const warned = new Set<string>();

/** Pure parser: the integer in [min, max], or `fallback`. */
export const parseBoundedInt = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): { value: number; valid: boolean } => {
  if (raw === undefined || raw.trim() === "") return { value: fallback, valid: true };
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return { value: fallback, valid: false };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || value > max) return { value: fallback, valid: false };
  return { value, valid: true };
};

/** Pure parser: the decimal number in [min, max], or `fallback`. */
export const parseBoundedFloat = (
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): { value: number; valid: boolean } => {
  if (raw === undefined || raw.trim() === "") return { value: fallback, valid: true };
  const trimmed = raw.trim();
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return { value: fallback, valid: false };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) return { value: fallback, valid: false };
  return { value, valid: true };
};

/** Read `name` from the environment as a bounded decimal number (warns once). */
export const readBoundedFloatEnv = (
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: Record<string, string | undefined> = process.env
): number => {
  const { value, valid } = parseBoundedFloat(env[name], fallback, min, max);
  if (!valid && !warned.has(name)) {
    warned.add(name);
    console.warn(`[config] ${name} must be a number from ${min} to ${max}; using the default ${fallback}`);
  }
  return value;
};

/** Read `name` from the environment as a bounded integer (see above). */
export const readBoundedIntEnv = (
  name: string,
  fallback: number,
  min: number,
  max: number,
  env: Record<string, string | undefined> = process.env
): number => {
  const { value, valid } = parseBoundedInt(env[name], fallback, min, max);
  if (!valid && !warned.has(name)) {
    warned.add(name);
    console.warn(`[config] ${name} must be an integer from ${min} to ${max}; using the default ${fallback}`);
  }
  return value;
};
