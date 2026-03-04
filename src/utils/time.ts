/**
 * Time utilities for timestamps and age calculations
 */

/**
 * Get current timestamp in milliseconds
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Get current timestamp in seconds
 */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Calculate age of a timestamp in milliseconds
 */
export function ageMs(timestampMs: number): number {
  return nowMs() - timestampMs;
}

/**
 * Check if a timestamp is older than maxAgeMs
 */
export function isStale(timestampMs: number, maxAgeMs: number): boolean {
  return ageMs(timestampMs) > maxAgeMs;
}

/**
 * Format milliseconds as human-readable duration
 * e.g., "2.3s", "156ms", "1m 23s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
}

/**
 * Format timestamp as ISO string
 */
export function toISOString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

/**
 * Format timestamp for display (local time)
 */
export function formatTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}

/**
 * Create a timeout promise that rejects after specified duration
 */
export function timeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Create a deadline from now
 */
export function createDeadline(durationMs: number): number {
  return nowMs() + durationMs;
}

/**
 * Check if deadline has passed
 */
export function isDeadlinePassed(deadlineMs: number): boolean {
  return nowMs() > deadlineMs;
}

/**
 * Get remaining time until deadline (0 if passed)
 */
export function remainingTime(deadlineMs: number): number {
  return Math.max(0, deadlineMs - nowMs());
}
