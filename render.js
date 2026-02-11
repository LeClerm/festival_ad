// render.js
// Usage: node render.js
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT_DIR = path.resolve("frames");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

const WIDTH = 1080;   // 9:16
const HEIGHT = 1920;
const FPS = 60;

const toFrameName = (i) => String(i).padStart(6, "0") + ".png";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 3
  });

  const fileUrl = "file://" + path.resolve("index.html").replace(/\\/g, "/") + "?render=1";
  await page.goto(fileUrl, { waitUntil: "load" });

  const duration = await page.evaluate(() => window.__duration ?? 9.0);
  const totalFrames = Math.round(duration * FPS);

  for (let i = 0; i < totalFrames; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => window.__renderAt(tt), t);
    await page.screenshot({
      path: path.join(OUT_DIR, toFrameName(i)),
      type: "png"
    });
  }

  await browser.close();
  console.log(`Done: ${totalFrames} frames in ${OUT_DIR}`);
})();
