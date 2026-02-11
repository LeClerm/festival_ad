// Placeholder module for future Playwright-driven rendering.
// Planned usage:
// 1. Open page URL in a browser context.
// 2. Capture animation frames to outDir.
// 3. Capture still image to outPath.

export async function renderFrames({ format, outDir, url }) {
  void format;
  void outDir;
  void url;
  throw new Error('Not implemented');
}

export async function renderStill({ format, outPath, url }) {
  void format;
  void outPath;
  void url;
  throw new Error('Not implemented');
}
