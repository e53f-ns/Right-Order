export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!/^[+-]?\d+$/.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function clampFloat(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return fallback;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function requireWhitelistedField(field: string, allowlist: readonly string[]): string | null {
  return allowlist.includes(field) ? field : null;
}

export function isValidTxHashFormat(txHash: string): boolean {
  const normalized = txHash.trim();
  return /^[A-Fa-f0-9]{64}$/.test(normalized) || /^0x[A-Fa-f0-9]{64}$/.test(normalized);
}
