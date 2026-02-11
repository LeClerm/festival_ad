import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.stdio ?? 'pipe',
      shell: options.shell ?? false,
      ...options,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on('error', (error) => {
      reject(
        new Error(`Failed to start command: ${command} ${args.join(' ')}\n${error.message}`),
      );
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }

      reject(
        new Error(
          `Command failed (${code}): ${command} ${args.join(' ')}\n${stderr || stdout}`,
        ),
      );
    });
  });
}

export async function isFfmpegAvailable() {
  try {
    await runCommand('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export async function assertFfmpegAvailable() {
  try {
    await runCommand('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg not found on PATH. Install ffmpeg and restart terminal.');
  }
}

function normalizeForFfmpeg(filePath) {
  return filePath.split(path.sep).join('/');
}

export async function encodeSilentMp4({ format, framesDir, outPath }) {
  await mkdir(path.dirname(outPath), { recursive: true });

  const inputPattern = `${normalizeForFfmpeg(framesDir)}/%06d.png`;

  const args = [
    '-y',
    '-framerate',
    String(format.fps),
    '-i',
    inputPattern,
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-crf',
    '18',
    outPath,
  ];

  await runCommand('ffmpeg', args);
}

export async function muxAudio({ silentMp4Path, audioPath, outPath }) {
  await mkdir(path.dirname(outPath), { recursive: true });

  const args = [
    '-y',
    '-i',
    silentMp4Path,
    '-i',
    audioPath,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath,
  ];

  await runCommand('ffmpeg', args);
}
