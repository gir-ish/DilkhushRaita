import { readFile, stat } from "fs/promises";
import path from "path";
import { handler, HttpError } from "@/lib/guard";
import { UPLOAD_DIR, contentTypeFor, isSafeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * Serves a menu photo from public/uploads/menu/.
 *
 * Public on purpose — these are menu pictures shown to every customer, signed
 * in or not. Only files matching isSafeFilename() are readable, so the URL
 * cannot be used to walk out of the uploads folder.
 */
export const GET = handler(
  async (_req: Request, { params }: { params: Promise<{ name: string }> }) => {
    const { name: raw } = await params;
    const name = decodeURIComponent(raw);
    if (!isSafeFilename(name)) throw new HttpError(400, "Invalid image name");

    const full = path.join(UPLOAD_DIR, name);
    // Belt and braces: confirm the resolved path really is inside UPLOAD_DIR.
    if (path.relative(UPLOAD_DIR, full).startsWith("..")) throw new HttpError(400, "Invalid path");

    let body: Buffer;
    let size: number;
    try {
      const s = await stat(full);
      if (!s.isFile()) throw new Error("not a file");
      size = s.size;
      body = await readFile(full);
    } catch {
      throw new HttpError(404, "Image not found");
    }

    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentTypeFor(name),
        "Content-Length": String(size),
        // Filenames carry a random suffix and are never reused, so a long
        // immutable cache is safe and keeps menu browsing fast.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
);
