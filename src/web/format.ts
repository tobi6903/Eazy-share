// Display formatting.

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}

export function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/** Name for the zip: the folder/file name if there is just one, else a dated name. */
export function zipNameFor(paths: Iterable<string>): string {
  const tops = new Set([...paths].map((p) => p.split('/')[0] ?? ''));
  const only = tops.size === 1 ? [...tops][0] : undefined;
  return only || `eazy-share-${new Date().toISOString().slice(0, 10)}`;
}
