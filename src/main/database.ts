import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import { getDoReMiPaths } from './paths.js'
import type { EngineSettings, GenerationTask, LicenseNotice, Preset, SongVersion } from '../shared/types.js'

let db: Database.Database | null = null

export function getDatabase() {
  if (db) return db
  const paths = getDoReMiPaths()
  fs.mkdirSync(paths.appData, { recursive: true })
  db = new Database(path.join(paths.appData, 'doremi.sqlite'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  seed(db)
  return db
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engine_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      active_preset_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS song_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      prompt TEXT NOT NULL,
      lyrics TEXT NOT NULL,
      vocal_language TEXT NOT NULL DEFAULT 'en',
      seed INTEGER,
      duration REAL,
      bpm INTEGER,
      key_scale TEXT,
      time_signature TEXT,
      model TEXT,
      lm_model TEXT,
      performance_preset TEXT,
      request_json TEXT,
      response_json TEXT,
      audio_path TEXT NOT NULL,
      metadata_path TEXT,
      source_task_id TEXT,
      parent_song_id TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_items (
      collection_id TEXT NOT NULL,
      song_version_id TEXT NOT NULL,
      PRIMARY KEY (collection_id, song_version_id)
    );
    CREATE TABLE IF NOT EXISTS presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL,
      description TEXT NOT NULL,
      config_json TEXT NOT NULL,
      user_created INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS generation_tasks (
      id TEXT PRIMARY KEY,
      ace_task_id TEXT,
      status TEXT NOT NULL,
      progress REAL,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS patch_records (
      id TEXT PRIMARY KEY,
      patch_name TEXT NOT NULL,
      target_description TEXT NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0,
      backup_path TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS license_records (
      id TEXT PRIMARY KEY,
      package_name TEXT NOT NULL,
      license_name TEXT NOT NULL,
      notice_text TEXT NOT NULL
    );
  `)
}

function seed(database: Database.Database) {
  const count = database.prepare('SELECT COUNT(*) AS count FROM presets').get() as { count: number }
  if (count.count === 0) {
    const now = new Date().toISOString()
    const presets: Preset[] = [
      { id: 'pop-hook', name: 'Radio Pop Hook', category: 'Pop', mode: 'simple', description: 'Bright chorus, clean vocal, memorable hook.' },
      { id: 'sea-shanty', name: 'Sea Shanty', category: 'Folk', mode: 'lyrics', description: 'Call-and-response maritime energy with stomps.' },
      { id: 'boss-fight', name: 'Boss Fight Theme', category: 'Cinematic', mode: 'instrumental', description: 'Huge drums, aggressive brass, rising tension.' },
      { id: 'lofi-study', name: 'Lo-Fi Study Loop', category: 'Lo-Fi', mode: 'instrumental', description: 'Warm keys, dusty drums, relaxed loop.' },
      { id: 'synthwave-drive', name: 'Synthwave Drive', category: 'Electronic', mode: 'simple', description: 'Retro arps, gated drums, night-drive mood.' },
    ]
    const insert = database.prepare(`
      INSERT INTO presets (id, name, category, mode, description, config_json, user_created, created_at)
      VALUES (@id, @name, @category, @mode, @description, @config_json, 0, @created_at)
    `)
    for (const preset of presets) {
      insert.run({ ...preset, config_json: JSON.stringify(preset), created_at: now })
    }
  }

  const now = new Date().toISOString()
  const settingCount = database.prepare('SELECT COUNT(*) AS count FROM settings WHERE key = ?').get('engine') as { count: number }
  if (settingCount.count === 0) {
    const defaults: EngineSettings = {
      preferredLmModel: 'acestep-5Hz-lm-4B',
      lmBackend: 'pt',
      lmOffloadToCpu: true,
      experimentalForce4B: true,
      writerRoomModel: 'qwen3:4b',
      lyricWriterModel: 'qwen3:8b',
    }
    database.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run('engine', JSON.stringify(defaults), now)
  }

  const licenseCount = database.prepare('SELECT COUNT(*) AS count FROM license_records').get() as { count: number }
  if (licenseCount.count === 0) {
    const notice = 'ACE-Step is copyrighted software released under the MIT License. DoReMi uses ACE-Step as a local engine dependency and preserves the required MIT license notice.'
    database.prepare(`
      INSERT INTO license_records (id, package_name, license_name, notice_text)
      VALUES ('ace-step', 'ACE-Step', 'MIT', ?)
    `).run(notice)
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDatabase()
    .prepare('SELECT value_json FROM settings WHERE key = ?')
    .get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return { ...fallback, ...JSON.parse(row.value_json) }
  } catch {
    return fallback
  }
}

export function setSetting<T>(key: string, value: T): T {
  getDatabase()
    .prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (@key, @valueJson, @updatedAt)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `)
    .run({ key, valueJson: JSON.stringify(value), updatedAt: new Date().toISOString() })
  return value
}

export function listSongs(): SongVersion[] {
  return getDatabase()
    .prepare('SELECT id, project_id as projectId, title, mode, prompt, lyrics, audio_path as audioPath, metadata_path as metadataPath, favorite, created_at as createdAt FROM song_versions ORDER BY created_at DESC')
    .all()
    .map((row) => {
      const song = row as SongVersion & { favorite: number | boolean }
      return { ...song, favorite: Boolean(song.favorite) }
    })
}

export function renameSong(id: string, title: string): SongVersion[] {
  const cleanTitle = title.trim()
  if (!cleanTitle) throw new Error('Song title cannot be empty')
  getDatabase()
    .prepare('UPDATE song_versions SET title = ? WHERE id = ?')
    .run(cleanTitle, id)
  return listSongs()
}

export function toggleSongFavorite(id: string): SongVersion[] {
  getDatabase()
    .prepare('UPDATE song_versions SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?')
    .run(id)
  return listSongs()
}

export function getSongById(id: string): SongVersion | null {
  return listSongs().find((song) => song.id === id) ?? null
}

export function deleteSong(id: string): SongVersion[] {
  const song = getSongById(id)
  if (!song) return listSongs()
  getDatabase().transaction(() => {
    getDatabase().prepare('DELETE FROM collection_items WHERE song_version_id = ?').run(id)
    getDatabase().prepare('DELETE FROM song_versions WHERE id = ?').run(id)
  })()
  for (const filePath of [song.audioPath, song.metadataPath].filter(Boolean)) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath)
    } catch {
      // Leave the database delete intact even if Windows has the file locked.
    }
  }
  return listSongs()
}

export async function showSongInFolder(id: string) {
  const song = getSongById(id)
  if (!song?.audioPath) throw new Error('Song file not found in library')
  await shell.showItemInFolder(song.audioPath)
}

export interface InsertSongInput {
  id: string
  title: string
  mode: string
  prompt: string
  lyrics: string
  vocalLanguage: string
  duration: number | null
  bpm: number | null
  keyScale: string | null
  audioPath: string
  sourceTaskId: string | null
  requestJson: string | null
  responseJson: string | null
  createdAt: string
}

export function insertSong(row: InsertSongInput) {
  getDatabase()
    .prepare(`
      INSERT INTO song_versions (
        id, project_id, title, mode, prompt, lyrics, vocal_language, seed, duration, bpm,
        key_scale, time_signature, model, lm_model, performance_preset, request_json,
        response_json, audio_path, metadata_path, source_task_id, parent_song_id, favorite, created_at
      ) VALUES (
        @id, NULL, @title, @mode, @prompt, @lyrics, @vocalLanguage, NULL, @duration, @bpm,
        @keyScale, NULL, NULL, NULL, NULL, @requestJson,
        @responseJson, @audioPath, NULL, @sourceTaskId, NULL, 0, @createdAt
      )
    `)
    .run(row)
}

export function listPresets(): Preset[] {
  return getDatabase()
    .prepare('SELECT id, name, category, mode, description FROM presets ORDER BY category, name')
    .all() as Preset[]
}

export function listLicenses(): LicenseNotice[] {
  return getDatabase()
    .prepare('SELECT package_name as packageName, license_name as licenseName, notice_text as noticeText FROM license_records ORDER BY package_name')
    .all() as LicenseNotice[]
}

export function insertGenerationTask(task: GenerationTask) {
  getDatabase()
    .prepare(`
      INSERT INTO generation_tasks (
        id, ace_task_id, status, progress, request_json, result_json, error, created_at, completed_at
      ) VALUES (
        @id, @aceTaskId, @status, @progress, @requestJson, @resultJson, @error, @createdAt, @completedAt
      )
    `)
    .run({
      id: task.id,
      aceTaskId: task.aceTaskId,
      status: task.status,
      progress: task.progress,
      requestJson: JSON.stringify(task.request),
      resultJson: task.result == null ? null : JSON.stringify(task.result),
      error: task.error,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    })
}

export function updateGenerationTask(id: string, patch: Partial<Pick<GenerationTask, 'aceTaskId' | 'status' | 'progress' | 'result' | 'error' | 'completedAt'>>) {
  const existing = getDatabase()
    .prepare('SELECT * FROM generation_tasks WHERE id = ?')
    .get(id) as {
      ace_task_id: string | null
      status: string
      progress: number | null
      result_json: string | null
      error: string | null
      completed_at: string | null
    } | undefined
  if (!existing) return

  getDatabase()
    .prepare(`
      UPDATE generation_tasks
      SET ace_task_id = @aceTaskId,
          status = @status,
          progress = @progress,
          result_json = @resultJson,
          error = @error,
          completed_at = @completedAt
      WHERE id = @id
    `)
    .run({
      id,
      aceTaskId: patch.aceTaskId ?? existing.ace_task_id,
      status: patch.status ?? existing.status,
      progress: patch.progress ?? existing.progress,
      resultJson: patch.result === undefined ? existing.result_json : JSON.stringify(patch.result),
      error: patch.error ?? existing.error,
      completedAt: patch.completedAt ?? existing.completed_at,
    })
}
