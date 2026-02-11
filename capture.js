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

export function buildCssVars(format) {
  const basePadXPct = 90 / 1080;
  const padX = Math.round(format.width * basePadXPct);
  const headerTop = Math.round(format.height * format.anchors.headerTopPct);
  const footerBottom = Math.round(format.height * format.anchors.footerBottomPct);

  const stackYPct = format.stackYPct ?? format.anchors.middlePct;
  const stackTranslateY = format.stackAlign === 'top' ? '0%' : '-50%';
  const activitiesExtraWidthPx = format.activitiesExtraWidthPx ?? 0;

  return {
    '--W': `${format.width}px`,
    '--H': `${format.height}px`,
    '--uiScale': `${format.height / 1920}`,
    '--middleY': `${format.anchors.middlePct * 100}%`,
    '--stackY': `${stackYPct * 100}%`,
    '--stackTranslateY': stackTranslateY,
    '--activitiesExtraWidth': `${activitiesExtraWidthPx}px`,
    '--padX': `${padX}px`,
    '--headerTop': `${headerTop}px`,
    '--footerBottom': `${footerBottom}px`,
  };
}

async function applyCssVars(page, cssVars) {
  await page.evaluate((styleVars) => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(styleVars)) {
      root.style.setProperty(key, value);
    }
  }, cssVars);
}

export async function renderFrames({ browser, format, outDir, fileUrl }) {
  fs.mkdirSync(outDir, { recursive: true });

  const browserToUse = browser ?? (await getBrowser());
  const context = await browserToUse.newContext({
    viewport: { width: format.width, height: format.height },
    // 2x keeps text and edges crisp while controlling render time/storage.
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  const renderUrl = `${fileUrl}?render=1&mode=video`;
  await page.goto(renderUrl, { waitUntil: 'load' });

  await applyCssVars(page, buildCssVars(format));

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

export async function renderStill({ browser, format, outPath, fileUrl, cssVars }) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browserToUse = browser ?? (await getBrowser());
  const context = await browserToUse.newContext({
    viewport: { width: format.width, height: format.height },
    // Keep stills consistent with frame rendering.
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();
  const renderUrl = `${fileUrl}?render=1&mode=still`;
  await page.goto(renderUrl, { waitUntil: 'load' });

  await applyCssVars(page, cssVars ?? buildCssVars(format));

  const hasStillRenderer = await page.evaluate(() => typeof window.__renderStill === 'function');
  if (!hasStillRenderer) {
    throw new Error(
      `Still renderer missing for format ${format.key}: window.__renderStill is not defined in index.html?render=1&mode=still`,
    );
  }

  await page.evaluate(() => window.__renderStill());
  await page.screenshot({ path: outPath, type: 'png' });
  await context.close();
}
