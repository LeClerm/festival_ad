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

function parseArgs(argv) {
  const parsed = {
    formats: null,
    keepFrames: false,
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

    if (arg === '--keep-frames') {
      parsed.keepFrames = true;
    }
  }

  return parsed;
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
  return {
    silentMp4: path.join('dist', key, `festival_${key}_silent.mp4`),
    finalMp4: path.join('dist', key, `festival_${key}.mp4`),
    framesDir: path.join('tmp', key, 'frames'),
    framesPattern: path.join('tmp', key, 'frames', '%06d.png'),
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
      `Frames not found for ${formatKey}. Run build without --no-frames (or ensure rendering succeeded).`,
    );
  }
}

async function ensureFolders(selectedFormats) {
  await mkdir(path.join(repoRoot, 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'tmp'), { recursive: true });

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    await mkdir(path.join(repoRoot, path.dirname(paths.silentMp4)), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, paths.framesDir), { recursive: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedFormats = resolveSelectedFormats(args.formats);
  const fileUrl = toFileUrl(path.join(repoRoot, 'index.html'));

  await ensureFolders(selectedFormats);

  console.log('Milestone 7 frame render + MP4 encode + audio mux');
  console.log('');
  console.log('Folder contract:');
  console.log('- dist/<fmt>/festival_<fmt>_silent.mp4');
  console.log('- dist/<fmt>/festival_<fmt>.mp4');
  console.log('- tmp/<fmt>/frames/%06d.png');
  console.log('');
  console.log('Selected formats:');

  for (const format of selectedFormats) {
    console.log(
      `- ${format.key}: ${format.width}x${format.height}, ${format.fps} fps, ${format.duration.toFixed(1)}s`,
    );
  }

  console.log('');
  console.log('Planned outputs:');

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    console.log(`- ${format.key}`);
    console.log(`  • Silent MP4: ${paths.silentMp4}`);
    console.log(`  • Final MP4: ${paths.finalMp4}`);
    console.log(`  • Frames: ${paths.framesPattern}`);
  }

  console.log('');
  console.log(`keepFrames: ${args.keepFrames}`);

  try {
    for (const format of selectedFormats) {
      const paths = formatPathsFor(format.key);
      const outDir = path.join(repoRoot, paths.framesDir);
      fs.mkdirSync(outDir, { recursive: true });
      await renderFrames({ format, outDir, fileUrl });
    }

    await assertFfmpegAvailable();

    for (const format of selectedFormats) {
      const paths = formatPathsFor(format.key);
      const framesDir = path.join(repoRoot, paths.framesDir);
      const silentOutPath = path.join(repoRoot, paths.silentMp4);
      const finalOutPath = path.join(repoRoot, paths.finalMp4);
      const audioPath = path.join(repoRoot, 'sound_10s_fade.mp3');

      await assertFramesReady(format.key, framesDir);

      console.log(`[${format.key}] Encoding silent MP4...`);
      await encodeSilentMp4({ format, framesDir, outPath: silentOutPath });
      console.log(`[${format.key}] Wrote ${paths.silentMp4}`);

      console.log(`[${format.key}] Muxing audio...`);
      await muxAudio({
        silentMp4Path: silentOutPath,
        audioPath,
        outPath: finalOutPath,
      });
      console.log(`[${format.key}] Wrote ${paths.finalMp4}`);
    }
  } finally {
    await shutdownCapture();
  }
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
