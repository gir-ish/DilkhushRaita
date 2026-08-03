import { mkdir, readdir, stat } from "fs/promises";
import path from "path";

/**
 * Menu item photos live on disk in public/uploads/menu/ so the owner can also
 * drop files in by FTP or cPanel File Manager without using the dashboard.
 *
 * They are served through /api/menu-images/<file> rather than the static
 * /uploads/... path on purpose: Next only guarantees serving files that were in
 * public/ at BUILD time, and these are uploaded long after. Going through a
 * route handler means a photo works the moment it is uploaded, with no rebuild.
 */

export const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "menu");
export const PUBLIC_PREFIX = "/api/menu-images/";

/** Extensions we accept. Anything else is rejected outright. */
export const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".avif"] as const;

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export function contentTypeFor(filename: string): string {
  return MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

/**
 * True only for a plain filename with an allowed extension — no directory
 * separators, no "..", no absolute paths. Every filename that reaches the
 * filesystem must pass this, which is what stops path traversal.
 */
export function isSafeFilename(name: string): boolean {
  if (!name || name.length > 120) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (name !== path.basename(name)) return false;
  if (name.startsWith(".")) return false;
  return (ALLOWED_EXT as readonly string[]).includes(path.extname(name).toLowerCase());
}

/**
 * Builds our own filename from the original — the client's name is only used
 * as a readability hint, never as a path.
 */
export function safeFilenameFrom(original: string): string {
  const ext = path.extname(original).toLowerCase();
  const base = path
    .basename(original, path.extname(original))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base || "photo"}-${stamp}${rand}${ext}`;
}

/**
 * Content sniffing. An attacker can rename a script to .png, so the extension
 * alone is not evidence — these are the real magic bytes of each format.
 */
export function looksLikeImage(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  const riff = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
  const ftyp = buf.toString("ascii", 4, 8) === "ftyp"; // avif / heif family

  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return jpg;
    case ".png":
      return png;
    case ".webp":
      return riff;
    case ".avif":
      return ftyp;
    default:
      return false;
  }
}

export async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export interface StoredImage {
  name: string;
  url: string;
  sizeKb: number;
  modified: string;
}

/** Lists usable images, newest first. Unreadable entries are skipped. */
export async function listImages(): Promise<StoredImage[]> {
  await ensureUploadDir();
  const names = await readdir(UPLOAD_DIR);
  const out: StoredImage[] = [];
  for (const name of names) {
    if (!isSafeFilename(name)) continue;
    try {
      const s = await stat(path.join(UPLOAD_DIR, name));
      if (!s.isFile()) continue;
      out.push({
        name,
        url: PUBLIC_PREFIX + encodeURIComponent(name),
        sizeKb: Math.round(s.size / 1024),
        modified: s.mtime.toISOString(),
      });
    } catch {
      // A file that vanished mid-listing is not an error worth failing on.
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}
