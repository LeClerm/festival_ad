import fs from 'node:fs';
import { mkdir, access, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { FORMATS, getFormatByKey } from './formats.js';
import { buildCssVars, renderFrames, renderStill, shutdownCapture } from './capture.js';
import { assertFfmpegAvailable, encodeSilentMp4, muxAudio } from './ffmpeg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function parseArgs(argv) {
  const parsed = {
    formats: null,
    clean: hasFlag(argv, '--clean'),
    force: hasFlag(argv, '--force'),
    noRender: hasFlag(argv, '--no-render'),
    noEncode: hasFlag(argv, '--no-encode'),
    noMux: hasFlag(argv, '--no-mux'),
    noStill: hasFlag(argv, '--no-still'),
    keepFrames: hasFlag(argv, '--keep-frames'),
    crf: '18',
    audioBitrate: '192k',
  };

  for (const arg of argv) {
    if (arg.startsWith('--formats=')) {
      const value = arg.slice('--formats='.length).trim();
      parsed.formats = value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      continue;
    }

    if (arg.startsWith('--crf=')) {
      const value = arg.slice('--crf='.length).trim();
      if (value) {
        parsed.crf = value;
      }
      continue;
    }

    if (arg.startsWith('--audio-bitrate=')) {
      const value = arg.slice('--audio-bitrate='.length).trim();
      if (value) {
        parsed.audioBitrate = value;
      }
    }
  }

  return parsed;
}

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function fileExists(targetPath) {
  return exists(targetPath) && fs.statSync(targetPath).isFile();
}

function dirExists(targetPath) {
  return exists(targetPath) && fs.statSync(targetPath).isDirectory();
}

function resolveSelectedFormats(formatKeys) {
  if (!formatKeys || formatKeys.length === 0) {
    return FORMATS;
  }

  return formatKeys.map((key) => {
    const format = getFormatByKey(key);
    if (!format) {
      throw new Error(`Unknown format key: ${key}. Valid: ${FORMATS.map((item) => item.key).join(',')}`);
    }
    return format;
  });
}

function formatPathsFor(key) {
  const framesDir = path.join('tmp', key, 'frames');
  return {
    framesDir,
    firstFrame: path.join(framesDir, '000000.png'),
    framesPattern: path.join(framesDir, '%06d.png'),
    silentMp4: path.join('dist', key, `festival_${key}_silent.mp4`),
    finalMp4: path.join('dist', key, `festival_${key}.mp4`),
    stillPng: path.join('dist', key, `festival_${key}.png`),
  };
}

function toFileUrl(filePath) {
  return `file://${path.resolve(filePath).replace(/\\/g, '/')}`;
}

async function assertFramesReady(formatKey, framesDir) {
  try {
    await access(framesDir);
    await access(path.join(framesDir, '000000.png'));
    const files = await readdir(framesDir);
    const hasPng = files.some((name) => name.toLowerCase().endsWith('.png'));
    if (!hasPng) {
      throw new Error('missing png frames');
    }
  } catch {
    throw new Error(
      `Frames not found for ${formatKey}. Run build without --no-render or delete tmp/${formatKey} and rebuild.`,
    );
  }
}

async function ensureFolders(selectedFormats) {
  await mkdir(path.join(repoRoot, 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'tmp'), { recursive: true });

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    await mkdir(path.join(repoRoot, path.dirname(paths.silentMp4)), { recursive: true });
    await mkdir(path.join(repoRoot, paths.framesDir), { recursive: true });
  }
}

function cleanOutputs() {
  const tmpPath = path.join(repoRoot, 'tmp');
  const distPath = path.join(repoRoot, 'dist');

  if (exists(tmpPath)) {
    fs.rmSync(tmpPath, { recursive: true, force: true });
  }

  if (exists(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }
}

function computeNeededStages(args, selectedFormats) {
  let renderNeeded = false;
  let encodeNeeded = false;
  let muxNeeded = false;
  let stillNeeded = false;

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    const firstFrame = path.join(repoRoot, paths.firstFrame);
    const silentMp4 = path.join(repoRoot, paths.silentMp4);
    const finalMp4 = path.join(repoRoot, paths.finalMp4);
    const stillPng = path.join(repoRoot, paths.stillPng);

    if (!args.noRender && (args.force || !fileExists(firstFrame))) {
      renderNeeded = true;
    }

    if (!args.noEncode && (args.force || !fileExists(silentMp4))) {
      encodeNeeded = true;
    }

    if (!args.noMux && (args.force || !fileExists(finalMp4))) {
      muxNeeded = true;
    }

    if (!args.noStill && (args.force || !fileExists(stillPng))) {
      stillNeeded = true;
    }
  }

  return {
    renderNeeded,
    encodeNeeded,
    muxNeeded,
    stillNeeded,
    browserNeeded: renderNeeded || stillNeeded,
    videoNeeded: encodeNeeded || muxNeeded,
  };
}

async function assertPlaywrightAvailableIfNeeded(browserNeeded) {
  if (!browserNeeded) {
    return;
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch {
    throw new Error(
      'Playwright Chromium is not available. Install it with: npx playwright install chromium',
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function renderStatus(ran) {
  return ran ? 'ran' : 'skipped';
}

function buildManifest({ args, selectedFormats, command }) {
  const formats = selectedFormats.map((format) => {
    const paths = formatPathsFor(format.key);
    const finalMp4 = path.join(repoRoot, paths.finalMp4);
    const silentMp4 = path.join(repoRoot, paths.silentMp4);
    const stillPng = path.join(repoRoot, paths.stillPng);

    return {
      key: format.key,
      width: format.width,
      height: format.height,
      fps: format.fps,
      duration: format.duration,
      outputs: {
        finalMp4: fileExists(finalMp4) ? paths.finalMp4 : null,
        silentMp4: fileExists(silentMp4) ? paths.silentMp4 : null,
        stillPng: fileExists(stillPng) ? paths.stillPng : null,
      },
    };
  });

  return {
    buildTimestampISO: new Date().toISOString(),
    command,
    formats,
    flags: {
      clean: args.clean,
      force: args.force,
      noRender: args.noRender,
      noEncode: args.noEncode,
      noMux: args.noMux,
      noStill: args.noStill,
      keepFrames: args.keepFrames,
    },
  };
}

function listDeliverables(selectedFormats) {
  const deliverables = [];

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    const candidates = [paths.finalMp4, paths.silentMp4, paths.stillPng];

    for (const candidate of candidates) {
      if (fileExists(path.join(repoRoot, candidate))) {
        deliverables.push(candidate);
      }
    }
  }

  const manifestPath = path.join('dist', 'manifest.json');
  if (fileExists(path.join(repoRoot, manifestPath))) {
    deliverables.push(manifestPath);
  }

  return deliverables;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedFormats = resolveSelectedFormats(args.formats);
  const fileUrl = toFileUrl(path.join(repoRoot, 'index.html'));
  const audioPath = path.join(repoRoot, 'sound_10s_fade.mp3');
  const stageNeeds = computeNeededStages(args, selectedFormats);

  if (args.clean) {
    cleanOutputs();
  }

  await ensureFolders(selectedFormats);

  console.log('Build pipeline');
  console.log(`Formats: ${selectedFormats.map((format) => format.key).join(', ')}`);
  console.log(
    `Stages: render=${!args.noRender} encode=${!args.noEncode} mux=${!args.noMux} still=${!args.noStill}`,
  );
  console.log(
    `Flags: clean=${args.clean} force=${args.force} keep-frames=${args.keepFrames} crf=${args.crf} audio-bitrate=${args.audioBitrate}`,
  );

  if (stageNeeds.videoNeeded) {
    await assertFfmpegAvailable();
  }

  if (stageNeeds.muxNeeded && !fileExists(audioPath)) {
    throw new Error('Audio file missing: sound_10s_fade.mp3 at repo root.');
  }

  await assertPlaywrightAvailableIfNeeded(stageNeeds.browserNeeded);

  const summary = [];
  let browser = null;
  let buildSucceeded = false;

  try {
    if (stageNeeds.browserNeeded) {
      browser = await chromium.launch();
    }

    for (const format of selectedFormats) {
      const paths = formatPathsFor(format.key);
      const formatSummary = {
        format: format.key,
        rendered: false,
        encoded: false,
        muxed: false,
        still: false,
      };
      const framesDir = path.join(repoRoot, paths.framesDir);
      const firstFrame = path.join(repoRoot, paths.firstFrame);
      const silentMp4 = path.join(repoRoot, paths.silentMp4);
      const finalMp4 = path.join(repoRoot, paths.finalMp4);
      const stillPng = path.join(repoRoot, paths.stillPng);

      const shouldRender = !args.noRender && (args.force || !fileExists(firstFrame));
      if (shouldRender) {
        await renderFrames({ browser, format, outDir: framesDir, fileUrl });
        formatSummary.rendered = true;
      }

      const shouldEncode = !args.noEncode && (args.force || !fileExists(silentMp4));
      if (shouldEncode && !dirExists(framesDir)) {
        throw new Error(
          `Frames missing for ${format.key}. Run without --no-render or delete tmp/${format.key} and rebuild.`,
        );
      }
      if (shouldEncode) {
        await assertFramesReady(format.key, framesDir);
        await encodeSilentMp4({ format, framesDir, outPath: silentMp4, crf: args.crf });
        formatSummary.encoded = true;
      }

      const shouldMux = !args.noMux && (args.force || !fileExists(finalMp4));
      if (shouldMux && !fileExists(silentMp4)) {
        throw new Error(
          `Silent MP4 missing for ${format.key}. Run without --no-encode or delete dist/${format.key} and rebuild.`,
        );
      }
      if (shouldMux) {
        await muxAudio({
          silentMp4Path: silentMp4,
          audioPath,
          outPath: finalMp4,
          audioBitrate: args.audioBitrate,
        });
        formatSummary.muxed = true;
      }

      const shouldRenderStill = !args.noStill && (args.force || !fileExists(stillPng));
      if (shouldRenderStill) {
        await renderStill({
          browser,
          format,
          outPath: stillPng,
          fileUrl,
          cssVars: buildCssVars(format),
        });
        formatSummary.still = true;
      }

      summary.push(formatSummary);
      console.log(
        `[${format.key}] frames: ${renderStatus(formatSummary.rendered)} | encode: ${renderStatus(formatSummary.encoded)} | mux: ${renderStatus(formatSummary.muxed)} | still: ${renderStatus(formatSummary.still)}`,
      );
    }

    const manifest = buildManifest({
      args,
      selectedFormats,
      command: process.argv.join(' '),
    });
    const manifestPath = path.join(repoRoot, 'dist', 'manifest.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    buildSucceeded = true;
  } finally {
    if (browser) {
      await browser.close();
    }
    await shutdownCapture();

    if (buildSucceeded && !args.keepFrames) {
      const tmpPath = path.join(repoRoot, 'tmp');
      if (exists(tmpPath)) {
        fs.rmSync(tmpPath, { recursive: true, force: true });
      }
    }
  }

  const deliverables = listDeliverables(selectedFormats);
  console.log('\nDeliverables in dist/:');
  if (deliverables.length === 0) {
    console.log('- none');
  } else {
    for (const deliverable of deliverables) {
      console.log(`- ${deliverable}`);
    }
  }
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
