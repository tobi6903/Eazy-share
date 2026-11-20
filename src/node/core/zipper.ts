// Building the zip that gets delivered.
import fs from 'node:fs';
import path from 'node:path';
import yazl from 'yazl';
import type { FileEntry } from './paths.js';

/** Already-compressed formats gain nothing from deflate, so they are stored as-is. */
const STORE_SUFFIXES = new Set([
  '.zip', '.gz', '.7z', '.rar', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.mp3', '.m4a', '.mp4', '.mov', '.mkv', '.avi', '.pdf',
]);

/** Write the files into a zip at `destination` (streamed, so large files don't fill memory). */
export function buildZip(files: readonly FileEntry[], destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const file of files) {
      const compress = !STORE_SUFFIXES.has(path.extname(file.relative).toLowerCase());
      zip.addFile(file.absolute, file.relative, { compress });
    }
    const out = fs.createWriteStream(destination);
    out.on('error', reject);
    out.on('close', resolve);
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}
