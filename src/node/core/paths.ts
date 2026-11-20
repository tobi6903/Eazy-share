// Filesystem helpers. Every client-supplied path goes through here before touching disk.
import fs from 'node:fs';
import path from 'node:path';

const BAD_CHARS = /[\x00-\x1f<>:"|?*]/g;
const BAD_NAME_CHARS = /[\x00-\x1f<>:"/\\|?*]/g;
const MAX_SEGMENT = 200;

/** Names Windows refuses to create (with or without an extension). Harmless to avoid everywhere. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Split a client path like 'photos/2024/a.jpg' into safe segments that can be created on
 * Windows, macOS and Linux alike. Returns null if the path is empty or tries to climb out
 * of its folder ('..').
 */
export function safeSegments(raw: string | null | undefined): string[] | null {
  const segments: string[] = [];
  for (const part of String(raw ?? '').replaceAll('\\', '/').split('/')) {
    let cleaned = part.replace(BAD_CHARS, '_').trim();
    if (cleaned === '..') return null;
    cleaned = cleaned.replace(/[. ]+$/, ''); // Windows can't create names ending in a dot or space
    if (!cleaned) continue; // empty, '.', or only dots
    if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
    segments.push(cleaned.slice(0, MAX_SEGMENT));
  }
  return segments.length > 0 ? segments : null;
}

/** A single file name (no directories) that is safe to use on any filesystem. */
export function safeName(raw: string | null | undefined, fallback: string): string {
  const name = String(raw ?? '').replace(BAD_NAME_CHARS, '_').trim().slice(0, 120);
  return name && name !== '.' && name !== '..' ? name : fallback;
}

/** Human-readable text such as a device name: control characters removed, trimmed. */
export function cleanLabel(raw: unknown, limit = 30): string {
  return String(raw ?? '').replace(/[\x00-\x1f]/g, '').trim().slice(0, limit);
}

export function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface FileEntry {
  /** Absolute path on disk. */
  absolute: string;
  /** Posix path relative to the walked root: the name inside the zip. */
  relative: string;
}

/** All regular files under `root`, sorted by relative path. */
export function walkFiles(root: string): FileEntry[] {
  const found: FileEntry[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) found.push({ absolute, relative });
    }
  };
  visit(root, '');
  return found.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}
