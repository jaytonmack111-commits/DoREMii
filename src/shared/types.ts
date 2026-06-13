export type EngineState = 'stopped' | 'starting' | 'running' | 'error'

export type SetupStatus = 'pass' | 'warn' | 'fail'

export type ModeType =
  | 'simple'
  | 'instrumental'
  | 'lyrics'
  | 'remix'
  | 'repaint'
  | 'cover'
  | 'extend'
  | 'complete'
  | 'extract'

export type PerformancePreset =
  | 'fast_draft'
  | 'balanced'
  | 'high_quality'
  | 'experimental'

export type DurationMode = 'sample' | 'loop' | 'song' | 'auto'

export type LmModelId =
  | 'acestep-5Hz-lm-0.6B'
  | 'acestep-5Hz-lm-1.7B'
  | 'acestep-5Hz-lm-4B'

export interface EngineSettings {
  preferredLmModel: LmModelId
  lmBackend: 'vllm' | 'pt' | 'mlx'
  lmOffloadToCpu: boolean
  experimentalForce4B: boolean
  writerRoomModel: string
  lyricWriterModel: string
}

export interface LocalModelInfo {
  id: string
  role: string
  currentModel: string
  preferredModel: string | null
  loaded: boolean
  diskPath: string
  exists: boolean
  sizeLabel: string
  backend: string
  device: string
  offload: string
  affects: string
  editable: boolean
  warning: string | null
}

export interface BlueprintResult {
  id: string
  query: string
  caption: string
  lyrics: string
  bpm: number | null
  keyscale: string
  duration: number | null
  timesignature: string
  vocalLanguage: string
  instrumental: boolean
  lmModel: string | null
  raw: unknown
  createdAt: string
}

export interface SongIntent {
  songTitle: string
  rawIdea: string
  idea: string
  styleCaption: string
  tags: string[]
  presetPack: string | null
  vocalMode: 'vocals' | 'instrumental'
  language: string
  durationMode: DurationMode
  durationMin: number
  durationMax: number
  structure: string[]
  negativePrompt: string
  currentLyrics: string
  blueprintCaption: string
  blueprintLyrics: string
  flags: {
    userLockedIdea: boolean
    styleDerivedFromIdea: boolean
    lyricsApproved: boolean
  }
}

export interface LyricsCraftResult {
  lyrics: string
  draft: string
  critique: string
  quality: LyricsQualityReport
  model: string
  createdAt: string
}

export interface LyricsQualityReport {
  score: number
  verdict: 'pass' | 'needs_work' | 'fail'
  summary: string
  issues: string[]
  strengths: string[]
  structure: {
    sections: string[]
    expectedSections?: string[]
    missingSections?: string[]
    sungLineCount: number
    hasVerse1: boolean
    hasVerse2: boolean
    hasChorus: boolean
    hasBridge: boolean
    hasOutro: boolean
  }
  metrics?: {
    promptMatch: number
    structure: number
    singability: number
    rhymeFlow: number
    hookStrength: number
    originality: number
    languageMatch: number
    genreFit: number
    repetition: number
    engineSafety: number
  }
  topicLock?: {
    requiredTerms: string[]
    matchedTerms: string[]
    missingTerms: string[]
    forbiddenDrift: string[]
  }
  semanticAdherence?: {
    score: number
    verdict: 'pass' | 'needs_work' | 'fail'
    notes: string[]
  }
  modelCritique: string | null
}

export interface WriterAvailability {
  available: boolean
  model: string
  reason: string | null
}

export interface RoomAgent {
  id: string
  name: string
  emoji: string
  specialty: string
  persona: string
  model?: string
  role?: 'coordinator' | 'specialist' | 'engine'
}

export interface RoomMessage {
  id: string
  at: string
  agentId: string
  name: string
  emoji?: string
  /** chat = normal bubble · status = system line (joins, searches) · final = compiled lyrics */
  kind: 'chat' | 'status' | 'final'
  content: string
  thinking?: string | null
}

export interface RoomState {
  id: string
  model: string
  agents: RoomAgent[]
  messages: RoomMessage[]
}

export interface EngineStatus {
  state: EngineState
  pid: number | null
  port: number
  health: 'unknown' | 'warming' | 'ready' | 'unreachable'
  loadedModel: string | null
  loadedLmModel: string | null
  queueSize: number | null
  lastLogLine: string | null
  lastError: string | null
  startedByDoReMi: boolean
}

export interface SetupCheck {
  id: string
  label: string
  status: SetupStatus
  detail: string
}

export interface SetupCheckResult {
  ready: boolean
  checks: SetupCheck[]
  folders: {
    appData: string
    musicRoot: string
    songs: string
    projects: string
    exports: string
    engineArtifacts: string
    imports: string
  }
}

export interface GenerationRequest {
  title: string
  mode: ModeType
  prompt: string
  lyrics: string
  structure: string[]
  negativePrompt: string
  language: string
  duration: number
  durationMode: DurationMode
  durationMin: number
  durationMax: number
  batchSize: number
  seed: number | null
  model: string | null
  performancePreset: PerformancePreset
  sourceAudioPath: string | null
  blueprint: BlueprintResult | null
  // Optional advanced/pro overrides; undefined means "use the preset default".
  guidanceScale?: number
  inferenceSteps?: number
  lmTemperature?: number
  lmTopP?: number
  repetitionPenalty?: number
  constrainedDecoding?: boolean
  styleHints?: string
}

export interface GenerationTask {
  id: string
  aceTaskId: string | null
  status: string
  progress: number | null
  progressText?: string | null
  request: GenerationRequest
  result: unknown
  error: string | null
  createdAt: string
  completedAt: string | null
}

export interface SongVersion {
  id: string
  projectId: string | null
  title: string
  mode: ModeType
  prompt: string
  lyrics: string
  audioPath: string
  metadataPath: string | null
  favorite: boolean
  createdAt: string
}

export interface GenerationPollResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress: number | null
  progressText: string | null
  error: string | null
  songs: SongVersion[]
}

export interface Preset {
  id: string
  name: string
  category: string
  mode: ModeType
  description: string
}

export interface LicenseNotice {
  packageName: string
  licenseName: string
  noticeText: string
}

export interface DoReMiApi {
  setZoom: (factor: number) => void
  runSetupCheck: () => Promise<SetupCheckResult>
  getEngineStatus: () => Promise<EngineStatus>
  startEngine: () => Promise<EngineStatus>
  stopEngine: () => Promise<EngineStatus>
  restartEngine: () => Promise<EngineStatus>
  getEngineLogs: () => Promise<string[]>
  getEngineSettings: () => Promise<EngineSettings>
  updateEngineSettings: (settings: Partial<EngineSettings>) => Promise<EngineSettings>
  getLocalModels: () => Promise<LocalModelInfo[]>
  reloadPreferredLm: () => Promise<EngineStatus>
  openModelFolder: (modelId: string) => Promise<void>
  downloadModel: (modelId: string) => Promise<string>
  searchLibrary: () => Promise<SongVersion[]>
  renameSong: (id: string, title: string) => Promise<SongVersion[]>
  toggleSongFavorite: (id: string) => Promise<SongVersion[]>
  deleteSong: (id: string) => Promise<SongVersion[]>
  showSongInFolder: (id: string) => Promise<void>
  getPresets: () => Promise<Preset[]>
  getLicenses: () => Promise<LicenseNotice[]>
  createGeneration: (request: GenerationRequest) => Promise<GenerationTask>
  createBlueprint: (request: {
    query: string
    instrumental: boolean
    vocalLanguage: string
    tags: string[]
  }) => Promise<BlueprintResult>
  pollGeneration: (aceTaskId: string, meta: { title: string; mode: ModeType }) => Promise<GenerationPollResult>
  formatInput: (input: { caption: string; lyrics: string; duration?: number; language?: string }) => Promise<{
    caption: string
    lyrics: string
    bpm: number | null
    keyscale: string
    timesignature: string
    duration: number | null
    vocalLanguage: string
  } | null>
  getWriterAvailability: () => Promise<WriterAvailability>
  listWriterModels: () => Promise<string[]>
  pullOllamaModel: (model: string) => Promise<string>
  craftLyrics: (input: {
    idea: string
    tags: string[]
    language: string
    structure: string[]
    existingLyrics?: string
    model?: string
    intent?: SongIntent
  }) => Promise<LyricsCraftResult>
  analyzeLyrics: (input: { lyrics: string; idea?: string; model?: string; intent?: SongIntent }) => Promise<LyricsQualityReport>
  enhanceText: (input: { kind: 'style' | 'idea' | 'lyrics'; text: string; tags?: string[]; model?: string; think?: boolean }) => Promise<string>
  suggestTitle: (input: { lyrics: string; idea?: string; model?: string }) => Promise<string>
  generateConcept: (input?: { think?: boolean; model?: string }) => Promise<{ title: string; idea: string; style: string }>
  rewriteLyrics: (input: { lyrics: string; idea?: string; instruction: string; model?: string; intent?: SongIntent }) => Promise<LyricsCraftResult>
  startWritersRoom: (input: { idea: string; tags: string[]; lyrics: string; caption: string; model?: string; intent?: SongIntent }) => Promise<RoomState>
  sendToWritersRoom: (text: string) => Promise<RoomState>
  endWritersRoom: () => Promise<void>
  onRoomMessage: (handler: (message: RoomMessage) => void) => () => void
  onRoomAgents: (callback: (agents: RoomAgent[]) => void) => () => void
  onRoomTyping: (callback: (agent: RoomAgent | null) => void) => () => void
  onWriterProgress: (callback: (stage: string) => void) => () => void
}
