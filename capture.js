import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

let sharedBrowser;

async function getBrowser() {
  if (!sharedBrowser) {
    sharedBrowser = await chromium.launch();
  }
  return sharedBrowser;
}

function buildCssVars(format) {
  const basePadXPct = 90 / 1080;
  const padX = Math.round(format.width * basePadXPct);
  const headerTop = Math.round(format.height * format.anchors.headerTopPct);
  const footerBottom = Math.round(format.height * format.anchors.footerBottomPct);

  return {
    '--W': `${format.width}px`,
    '--H': `${format.height}px`,
    '--uiScale': `${format.height / 1920}`,
    '--middleY': `${format.anchors.middlePct * 100}%`,
    '--padX': `${padX}px`,
    '--headerTop': `${headerTop}px`,
    '--footerBottom': `${footerBottom}px`,
  };
}

export async function renderFrames({ format, outDir, fileUrl }) {
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: format.width, height: format.height },
    // 2x keeps text and edges crisp while controlling render time/storage.
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  const renderUrl = `${fileUrl}?render=1&mode=video`;
  await page.goto(renderUrl, { waitUntil: 'load' });

  const vars = buildCssVars(format);
  await page.evaluate((styleVars) => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(styleVars)) {
      root.style.setProperty(key, value);
    }
  }, vars);

  const duration = await page.evaluate(() => window.__duration ?? 10.0);
  const totalFrames = Math.round(duration * format.fps);

  console.log(`[${format.key}] Rendering ${totalFrames} frames…`);

  for (let i = 0; i < totalFrames; i += 1) {
    const t = i / format.fps;
    await page.evaluate((tt) => window.__renderAt(tt), t);

    const framePath = path.join(outDir, `${String(i).padStart(6, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
  }

  console.log(`[${format.key}] Done.`);
  await context.close();
}

export async function shutdownCapture() {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = undefined;
  }
}

export async function renderStill({ format, outPath, url }) {
  void format;
  void outPath;
  void url;
  throw new Error('Not implemented');
}
