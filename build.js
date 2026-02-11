import fs from 'node:fs';
import { mkdir, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { FORMATS, getFormatByKey } from './formats.js';
import { renderFrames, shutdownCapture } from './capture.js';
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
    keepFrames: true,
  };

  for (const arg of argv) {
    if (arg === '--keep-frames') {
      parsed.keepFrames = true;
      continue;
    }

    if (arg === '--no-keep-frames') {
      parsed.keepFrames = false;
      continue;
    }

    if (arg.startsWith('--formats=')) {
      const value = arg.slice('--formats='.length).trim();
      parsed.formats = value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
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

  const selected = formatKeys.map((key) => {
    const format = getFormatByKey(key);
    if (!format) {
      throw new Error(
        `Unknown format key "${key}". Valid options: ${FORMATS.map((item) => item.key).join(', ')}`,
      );
    }
    return format;
  });

  return selected;
}

function formatPathsFor(key) {
  const framesDir = path.join('tmp', key, 'frames');
  return {
    framesDir,
    firstFrame: path.join(framesDir, '000000.png'),
    framesPattern: path.join(framesDir, '%06d.png'),
    silentMp4: path.join('dist', key, `festival_${key}_silent.mp4`),
    finalMp4: path.join('dist', key, `festival_${key}.mp4`),
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedFormats = resolveSelectedFormats(args.formats);
  const fileUrl = toFileUrl(path.join(repoRoot, 'index.html'));
  const audioPath = path.join(repoRoot, 'sound_10s_fade.mp3');

  if (args.clean) {
    cleanOutputs();
  }

  await ensureFolders(selectedFormats);

  console.log('Milestone 7 incremental pipeline + mux audio');
  console.log('');
  console.log('Folder contract:');
  console.log('- dist/<fmt>/festival_<fmt>_silent.mp4');
  console.log('- dist/<fmt>/festival_<fmt>.mp4');
  console.log('- tmp/<fmt>/frames/%06d.png');
  console.log('');
  console.log('Flags:');
  console.log(`- clean: ${args.clean}`);
  console.log(`- force: ${args.force}`);
  console.log(`- noRender: ${args.noRender}`);
  console.log(`- noEncode: ${args.noEncode}`);
  console.log(`- noMux: ${args.noMux}`);
  console.log(`- keepFrames: ${args.keepFrames}`);

  if (!args.noMux && !fileExists(audioPath)) {
    throw new Error('Audio file missing: sound_10s_fade.mp3 at repo root.');
  }

  const summary = [];

  try {
    await assertFfmpegAvailable();

    for (const format of selectedFormats) {
      const paths = formatPathsFor(format.key);
      const formatSummary = { format: format.key, rendered: false, encoded: false, muxed: false };
      const framesDir = path.join(repoRoot, paths.framesDir);
      const firstFrame = path.join(repoRoot, paths.firstFrame);
      const silentMp4 = path.join(repoRoot, paths.silentMp4);
      const finalMp4 = path.join(repoRoot, paths.finalMp4);

      console.log(`\n[${format.key}] Starting format build...`);

      const shouldRender = !args.noRender && (args.force || !fileExists(firstFrame));
      if (args.noRender) {
        console.log(`[${format.key}] --no-render set, skipping render.`);
      } else if (shouldRender) {
        console.log(`[${format.key}] Rendering frames...`);
        await renderFrames({ format, outDir: framesDir, fileUrl });
        formatSummary.rendered = true;
      } else {
        console.log(`[${format.key}] Frames exist, skipping render.`);
      }

      const shouldEncode = !args.noEncode && (args.force || !fileExists(silentMp4));
      if (args.noEncode) {
        console.log(`[${format.key}] --no-encode set, skipping encode.`);
      } else {
        if (shouldEncode && !dirExists(framesDir)) {
          throw new Error(
            `Frames missing for ${format.key}. Run without --no-render or delete tmp/${format.key} and rebuild.`,
          );
        }
        if (shouldEncode) {
          await assertFramesReady(format.key, framesDir);
          console.log(`[${format.key}] Encoding silent MP4...`);
          await encodeSilentMp4({ format, framesDir, outPath: silentMp4 });
          console.log(`[${format.key}] Wrote ${paths.silentMp4}`);
          formatSummary.encoded = true;
        } else {
          console.log(`[${format.key}] Silent MP4 exists, skipping encode.`);
        }
      }

      const shouldMux = !args.noMux && (args.force || !fileExists(finalMp4));
      if (args.noMux) {
        console.log(`[${format.key}] --no-mux set, skipping mux.`);
      } else {
        if (shouldMux && !fileExists(silentMp4)) {
          throw new Error(
            `Silent MP4 missing for ${format.key}. Run without --no-encode or delete dist/${format.key} and rebuild.`,
          );
        }
        if (shouldMux) {
          console.log(`[${format.key}] Muxing audio...`);
          await muxAudio({ silentMp4Path: silentMp4, audioPath, outPath: finalMp4 });
          console.log(`[${format.key}] Wrote ${paths.finalMp4}`);
          formatSummary.muxed = true;
        } else {
          console.log(`[${format.key}] Final MP4 exists, skipping mux.`);
        }
      }

      summary.push(formatSummary);
    }
  } finally {
    await shutdownCapture();
  }

  if (!args.keepFrames) {
    for (const format of selectedFormats) {
      const tmpFormatDir = path.join(repoRoot, 'tmp', format.key);
      fs.rmSync(tmpFormatDir, { recursive: true, force: true });
    }
  }

  console.log('\nBuild summary:');
  for (const item of summary) {
    const renderStatus = item.rendered ? 'rendered' : 'skipped';
    const encodeStatus = item.encoded ? 'encoded' : 'skipped';
    const muxStatus = item.muxed ? 'muxed' : 'skipped';
    console.log(`- ${item.format}: render=${renderStatus}, encode=${encodeStatus}, mux=${muxStatus}`);
  }
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
