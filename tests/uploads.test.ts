import path from "path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_EXT,
  contentTypeFor,
  isSafeFilename,
  looksLikeImage,
  safeFilenameFrom,
} from "@/lib/uploads";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "ascii"),
]);

describe("isSafeFilename", () => {
  it("accepts ordinary image names", () => {
    for (const n of ["dal-makhani.jpg", "paneer_tikka.PNG", "raita-1.webp", "x.avif"]) {
      expect(isSafeFilename(n)).toBe(true);
    }
  });

  // Every one of these is an attempt to write or read outside the uploads dir.
  it("rejects path traversal and separators", () => {
    for (const n of [
      "../secret.png",
      "../../.env",
      "foo/bar.png",
      "foo\\bar.png",
      "/etc/passwd.png",
      "C:\\windows\\system32.png",
      "..%2Fx.png".replace("%2F", "/"),
    ]) {
      expect(isSafeFilename(n), n).toBe(false);
    }
  });

  it("rejects null bytes", () => {
    expect(isSafeFilename("shell.png\0.php")).toBe(false);
  });

  it("rejects non-image and executable extensions", () => {
    for (const n of ["shell.php", "run.sh", "app.js", "note.txt", "archive.zip", "noext"]) {
      expect(isSafeFilename(n), n).toBe(false);
    }
  });

  it("rejects dotfiles and empty or overlong names", () => {
    expect(isSafeFilename(".env")).toBe(false);
    expect(isSafeFilename(".gitkeep")).toBe(false);
    expect(isSafeFilename("")).toBe(false);
    expect(isSafeFilename("a".repeat(200) + ".png")).toBe(false);
  });
});

describe("safeFilenameFrom", () => {
  it("always yields a name that passes isSafeFilename", () => {
    for (const input of [
      "Dal Makhani.jpg",
      "../../etc/passwd.png",
      "  weird   name!!.PNG",
      "शाही पनीर.webp",
      "....jpg",
      "a".repeat(300) + ".png",
    ]) {
      const out = safeFilenameFrom(input);
      expect(isSafeFilename(out), `${input} → ${out}`).toBe(true);
      expect(out.includes("/")).toBe(false);
      expect(out.includes("..")).toBe(false);
    }
  });

  it("preserves the extension in lowercase", () => {
    expect(path.extname(safeFilenameFrom("Photo.JPG"))).toBe(".jpg");
  });

  it("does not collide across rapid calls", () => {
    const names = new Set(Array.from({ length: 50 }, () => safeFilenameFrom("same.png")));
    expect(names.size).toBe(50);
  });

  it("falls back to a default stem when nothing usable remains", () => {
    expect(safeFilenameFrom("!!!.png").startsWith("photo-")).toBe(true);
  });
});

describe("looksLikeImage", () => {
  it("accepts genuine magic bytes", () => {
    expect(looksLikeImage(PNG, ".png")).toBe(true);
    expect(looksLikeImage(JPG, ".jpg")).toBe(true);
    expect(looksLikeImage(JPG, ".jpeg")).toBe(true);
    expect(looksLikeImage(WEBP, ".webp")).toBe(true);
  });

  // The whole point: renaming a script to .png must not get it stored.
  it("rejects content that is not really an image", () => {
    const php = Buffer.from("<?php system($_GET['c']); ?>".padEnd(32, " "), "ascii");
    const html = Buffer.from("<html><script>alert(1)</script></html>", "ascii");
    for (const ext of [".png", ".jpg", ".webp", ".avif"]) {
      expect(looksLikeImage(php, ext), `php as ${ext}`).toBe(false);
      expect(looksLikeImage(html, ext), `html as ${ext}`).toBe(false);
    }
  });

  it("rejects a real image claiming the wrong extension", () => {
    expect(looksLikeImage(PNG, ".jpg")).toBe(false);
    expect(looksLikeImage(JPG, ".png")).toBe(false);
  });

  it("rejects truncated files", () => {
    expect(looksLikeImage(Buffer.from([0x89, 0x50]), ".png")).toBe(false);
    expect(looksLikeImage(Buffer.alloc(0), ".png")).toBe(false);
  });
});

describe("contentTypeFor", () => {
  it("maps known extensions", () => {
    expect(contentTypeFor("a.jpg")).toBe("image/jpeg");
    expect(contentTypeFor("a.png")).toBe("image/png");
    expect(contentTypeFor("a.webp")).toBe("image/webp");
  });

  // Never echo back something the browser might execute.
  it("falls back to a non-executable type", () => {
    expect(contentTypeFor("a.unknown")).toBe("application/octet-stream");
  });

  it("covers every allowed extension", () => {
    for (const ext of ALLOWED_EXT) {
      expect(contentTypeFor(`x${ext}`)).not.toBe("application/octet-stream");
    }
  });
});
