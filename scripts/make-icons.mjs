/**
 * Rasterises the app icons in public/ from their SVG sources.
 *
 *   node scripts/make-icons.mjs
 *
 * Run it after editing public/icon.svg or public/icon-maskable.svg — and when
 * the shop finally has a real logo, that is the only thing to change: drop it
 * in as those two files, run this, and every size follows.
 *
 * Why PNGs at all, when the manifest already points at the SVGs: iOS does not
 * accept an SVG for the home-screen icon. Without a PNG apple-touch-icon,
 * "Add to Home Screen" saves a shrunken screenshot of the page instead of the
 * icon, which is the single ugliest thing about a home-made PWA. Android is
 * happier with SVG, but hands a PNG to the install dialog and the task
 * switcher more predictably.
 *
 * `sharp` is not in package.json — it arrives underneath Next, which uses it
 * for image optimisation. That is fine for a tool run by hand a few times a
 * year, and deliberately NOT fine for anything in the build: this script is
 * never called by `npm run build`, and the PNGs it makes are committed so the
 * server never needs it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");

/** The maroon behind the art, used to square off the Apple icon. */
const BRAND_BG = "#7B1E1E";

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "sharp is not installed. It normally comes in with Next; if it did not,\n" +
      "run `npm install --no-save sharp` and try again."
  );
  process.exit(1);
}

/**
 * Rendered at 4x and downscaled with a proper filter rather than rasterised
 * straight to the target size — the 18px steam strokes turn to gravel at 192px
 * otherwise.
 */
async function render(srcFile, size, outFile, { opaque = false } = {}) {
  const svg = readFileSync(path.join(PUBLIC, srcFile));
  let img = sharp(svg, { density: 72 * 4 }).resize(size, size, { fit: "contain" });
  // iOS ignores transparency and composites onto black, so the rounded corners
  // of icon.svg would come out as black wedges. Filling them with the brand
  // maroon gives a full square, which is what Apple wants anyway: it applies
  // its own squircle mask on top.
  if (opaque) img = img.flatten({ background: BRAND_BG });
  const png = await img.png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(path.join(PUBLIC, outFile), png);
  console.log(`  ${outFile.padEnd(28)} ${String(size).padStart(4)}px  ${(png.length / 1024).toFixed(1)} kB`);
}

console.log("Rendering app icons…");
await render("icon.svg", 192, "icon-192.png");
await render("icon.svg", 512, "icon-512.png");
await render("icon-maskable.svg", 192, "icon-maskable-192.png");
await render("icon-maskable.svg", 512, "icon-maskable-512.png");
await render("icon.svg", 180, "apple-touch-icon.png", { opaque: true });
console.log("Done.");
