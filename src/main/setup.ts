import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ACE_STEP_DIR, UV_EXE, getDoReMiPaths } from './paths.js'
import type { SetupCheck, SetupCheckResult } from '../shared/types.js'

const execFileAsync = promisify(execFile)

function check(id: string, label: string, ok: boolean, detail: string, warn = false): SetupCheck {
  return { id, label, status: ok ? 'pass' : warn ? 'warn' : 'fail', detail }
}

export async function runSetupCheck(): Promise<SetupCheckResult> {
  const folders = getDoReMiPaths()
  for (const folder of [folders.musicRoot, folders.songs, folders.projects, folders.exports, folders.engineArtifacts, folders.imports]) {
    fs.mkdirSync(folder, { recursive: true })
  }

  const checks: SetupCheck[] = []
  checks.push(check('ace-path', 'Local engine folder', fs.existsSync(`${ACE_STEP_DIR}\\pyproject.toml`), ACE_STEP_DIR))
  checks.push(check('uv', 'uv package manager', fs.existsSync(UV_EXE), UV_EXE))
  checks.push(check('venv', 'Python environment', fs.existsSync(`${ACE_STEP_DIR}\\.venv`), `${ACE_STEP_DIR}\\.venv`))
  checks.push(check('main-model', 'Main model checkpoint', fs.existsSync(`${ACE_STEP_DIR}\\checkpoints\\acestep-v15-turbo`), 'acestep-v15-turbo'))
  checks.push(check('lm-model', 'Language model checkpoint', fs.existsSync(`${ACE_STEP_DIR}\\checkpoints\\acestep-5Hz-lm-0.6B`), 'acestep-5Hz-lm-0.6B', true))
  checks.push(check('folders', 'DoReMi output folders', fs.existsSync(folders.songs), folders.musicRoot))

  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], { timeout: 8000 })
    checks.push(check('cuda', 'CUDA GPU', true, stdout.trim()))
  } catch {
    checks.push(check('cuda', 'CUDA GPU', false, 'nvidia-smi was not reachable', true))
  }

  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 8000 })
    checks.push(check('ffmpeg', 'FFmpeg', true, 'ffmpeg is available on PATH'))
  } catch {
    const wingetFfmpeg = `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe`
    checks.push(check('ffmpeg', 'FFmpeg', fs.existsSync(wingetFfmpeg), fs.existsSync(wingetFfmpeg) ? wingetFfmpeg : 'ffmpeg is missing', true))
  }

  return {
    ready: checks.every((item) => item.status !== 'fail'),
    checks,
    folders: {
      appData: folders.appData,
      musicRoot: folders.musicRoot,
      songs: folders.songs,
      projects: folders.projects,
      exports: folders.exports,
      engineArtifacts: folders.engineArtifacts,
      imports: folders.imports,
    },
  }
}
