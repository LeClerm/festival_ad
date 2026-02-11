import { mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { FORMATS, getFormatByKey } from './formats.js';

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
    mp4: path.join('dist', key, `festival_${key}.mp4`),
    png: path.join('dist', key, `festival_${key}.png`),
    framesDir: path.join('tmp', key, 'frames'),
    framesPattern: path.join('tmp', key, 'frames', '%06d.png'),
  };
}

async function ensureAudioExists() {
  const audioPath = path.join(repoRoot, 'sound_10s_fade.mp3');
  try {
    await access(audioPath);
  } catch {
    throw new Error('Required audio file is missing: sound_10s_fade.mp3');
  }
}

async function ensureFolders(selectedFormats) {
  await mkdir(path.join(repoRoot, 'dist'), { recursive: true });
  await mkdir(path.join(repoRoot, 'tmp'), { recursive: true });

  for (const format of selectedFormats) {
    const paths = formatPathsFor(format.key);
    await mkdir(path.join(repoRoot, path.dirname(paths.mp4)), { recursive: true });
    await mkdir(path.join(repoRoot, path.dirname(paths.framesPattern)), { recursive: true });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedFormats = resolveSelectedFormats(args.formats);

  await ensureAudioExists();
  await ensureFolders(selectedFormats);

  console.log('Milestone 4 build pipeline skeleton');
  console.log('');
  console.log('Folder contract:');
  console.log('- dist/<fmt>/festival_<fmt>.mp4');
  console.log('- dist/<fmt>/festival_<fmt>.png');
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
    console.log(`  • MP4: ${paths.mp4}`);
    console.log(`  • PNG: ${paths.png}`);
    console.log(`  • Frames: ${paths.framesPattern}`);
  }

  console.log('');
  console.log(`keepFrames: ${args.keepFrames}`);
  console.log('(rendering not implemented in Milestone 4)');
}

main().catch((error) => {
  console.error(`Build planning failed: ${error.message}`);
  process.exitCode = 1;
});
