import { app } from 'electron'
import path from 'node:path'

export const ACE_STEP_DIR = 'C:\\Users\\Nickb\\Apps\\ACE-Step-1.5'
export const UV_EXE = 'C:\\Users\\Nickb\\.local\\bin\\uv.exe'
export const DEFAULT_ENGINE_PORT = 8001

export function getDoReMiPaths() {
  const musicRoot = path.join(app.getPath('music'), 'DoReMi')
  return {
    appData: app.getPath('userData'),
    musicRoot,
    songs: path.join(musicRoot, 'Songs'),
    projects: path.join(musicRoot, 'Projects'),
    exports: path.join(musicRoot, 'Exports'),
    engineArtifacts: path.join(musicRoot, 'Engine Artifacts'),
    imports: path.join(musicRoot, 'Imports'),
    covers: path.join(musicRoot, 'Covers'),
    aceImports: path.join(app.getPath('music'), 'ACE-Step', 'Songs'),
  }
}
