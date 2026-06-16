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

/** Which heavy AI brain is currently active (VRAM conductor). */
export type ConductorState = 'idle' | 'writer' | 'engine' | 'cover'

export type ResourceMode = 'keep_usable' | 'balanced' | 'max_quality' | 'manual'

export type CoverArtStatus = 'none' | 'queued' | 'generating' | 'ready' | 'failed' | 'procedural'

export type LyricStrictness = 'relaxed' | 'normal' | 'strict' | 'pro'

export type OllamaContextPreset = 'standard' | 'long' | 'experimental'
/** fast = single focused pass (~1 call). standard = draft + light critic.
 *  deep = multi-round critic. unbounded = cook until it passes (slow). */
export type LyricCookMode = 'fast' | 'standard' | 'deep' | 'unbounded'

export interface EngineSettings {
  preferredLmModel: LmModelId
  lmBackend: 'vllm' | 'pt' | 'mlx'
  lmOffloadToCpu: boolean
  experimentalForce4B: boolean
  writerRoomModel: string
  lyricWriterModel: string
  ideaWriterModel?: string
  hookWriterModel?: string
  sectionWriterModel?: string
  criticModel?: string
  prosodyModel?: string
  finalCompilerModel?: string
  ollamaContextPreset?: OllamaContextPreset
  lyricCookMode?: LyricCookMode
  /** Set once the writer pipeline is migrated to the fast-by-default models. */
  writerPipelineV2?: boolean
  resourceMode: ResourceMode
  fluxBackendPath: string
  coverResolution: '512' | '768' | '1024'
  coverStylePreset: 'auto' | 'cinematic' | 'graphic_poster' | 'portrait' | 'abstract' | 'object_still_life'
  genreFusionEnabled: boolean
  randomIdeaWeirdness: number
  lyricPlanningStrictness: LyricStrictness
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
  brief?: SongBrief | null
  hooks?: HookCandidate[]
  sections?: SectionDraft[]
  plan?: LyricPlan | null
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
  brief?: SongBrief
  plan?: LyricPlan
  hooks?: HookCandidate[]
  sections?: SectionDraft[]
  repairs?: string[]
  lyrics: string
  draft: string
  drafts?: LyricsDraftSnapshot[]
  critique: string
  quality: LyricsQualityReport
  model: string
  createdAt: string
}

export interface SongBrief {
  premise: string
  narrator: string
  listenerSituation: string
  emotionalConflict: string
  hookPromise: string
  verse1Purpose: string
  verse2Escalation: string
  bridgeReveal: string
  outroResolution: string
  forbiddenDrift: string[]
  concreteImages: string[]
  quality: {
    relatability: number
    hookPotential: number
    genreFit: number
    specificity: number
    groundedness: number
    songShapeReadiness: number
    issues: string[]
  }
  createdAt: string
}

export interface HookCandidate {
  id: string
  label: string
  lines: string[]
  score: number
  scores: {
    titlePayoff: number
    singability: number
    memorability: number
    emotionalClarity: number
    topicMatch: number
    rhymePotential: number
  }
  notes: string[]
  selected?: boolean
}

export interface SectionDraft {
  section: string
  lyrics: string
  score: number
  verdict: 'keep' | 'rewrite' | 'cut' | 'expand'
  purpose: string
  repairReason?: string
  lockedLines?: string[]
}

export interface LyricPlanSection {
  section: string
  purpose: string
  lineCount: number
  rhymeScheme: string
  syllableMin: number
  syllableMax: number
  mustDo: string[]
  avoid: string[]
}

export interface LyricPlan {
  songPremise: string
  emotionalAngle: string
  relatableListenerSituation: string
  pointOfView: string
  vibe: string
  genre: string
  genreFusion: string | null
  hookPhraseTarget: string
  forbiddenDriftWords: string[]
  sectionGoals: LyricPlanSection[]
  createdAt: string
}

export interface LyricsDraftSnapshot {
  id: string
  label: string
  lyrics: string
  note: string
  createdAt: string
  quality?: LyricsQualityReport | null
  previousLyrics?: string | null
}

export interface WriterProgressEvent {
  stage: string
  note?: string
  draft?: LyricsDraftSnapshot
  brief?: SongBrief
  hooks?: HookCandidate[]
  section?: SectionDraft
  repair?: string
}

export interface LyricsQualityReport {
  score: number
  verdict: 'pass' | 'needs_work' | 'fail'
  generationGate?: {
    status: 'draft' | 'needs_repair' | 'ready_for_ace' | 'pro_override'
    ready: boolean
    reasons: string[]
  }
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
  prosody?: {
    averageSyllables: number
    outlierLines: string[]
    fourBarWarnings: string[]
    nurseryRhymeWarnings: string[]
    lineStats?: {
      section: string
      line: string
      syllables: number
      endRhyme: string
      internalEchoes: string[]
    }[]
    endRhymeMap?: Record<string, string[]>
    internalRhymeHints?: string[]
  }
  sectionScores?: {
    section: string
    score: number
    verdict: 'keep' | 'rewrite' | 'cut' | 'expand'
    notes: string[]
  }[]
  lineDecisions?: {
    section: string
    lineNumber: number
    text: string
    decision: 'keep' | 'rewrite' | 'cut' | 'expand'
    reasons: string[]
    syllables: number
    endRhyme: string
  }[]
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
  planCompliance?: {
    rhymeScheme: 'pass' | 'needs_work' | 'fail'
    syllablePlan: 'pass' | 'needs_work' | 'fail'
    relatabilityScore: number
    vibeMatch: 'pass' | 'needs_work' | 'fail'
    issues: string[]
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
    covers: string
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
  coverArtPath: string | null
  coverArtStatus: CoverArtStatus
  favorite: boolean
  createdAt: string
}

export interface CoverArtRequest {
  songId?: string
  title: string
  caption: string
  lyrics: string
  tags: string[]
  bpm?: number | null
  keyscale?: string | null
  duration?: number | null
  forceFlux?: boolean
}

export interface CoverArtResult {
  songId?: string
  status: CoverArtStatus
  coverArtPath: string | null
  prompt: string
  backend: string
  error: string | null
}

export interface ResourceStatus {
  mode: ResourceMode
  conductor: ConductorState
  ace: EngineStatus
  ollamaLoadedModels: string[]
  flux: {
    configured: boolean
    status: 'missing' | 'configured' | 'running' | 'failed'
    backendPath: string
    lastError: string | null
  }
  estimatedPressure: 'low' | 'medium' | 'high'
  owner: ConductorState
}

export interface ModelHealthProbe {
  id: string
  role: string
  installed: boolean
  loadable: boolean
  currentlyLoaded: boolean
  failedLastRun: boolean
  fallbackActive: boolean
  message: string
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
  cleanupLocalWorkers: () => Promise<EngineStatus>
  getEngineLogs: () => Promise<string[]>
  getEngineSettings: () => Promise<EngineSettings>
  updateEngineSettings: (settings: Partial<EngineSettings>) => Promise<EngineSettings>
  getLocalModels: () => Promise<LocalModelInfo[]>
  reloadPreferredLm: () => Promise<EngineStatus>
  openModelFolder: (modelId: string) => Promise<void>
  downloadModel: (modelId: string) => Promise<string>
  test4BModels: () => Promise<ModelHealthProbe[]>
  getResourceStatus: () => Promise<ResourceStatus>
  setResourceMode: (mode: ResourceMode) => Promise<ResourceStatus>
  searchLibrary: () => Promise<SongVersion[]>
  renameSong: (id: string, title: string) => Promise<SongVersion[]>
  toggleSongFavorite: (id: string) => Promise<SongVersion[]>
  deleteSong: (id: string) => Promise<SongVersion[]>
  showSongInFolder: (id: string) => Promise<void>
  generateCover: (request: CoverArtRequest) => Promise<CoverArtResult>
  getCoverStatus: (songId?: string) => Promise<CoverArtResult | null>
  cancelCover: (songId?: string) => Promise<void>
  openCoverFolder: () => Promise<void>
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
  releaseEngineJob: () => Promise<void>
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
  cancelWriter: () => Promise<{ canceled: boolean }>
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
  generateConceptIdea: (input?: { think?: boolean; model?: string }) => Promise<{ title: string; idea: string }>
  generateStyleForIdea: (input: { title?: string; idea: string; tags?: string[]; model?: string; think?: boolean }) => Promise<string>
  getConductorState: () => Promise<ConductorState>
  onConductorState: (callback: (state: ConductorState) => void) => () => void
  rewriteLyrics: (input: { lyrics: string; idea?: string; instruction: string; model?: string; intent?: SongIntent }) => Promise<LyricsCraftResult>
  startWritersRoom: (input: { idea: string; tags: string[]; lyrics: string; caption: string; model?: string; intent?: SongIntent }) => Promise<RoomState>
  sendToWritersRoom: (text: string) => Promise<RoomState>
  endWritersRoom: () => Promise<void>
  onRoomMessage: (handler: (message: RoomMessage) => void) => () => void
  onRoomAgents: (callback: (agents: RoomAgent[]) => void) => () => void
  onRoomTyping: (callback: (agent: RoomAgent | null) => void) => () => void
  onWriterProgress: (callback: (event: WriterProgressEvent) => void) => () => void
}
