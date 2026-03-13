/**
 * Format a number as Philippine Peso currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a timestamp as a readable date
 */
export function formatDate(timestamp: number, options?: Intl.DateTimeFormatOptions): string {
  return new Date(timestamp).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...options,
  });
}

/**
 * Format a timestamp as a readable date and time
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a timestamp as time only
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a date as YYYY-MM-DD using local timezone
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format a number with comma separators
 */
export function formatNumber(num: number, decimals = 0): string {
  return new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format a percentage
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Get relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "Just now";
}

/**
 * Format order number with leading zeros
 */
export function formatOrderNumber(orderNumber: number): string {
  return orderNumber.toString().padStart(6, "0");
}

/**
 * Parse a date string (YYYY-MM-DD) to Date object
 */
export function parseDate(dateString: string): Date {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get start of day timestamp
 */
export function getStartOfDay(date: Date = new Date()): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Get end of day timestamp
 */
export function getEndOfDay(date: Date = new Date()): number {
  return getStartOfDay(date) + 24 * 60 * 60 * 1000 - 1;
}
