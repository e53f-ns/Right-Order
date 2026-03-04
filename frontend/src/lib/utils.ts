import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Safely render a value in JSX - prevents "Objects are not valid as React child" errors
 */
export function safeRender(value: unknown, fallback: string = 'N/A'): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    // Don't render objects directly
    console.warn('[safeRender] Attempted to render object:', value);
    return fallback;
  }
  return fallback;
}
