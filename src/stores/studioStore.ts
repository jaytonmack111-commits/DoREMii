import { create } from 'zustand'
import type { BlueprintResult, DurationMode, GenerationPollResult, GenerationTask, LyricsCraftResult, LyricsDraftSnapshot, LyricsQualityReport, ModeType, PerformancePreset, SongIntent, WriterProgressEvent } from '../shared/types'
import { GENRES, MODE_LIBRARY, VIBES } from '../lib/constants'
import { useAppStore } from './appStore'
import { usePlayerStore } from './playerStore'
import { useUiStore } from './uiStore'

export type VocalMode = 'vocals' | 'instrumental'
export type LyricsTab = 'write' | 'prompt' | 'instrumental'
/** How much of the studio is exposed: quick one-box flow, the standard set, or everything. */
export type DetailTier = 'simple' | 'advanced' | 'pro'
export type StudioTab = 'idea' | 'blueprint' | 'setup'
/** AI actions that share the local writer and must run one at a time. */
export type QueueKind = 'enhanceWords' | 'enhanceStyle' | 'generateBlueprint'

interface StudioStore {
  tier: DetailTier
  songTitle: string
  styleText: string
  songIdea: string
  lyrics: string
  lyricsTab: LyricsTab
  vocalMode: VocalMode
  creationMode: ModeType
  language: string
  styleStrength: number
  durationMode: DurationMode
  durationMin: number
  durationMax: number
  duration: number
  performance: PerformancePreset
  variations: number
  bpm: number | ''
  musicKey: string
  seed: number | null
  negativePrompt: string
  pickedGenres: string[]
  pickedVibes: string[]
  pickedVocals: string[]
  pickedInstruments: string[]
  pickedDrums: string[]
  pickedProduction: string[]
  pickedEras: string[]
  pickedCustomTags: string[]
  pickedStructure: string[]
  tagFilter: string
  customTagInput: string
  blueprint: BlueprintResult | null
  blueprintStatus: 'idle' | 'generating' | 'ready' | 'accepted' | 'error'
  blueprintError: string | null
  lyricsCraft: LyricsCraftResult | null
  lyricsQuality: LyricsQualityReport | null
  lyricsQualityBusy: boolean
  lyricsRewriteBusy: boolean
  enhanceStyleBusy: boolean
  enhanceWordsBusy: boolean
  titleBusy: boolean
  writerStage: string | null
  blueprintNotes: string[]
  blueprintStartedAt: number | null
  writerStageStartedAt: number | null
  blueprintDrafts: LyricsDraftSnapshot[]
  /** 'auto' = strongest installed Ollama model; 'engine' = ACE's small LM only. */
  writerModel: string
  writerModels: string[]
  /** 1 (quick) .. 5 (deep) - controls whether the writer AIs think before answering. */
  thinkingPower: number
  // Simple-tier shaping (feeds the prompt, no engine params needed)
  energy: 'chill' | 'balanced' | 'hype'
  vocalGender: 'any' | 'male' | 'female'
  tempoFeel: 'slow' | 'medium' | 'fast' | 'auto'
  // Advanced/Pro engine overrides
  guidanceScale: number
  inferenceSteps: number
  lmTemperature: number
  lmTopP: number
  repetitionPenalty: number
  constrainedDecoding: boolean
  conceptBusy: boolean
  // Which Studio tab is active (in the store so the action queue can navigate).
  activeTab: StudioTab
  // AI actions waiting to run, in order. Only one runs at a time so they don't
  // fight over the writer. Re-queuing a pending kind cancels it.
  actionQueue: QueueKind[]
  runningAction: QueueKind | null
  tasks: GenerationTask[]
  generating: boolean

  set: (patch: Partial<StudioStore>) => void
  setActiveTab: (tab: StudioTab) => void
  queueAction: (kind: QueueKind) => void
  processQueue: () => Promise<void>
  setWriterModel: (model: string) => void
  loadWriterModels: () => Promise<void>
  toggleIn: (key: 'pickedGenres' | 'pickedVibes' | 'pickedVocals' | 'pickedInstruments' | 'pickedDrums' | 'pickedProduction' | 'pickedEras' | 'pickedCustomTags' | 'pickedStructure', value: string) => void
  addCustomTag: () => void
  applyPack: (pack: { genres: string[]; vibes: string[] }) => void
  applyTemplate: (t: { idea: string; genres: string[]; vibes: string[] }) => void
  randomIdea: () => Promise<void>
  enhanceStyle: () => Promise<void>
  enhanceWords: () => Promise<void>
  suggestSongTitle: () => Promise<void>
  generateBlueprint: () => Promise<void>
  patchBlueprint: (patch: Partial<Pick<BlueprintResult, 'caption' | 'lyrics'>>) => void
  analyzeBlueprintLyrics: () => Promise<void>
  rewriteBlueprintLyrics: (instruction: string) => Promise<void>
  acceptBlueprint: () => void
  rejectBlueprint: () => void
  resetBlueprint: () => void
  resetStudio: () => void
  submitGeneration: () => Promise<void>
}

const pollTimers: Record<string, number> = {}
const STUDIO_DRAFT_KEY = 'doremi.studio.draft.v1'
type StudioDraft = Partial<Pick<StudioStore,
  'songTitle' | 'styleText' | 'songIdea' | 'lyrics' | 'lyricsTab' | 'vocalMode' | 'creationMode' | 'language' |
  'durationMode' | 'durationMin' | 'durationMax' | 'duration' | 'performance' | 'variations' | 'bpm' | 'musicKey' |
  'seed' | 'negativePrompt' | 'pickedGenres' | 'pickedVibes' | 'pickedVocals' | 'pickedInstruments' | 'pickedDrums' |
  'pickedProduction' | 'pickedEras' | 'pickedCustomTags' | 'pickedStructure' | 'blueprint' | 'blueprintStatus' |
  'lyricsCraft' | 'lyricsQuality' | 'blueprintNotes' | 'blueprintDrafts' | 'activeTab' | 'energy' | 'vocalGender' | 'tempoFeel'
>>

function loadStudioDraft(): StudioDraft {
  try {
    const raw = localStorage.getItem(STUDIO_DRAFT_KEY)
    return raw ? JSON.parse(raw) as StudioDraft : {}
  } catch {
    return {}
  }
}

function persistStudioDraft(s: StudioStore) {
  try {
    const draft: StudioDraft = {
      songTitle: s.songTitle,
      styleText: s.styleText,
      songIdea: s.songIdea,
      lyrics: s.lyrics,
      lyricsTab: s.lyricsTab,
      vocalMode: s.vocalMode,
      creationMode: s.creationMode,
      language: s.language,
      durationMode: s.durationMode,
      durationMin: s.durationMin,
      durationMax: s.durationMax,
      duration: s.duration,
      performance: s.performance,
      variations: s.variations,
      bpm: s.bpm,
      musicKey: s.musicKey,
      seed: s.seed,
      negativePrompt: s.negativePrompt,
      pickedGenres: s.pickedGenres,
      pickedVibes: s.pickedVibes,
      pickedVocals: s.pickedVocals,
      pickedInstruments: s.pickedInstruments,
      pickedDrums: s.pickedDrums,
      pickedProduction: s.pickedProduction,
      pickedEras: s.pickedEras,
      pickedCustomTags: s.pickedCustomTags,
      pickedStructure: s.pickedStructure,
      blueprint: s.blueprint,
      blueprintStatus: s.blueprintStatus === 'generating' ? 'idle' : s.blueprintStatus,
      lyricsCraft: s.lyricsCraft,
      lyricsQuality: s.lyricsQuality,
      blueprintNotes: s.blueprintNotes,
      blueprintDrafts: s.blueprintDrafts,
      activeTab: s.blueprintStatus === 'generating' ? 'idea' : s.activeTab,
      energy: s.energy,
      vocalGender: s.vocalGender,
      tempoFeel: s.tempoFeel,
    }
    localStorage.setItem(STUDIO_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // ignore persistence failures
  }
}

const draft = loadStudioDraft()

function clearBlueprintState(): Partial<StudioStore> {
  return {
    blueprint: null,
    blueprintStatus: 'idle',
    blueprintError: null,
    lyricsCraft: null,
    lyricsQuality: null,
    lyricsQualityBusy: false,
    lyricsRewriteBusy: false,
    writerStage: null,
    blueprintNotes: [],
    blueprintStartedAt: null,
    writerStageStartedAt: null,
    blueprintDrafts: [],
  }
}

const ENERGY_HINT: Record<StudioStore['energy'], string> = { chill: 'relaxed, laid-back energy', balanced: '', hype: 'high-energy, intense and driving' }
const TEMPO_HINT: Record<StudioStore['tempoFeel'], string> = { slow: 'slow tempo', medium: 'mid tempo', fast: 'fast, up-tempo', auto: '' }

function vocalHint(s: StudioStore) {
  if (s.vocalMode !== 'vocals') return 'instrumental, no vocals'
  const gender = s.vocalGender === 'male' ? 'male lead vocal' : s.vocalGender === 'female' ? 'female lead vocal' : ''
  return [gender, s.pickedVocals.join(', ')].filter(Boolean).join(', ')
}

function composedPrompt(s: StudioStore) {
  const parts = [
    s.styleText.trim(),
    s.songIdea.trim(),
    s.pickedGenres.join(', '),
    s.pickedVibes.join(', '),
    ENERGY_HINT[s.energy],
    TEMPO_HINT[s.tempoFeel],
    s.pickedInstruments.join(', '),
    s.pickedDrums.join(', '),
    s.pickedProduction.join(', '),
    s.pickedEras.join(', '),
    s.pickedCustomTags.join(', '),
    vocalHint(s),
    s.bpm ? `${s.bpm} BPM` : '',
    s.musicKey ? `key of ${s.musicKey}` : '',
  ].filter(Boolean)
  return parts.join('. ') || 'An energetic, polished English song with a memorable hook and clear production.'
}

function selectedTags(s: StudioStore) {
  return [
    ...s.pickedGenres,
    ...s.pickedVibes,
    ...s.pickedVocals,
    ...s.pickedInstruments,
    ...s.pickedDrums,
    ...s.pickedProduction,
    ...s.pickedEras,
    ...s.pickedCustomTags,
  ]
}

function progressNote(stage: string) {
  const clean = stage.replace(/[()]/g, '').trim()
  if (/starved for VRAM/i.test(clean)) return clean
  if (/planning/i.test(clean)) return 'Reading the idea, locking the topic, and mapping the verse path.'
  if (/drafting/i.test(clean)) return 'Drafting sung lyrics from the song brief, not a screenplay scene.'
  if (/critique/i.test(clean)) return 'Checking prompt match, structure, rhyme, flow, and singability.'
  if (/rewrite/i.test(clean)) return 'Rewriting weak sections and tightening the hook, bridge, and outro.'
  if (/harmonizing/i.test(clean)) return 'Asking ACE to align caption, BPM, key, duration, and engine metadata.'
  if (/finalizing/i.test(clean)) return 'Running the final lyric quality gate and preparing the editable blueprint.'
  return clean
}

function normalizeWriterProgress(event: string | WriterProgressEvent): WriterProgressEvent {
  return typeof event === 'string' ? { stage: event, note: progressNote(event) } : event
}

export function buildSongIntent(s: StudioStore): SongIntent {
  const rawIdea = s.songIdea.trim()
  const styleCaption = s.styleText.trim()
  const currentLyrics = s.lyrics.trim()
  return {
    songTitle: s.songTitle.trim(),
    rawIdea,
    idea: rawIdea || styleCaption,
    styleCaption,
    tags: selectedTags(s),
    presetPack: null,
    vocalMode: s.vocalMode,
    language: s.vocalMode === 'instrumental' || s.language === 'auto' ? 'en' : s.language,
    durationMode: s.durationMode,
    durationMin: s.durationMin,
    durationMax: s.durationMax,
    structure: s.pickedStructure,
    negativePrompt: s.negativePrompt,
    currentLyrics,
    blueprintCaption: s.blueprint?.caption?.trim() ?? '',
    blueprintLyrics: s.blueprint?.lyrics?.trim() ?? '',
    flags: {
      userLockedIdea: Boolean(rawIdea),
      styleDerivedFromIdea: Boolean(styleCaption && rawIdea && styleCaption !== rawIdea),
      lyricsApproved: s.blueprintStatus === 'accepted',
    },
  }
}

function beginPolling(task: GenerationTask) {
  const aceId = task.aceTaskId
  if (!aceId) return
  const meta = { title: task.request.title, mode: task.request.mode }
  const timer = window.setInterval(async () => {
    let result: GenerationPollResult | undefined
    try { result = await window.doReMi.pollGeneration(aceId, meta) } catch { return }
    if (!result) return
    const poll = result
    useStudioStore.setState((s) => ({
      tasks: s.tasks.map((item) => item.id === task.id ? { ...item, status: poll.status, progress: poll.progress, progressText: poll.progressText, error: poll.error } : item),
    }))
    if (poll.status === 'succeeded' || poll.status === 'failed') {
      window.clearInterval(pollTimers[task.id])
      delete pollTimers[task.id]
      if (poll.status === 'succeeded') {
        await useAppStore.getState().refreshLibrary()
        useStudioStore.setState((s) => ({ tasks: s.tasks.filter((item) => item.id !== task.id) }))
        if (poll.songs[0]) usePlayerStore.getState().playSong(poll.songs[0])
        useUiStore.getState().toast('Song ready 🎵')
      } else if (poll.error) {
        useAppStore.getState().pushLog(`DoReMii generation failed: ${poll.error}`)
        useUiStore.getState().toast(`Generation failed: ${poll.error}`)
      }
    }
  }, 3000)
  pollTimers[task.id] = timer
}

export function isEditingMode(mode: ModeType) {
  return MODE_LIBRARY.find((m) => m.id === mode)?.needsSource ?? false
}

export const useStudioStore = create<StudioStore>((set, get) => ({
  tier: 'simple',
  songTitle: draft.songTitle ?? '',
  styleText: draft.styleText ?? '',
  songIdea: draft.songIdea ?? '',
  lyrics: draft.lyrics ?? '',
  lyricsTab: draft.lyricsTab ?? 'prompt',
  vocalMode: draft.vocalMode ?? 'vocals',
  creationMode: draft.creationMode ?? 'simple',
  language: draft.language ?? 'en',
  styleStrength: 60,
  // Default to Auto so Simple mode fine-tunes length itself; the user can
  // still switch to Sample/Loop/Song and set a manual range.
  durationMode: draft.durationMode ?? 'auto',
  durationMin: draft.durationMin ?? 180,
  durationMax: draft.durationMax ?? 240,
  duration: draft.duration ?? 210,
  performance: draft.performance ?? 'balanced',
  variations: draft.variations ?? 2,
  bpm: draft.bpm ?? '',
  musicKey: draft.musicKey ?? '',
  seed: draft.seed ?? null,
  negativePrompt: draft.negativePrompt ?? 'wrong language, muddy mix, distorted vocals, low fidelity',
  pickedGenres: draft.pickedGenres ?? [],
  pickedVibes: draft.pickedVibes ?? [],
  pickedVocals: draft.pickedVocals ?? [],
  pickedInstruments: draft.pickedInstruments ?? [],
  pickedDrums: draft.pickedDrums ?? [],
  pickedProduction: draft.pickedProduction ?? [],
  pickedEras: draft.pickedEras ?? [],
  pickedCustomTags: draft.pickedCustomTags ?? [],
  pickedStructure: draft.pickedStructure ?? ['Intro', 'Verse', 'Chorus'],
  tagFilter: '',
  customTagInput: '',
  blueprint: draft.blueprint ?? null,
  blueprintStatus: draft.blueprintStatus === 'generating' ? 'idle' : draft.blueprintStatus ?? 'idle',
  blueprintError: null,
  lyricsCraft: draft.lyricsCraft ?? null,
  lyricsQuality: draft.lyricsQuality ?? null,
  lyricsQualityBusy: false,
  lyricsRewriteBusy: false,
  enhanceStyleBusy: false,
  enhanceWordsBusy: false,
  titleBusy: false,
  writerStage: null,
  blueprintNotes: draft.blueprintNotes ?? [],
  blueprintStartedAt: null,
  writerStageStartedAt: null,
  blueprintDrafts: draft.blueprintDrafts ?? draft.lyricsCraft?.drafts ?? [],
  writerModel: localStorage.getItem('doremi.writer.model') || 'auto',
  writerModels: [],
  thinkingPower: Number(localStorage.getItem('doremi.thinking.power')) || 2,
  energy: draft.energy ?? 'balanced',
  vocalGender: draft.vocalGender ?? 'any',
  tempoFeel: draft.tempoFeel ?? 'auto',
  guidanceScale: 7,
  inferenceSteps: 0,
  lmTemperature: 0.85,
  lmTopP: 0.9,
  repetitionPenalty: 1.15,
  constrainedDecoding: true,
  conceptBusy: false,
  activeTab: draft.activeTab === 'blueprint' && draft.vocalMode === 'instrumental' ? 'idea' : draft.activeTab ?? 'idea',
  actionQueue: [],
  runningAction: null,
  tasks: [],
  generating: false,

  set: (patch) => set((s) => {
    const next: Partial<StudioStore> = { ...patch }
    if (typeof patch.thinkingPower === 'number') {
      try { localStorage.setItem('doremi.thinking.power', String(patch.thinkingPower)) } catch { /* ignore */ }
    }
    const vocalModeChanged = Boolean(patch.vocalMode && patch.vocalMode !== s.vocalMode)
    const blueprintInputsChanged = 'songIdea' in patch || 'styleText' in patch || 'language' in patch || 'pickedStructure' in patch

    if (vocalModeChanged || (blueprintInputsChanged && s.blueprintStatus === 'accepted')) {
      Object.assign(next, clearBlueprintState())
    }
    if (patch.vocalMode === 'instrumental') {
      next.lyricsTab = 'instrumental'
      next.lyrics = ''
    }
    return next
  }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  /** Click an AI button: run it now if nothing is busy, otherwise queue it.
   *  Clicking a kind that is already queued (but not yet running) cancels it. */
  queueAction: (kind) => {
    const s = get()
    if (s.runningAction === kind) return // can't cancel a job that's already running
    if (s.actionQueue.includes(kind)) {
      set({ actionQueue: s.actionQueue.filter((k) => k !== kind) })
      return
    }
    set({ actionQueue: [...s.actionQueue, kind] })
    void get().processQueue()
  },
  processQueue: async () => {
    if (get().runningAction) return
    const next = get().actionQueue[0]
    if (!next) return
    set({ actionQueue: get().actionQueue.slice(1), runningAction: next })
    try {
      if (next === 'enhanceWords') await get().enhanceWords()
      else if (next === 'enhanceStyle') await get().enhanceStyle()
      else {
        set({ activeTab: 'blueprint' })
        await get().generateBlueprint()
      }
    } finally {
      set({ runningAction: null })
      void get().processQueue()
    }
  },
  setWriterModel: (model) => {
    try { localStorage.setItem('doremi.writer.model', model) } catch { /* ignore */ }
    set({ writerModel: model })
  },
  loadWriterModels: async () => {
    try { set({ writerModels: await window.doReMi.listWriterModels() }) } catch { set({ writerModels: [] }) }
  },
  toggleIn: (key, value) => set((s) => ({
    [key]: s[key].includes(value) ? s[key].filter((i) => i !== value) : [...s[key], value],
  } as Partial<StudioStore>)),
  addCustomTag: () => {
    const s = get()
    const tag = s.customTagInput.trim()
    if (!tag) return
    set({
      customTagInput: '',
      pickedCustomTags: s.pickedCustomTags.includes(tag) ? s.pickedCustomTags : [...s.pickedCustomTags, tag],
    })
  },
  applyPack: (pack) => {
    set({ pickedGenres: pack.genres, pickedVibes: pack.vibes })
    useUiStore.getState().toast('Preset pack applied')
  },
  applyTemplate: (t) => {
    set({ songIdea: t.idea, styleText: t.idea, pickedGenres: t.genres, pickedVibes: t.vibes, lyricsTab: 'prompt', vocalMode: 'vocals' })
    useUiStore.getState().setRoute('studio')
    useUiStore.getState().toast('Template loaded')
  },
  randomIdea: async () => {
    const s = get()
    set({ conceptBusy: true })
    useUiStore.getState().toast(s.thinkingPower >= 3 ? 'Dreaming up a concept (deep thinking)…' : 'Dreaming up a fresh concept…')
    try {
      const concept = await window.doReMi.generateConceptIdea({
        think: s.thinkingPower >= 3,
        model: s.writerModel === 'auto' || s.writerModel === 'engine' ? undefined : s.writerModel,
      })
      set({
        songIdea: concept.idea,
        songTitle: concept.title || s.songTitle,
        lyricsTab: s.vocalMode === 'instrumental' ? 'instrumental' : 'prompt',
      })
      useUiStore.getState().toast('Idea ready - shaping sound around it...')
      const style = await window.doReMi.generateStyleForIdea({
        title: concept.title || s.songTitle,
        idea: concept.idea,
        tags: selectedTags(get()),
        think: s.thinkingPower >= 3,
        model: s.writerModel === 'auto' || s.writerModel === 'engine' ? undefined : s.writerModel,
      })
      set({ styleText: style })
      useUiStore.getState().toast('Fresh connected idea and style ready')
    } catch {
      // generateConcept has its own fallback, so this is only reached on a true
      // IPC failure - seed a distinct idea/style locally.
      const g = GENRES[Math.floor(Math.random() * GENRES.length)]
      const v = VIBES[Math.floor(Math.random() * VIBES.length)]
      set({
        songIdea: `A ${v.toLowerCase()} song with one clear emotional hook, verse images that develop naturally, and a chorus built for singing along.`,
        styleText: `${g} with a clear lead vocal, one signature instrument, and a mix that opens up on the chorus.`,
      })
    } finally {
      set({ conceptBusy: false })
    }
  },
  // Enhance buttons are Ollama-only text improvers: they NEVER touch the ACE
  // engine and NEVER trigger a blueprint. Blueprint generation happens in
  // exactly one place - the Generate Blueprint button.
  enhanceStyle: async () => {
    const s = get()
    if (!s.styleText.trim()) {
      useUiStore.getState().toast('Describe the sound you want first')
      return
    }
    set({ enhanceStyleBusy: true })
    try {
      const improved = await window.doReMi.enhanceText({
        kind: 'style',
        text: s.styleText,
        tags: selectedTags(s),
        model: s.writerModel === 'auto' || s.writerModel === 'engine' ? undefined : s.writerModel,
        think: s.thinkingPower >= 3,
      })
      set({ styleText: improved })
      useUiStore.getState().toast('Style description enhanced')
    } catch (error) {
      useUiStore.getState().toast(error instanceof Error ? error.message : String(error))
    } finally {
      set({ enhanceStyleBusy: false })
    }
  },
  enhanceWords: async () => {
    const s = get()
    const isWrite = s.lyricsTab === 'write'
    const text = isWrite ? s.lyrics : s.songIdea
    if (!text.trim()) {
      useUiStore.getState().toast(isWrite ? 'Write some lyrics first' : 'Describe your idea first')
      return
    }
    set({ enhanceWordsBusy: true })
    try {
      const improved = await window.doReMi.enhanceText({
        kind: isWrite ? 'lyrics' : 'idea',
        text,
        tags: selectedTags(s),
        model: s.writerModel === 'auto' || s.writerModel === 'engine' ? undefined : s.writerModel,
        think: s.thinkingPower >= 3,
      })
      set(isWrite ? { lyrics: improved } : { songIdea: improved })
      useUiStore.getState().toast(isWrite ? 'Lyrics polished' : 'Idea sharpened')
    } catch (error) {
      useUiStore.getState().toast(error instanceof Error ? error.message : String(error))
    } finally {
      set({ enhanceWordsBusy: false })
    }
  },
  suggestSongTitle: async () => {
    const s = get()
    const lyricsSource = s.blueprint?.lyrics?.trim() || s.lyrics.trim()
    const idea = s.songIdea.trim() || s.styleText.trim()
    if (!lyricsSource && !idea) {
      useUiStore.getState().toast('Give it an idea or lyrics to name the song from')
      return
    }
    set({ titleBusy: true })
    try {
      const title = await window.doReMi.suggestTitle({ lyrics: lyricsSource || idea, idea })
      set({ songTitle: title })
      useUiStore.getState().toast(`Named it "${title}"`)
    } catch (error) {
      useUiStore.getState().toast(error instanceof Error ? error.message : String(error))
    } finally {
      set({ titleBusy: false })
    }
  },
  generateBlueprint: async () => {
    const s = get()
    const intent = buildSongIntent(s)
    const idea = intent.idea
    if (!idea) {
      useUiStore.getState().toast('Add a song idea first')
      return
    }
    const language = s.vocalMode === 'instrumental' || s.language === 'auto' ? 'en' : s.language
    set({
      blueprintStatus: 'generating',
      blueprintError: null,
      lyricsCraft: null,
      lyricsQuality: null,
      lyricsQualityBusy: false,
      writerStage: 'planning',
      blueprintNotes: ['Building the song intent packet, topic lock, required structure, and production boundaries.'],
      blueprintStartedAt: Date.now(),
      writerStageStartedAt: Date.now(),
      blueprintDrafts: [],
    })
    try {
      // ACE's LM plans the music (caption, BPM, key, duration). The words
      // ALWAYS go through the big local writer for vocal songs: qwen3 drafts,
      // critiques its own draft, then rewrites. Existing lyrics (hand-written
      // or from an earlier blueprint) are handed to it as a draft to improve.
      // The 0.6B engine lyrics are only the emergency fallback.
      const wantsLyrics = s.vocalMode === 'vocals' && s.writerModel !== 'engine'
      const writer = wantsLyrics ? await window.doReMi.getWriterAvailability() : null
      let writerFailure: string | null = writer && !writer.available ? writer.reason : null
      const engineReady = useAppStore.getState().engine.health === 'ready'

      const blueprintPromise = engineReady
        ? window.doReMi.createBlueprint({
            query: idea,
            instrumental: s.vocalMode === 'instrumental',
            vocalLanguage: language,
            tags: selectedTags(s),
          })
        : Promise.resolve({
            id: crypto.randomUUID(),
            query: idea,
            caption: composedPrompt(s),
            lyrics: s.vocalMode === 'instrumental' ? '[Instrumental]' : '',
            bpm: typeof s.bpm === 'number' ? s.bpm : null,
            keyscale: s.musicKey,
            duration: Math.round((s.durationMin + s.durationMax) / 2),
            timesignature: '',
            vocalLanguage: language,
            instrumental: s.vocalMode === 'instrumental',
            lmModel: null,
            raw: { source: 'doremii-writer-only', reason: 'ACE engine was not ready' },
            createdAt: new Date().toISOString(),
          })
      const craftPromise = writer?.available
        ? window.doReMi.craftLyrics({
            idea,
            tags: selectedTags(s),
            language,
            structure: s.pickedStructure,
            existingLyrics: s.lyrics,
            model: s.writerModel === 'auto' ? undefined : s.writerModel,
            intent,
          }).catch((error) => {
            writerFailure = error instanceof Error ? error.message : String(error)
            useAppStore.getState().pushLog(`Writer failed quality gate: ${writerFailure}`)
            return null
          })
        : Promise.resolve(null)

      const offProgress = window.doReMi.onWriterProgress((event) => {
        set((current) => {
          const payload = normalizeWriterProgress(event)
          const stage = payload.stage
          const note = payload.note || progressNote(stage)
          const stageChanged = stage !== current.writerStage
          const draftAlreadySaved = payload.draft
            ? current.blueprintDrafts.some((item) => item.id === payload.draft?.id)
            : false
          return {
            writerStage: stage,
            writerStageStartedAt: stageChanged ? Date.now() : current.writerStageStartedAt,
            blueprintNotes: current.blueprintNotes.includes(note) ? current.blueprintNotes : [...current.blueprintNotes, note].slice(-8),
            blueprintDrafts: payload.draft && !draftAlreadySaved ? [...current.blueprintDrafts, payload.draft] : current.blueprintDrafts,
          }
        })
      })

      let blueprint, craft
      try {
        [blueprint, craft] = await Promise.all([blueprintPromise, craftPromise])
      } finally {
        offProgress()
      }

      let merged = craft?.lyrics.trim()
        ? { ...blueprint, instrumental: false, lyrics: craft.lyrics.trim() }
        : { ...blueprint, instrumental: s.vocalMode === 'instrumental', lyrics: s.vocalMode === 'instrumental' ? '[Instrumental]' : '' }

      // Reconcile caption + metadata around the final lyrics via ACE's
      // /format_input. The engine can't resolve caption-vs-lyrics conflicts at
      // generation time, so we harmonize them here where the user can see it.
      // We adopt the engine's caption/BPM/key/duration; the lyrics stay ours.
      if (engineReady && craft?.lyrics.trim()) {
        const note = progressNote('harmonizing caption + metadata with the engine')
        set((current) => ({
          writerStage: 'harmonizing caption + metadata with the engine',
          writerStageStartedAt: Date.now(),
          blueprintNotes: current.blueprintNotes.includes(note) ? current.blueprintNotes : [...current.blueprintNotes, note].slice(-8),
        }))
        const harmonized = await window.doReMi.formatInput({
          caption: merged.caption,
          lyrics: merged.lyrics,
          duration: s.durationMode === 'auto' ? undefined : Math.round((s.durationMin + s.durationMax) / 2),
          language,
        }).catch(() => null)
        if (harmonized) {
          merged = {
            ...merged,
            caption: harmonized.caption || merged.caption,
            bpm: harmonized.bpm ?? merged.bpm,
            keyscale: harmonized.keyscale || merged.keyscale,
            timesignature: harmonized.timesignature || merged.timesignature,
            duration: harmonized.duration ?? merged.duration,
          }
        }
      }
      const failedVocalLyrics = s.vocalMode === 'vocals' && !craft?.lyrics.trim()
      set({
        blueprint: failedVocalLyrics ? null : merged,
        lyricsCraft: craft ?? null,
        lyricsQuality: craft?.quality ?? null,
        blueprintStatus: failedVocalLyrics ? 'error' : 'ready',
        // Surface a writer fallback persistently in the panel, not just a toast.
        blueprintError: failedVocalLyrics
          ? `The lyric writer did not produce usable vocal lyrics, so DoReMii blocked the blueprint instead of falling back to instrumental output. Reason: ${writerFailure || 'unknown reason'}. Try Reroll, qwen3:14b, qwen3:8b, or write lyrics manually.`
          : null,
        writerStage: null,
        writerStageStartedAt: null,
        blueprintDrafts: craft?.drafts?.length ? craft.drafts : get().blueprintDrafts,
      })
      useUiStore.getState().toast(craft
        ? `Blueprint ready - lyrics written by ${craft.model}${engineReady ? ' with engine metadata' : ' while ACE warms'}`
        : failedVocalLyrics
          ? 'Lyrics failed quality checks - blueprint blocked'
          : 'Instrumental blueprint ready to review')

      // Auto-name: if the user hasn't titled the song, name it from the fresh
      // lyrics in the background so nothing ever saves as "Pop" again.
      if (!failedVocalLyrics && !get().songTitle.trim() && merged.lyrics.trim() && merged.lyrics.trim() !== '[Instrumental]') {
        void window.doReMi.suggestTitle({ lyrics: merged.lyrics, idea })
          .then((title) => { if (!useStudioStore.getState().songTitle.trim()) set({ songTitle: title }) })
          .catch(() => undefined)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ blueprintStatus: 'error', blueprintError: message, writerStage: null, writerStageStartedAt: null })
      useUiStore.getState().toast(`Blueprint failed: ${message}`)
    }
  },
  patchBlueprint: (patch) => {
    const b = get().blueprint
    if (!b) return
    set({ blueprint: { ...b, ...patch }, lyricsQuality: patch.lyrics !== undefined ? null : get().lyricsQuality })
  },
  analyzeBlueprintLyrics: async () => {
    const s = get()
    const intent = buildSongIntent(s)
    const lyricsToCheck = s.blueprint?.lyrics || s.lyrics
    if (!lyricsToCheck.trim()) {
      useUiStore.getState().toast('No lyrics to check yet')
      return
    }
    set({ lyricsQualityBusy: true })
    try {
      const report = await window.doReMi.analyzeLyrics({
        lyrics: lyricsToCheck,
        idea: intent.idea,
        model: s.writerModel === 'auto' ? undefined : s.writerModel,
        intent,
      })
      set({ lyricsQuality: report })
      useUiStore.getState().toast(`Lyric quality: ${report.score}/100`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ blueprintError: message })
      useUiStore.getState().toast(`Lyric check failed: ${message}`)
    } finally {
      set({ lyricsQualityBusy: false })
    }
  },
  rewriteBlueprintLyrics: async (instruction) => {
    const s = get()
    const intent = buildSongIntent(s)
    const lyricsToFix = s.blueprint?.lyrics || s.lyrics
    if (!lyricsToFix.trim()) {
      useUiStore.getState().toast('No lyrics to rewrite yet')
      return
    }
    set({ lyricsRewriteBusy: true, writerStage: 'rewrite' })
    try {
      const craft = await window.doReMi.rewriteLyrics({
        lyrics: lyricsToFix,
        idea: intent.idea,
        instruction,
        model: s.writerModel === 'auto' ? undefined : s.writerModel,
        intent,
      })
      if (s.blueprint) {
        set({
          blueprint: { ...s.blueprint, lyrics: craft.lyrics, instrumental: false },
          lyricsCraft: craft,
          lyricsQuality: craft.quality,
          blueprintStatus: 'ready',
          blueprintError: null,
        })
      } else {
        set({ lyrics: craft.lyrics, lyricsCraft: craft, lyricsQuality: craft.quality, lyricsTab: 'write', vocalMode: 'vocals' })
      }
      useUiStore.getState().toast(`Lyrics rewritten by ${craft.model}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ blueprintError: message })
      useUiStore.getState().toast(`Rewrite failed: ${message}`)
    } finally {
      set({ lyricsRewriteBusy: false, writerStage: null })
    }
  },
  acceptBlueprint: () => {
    const b = get().blueprint
    if (!b) return
    if (get().vocalMode === 'vocals' && !b.lyrics.trim()) {
      set({
        blueprintStatus: 'error',
        blueprintError: 'This is a vocal song, but the blueprint has no lyrics. Reroll the blueprint, switch writer model, or write lyrics manually.',
      })
      useUiStore.getState().toast('Vocal blueprint needs lyrics before it can be accepted')
      return
    }
    set({
      blueprintStatus: 'accepted',
      styleText: b.caption || get().styleText,
      lyrics: b.instrumental ? '' : (b.lyrics || get().lyrics),
      bpm: b.bpm ?? get().bpm,
      musicKey: b.keyscale || get().musicKey,
      duration: b.duration ?? get().duration,
      durationMin: b.duration ? Math.max(0.1, b.duration - 15) : get().durationMin,
      durationMax: b.duration ? b.duration + 15 : get().durationMax,
    })
    useUiStore.getState().toast('Blueprint accepted')
  },
  rejectBlueprint: () => {
    set({ ...clearBlueprintState() })
    useUiStore.getState().toast('Blueprint discarded')
  },
  resetBlueprint: () => set({ ...clearBlueprintState() }),
  resetStudio: () => {
    set({
      songTitle: '',
      styleText: '',
      songIdea: '',
      lyrics: '',
      lyricsTab: 'prompt',
      vocalMode: 'vocals',
      pickedGenres: [],
      pickedVibes: [],
      pickedVocals: [],
      pickedInstruments: [],
      pickedDrums: [],
      pickedProduction: [],
      pickedEras: [],
      pickedCustomTags: [],
      pickedStructure: ['Intro', 'Verse', 'Chorus'],
      activeTab: 'idea',
      actionQueue: [],
      ...clearBlueprintState(),
    })
    useUiStore.getState().toast('Studio cleared')
  },
  submitGeneration: async () => {
    const s = get()
    const mode: ModeType = s.vocalMode === 'instrumental' ? 'instrumental' : (s.creationMode === 'lyrics' ? 'lyrics' : 'simple')
    const finalLyrics = s.vocalMode === 'vocals' ? (s.lyrics.trim() || (s.blueprintStatus === 'accepted' ? s.blueprint?.lyrics.trim() : '') || '') : ''
    if (s.vocalMode === 'vocals' && !finalLyrics) {
      useUiStore.getState().toast('Generate and accept a blueprint, or write lyrics first')
      return
    }

    // Auto-name when the field was left empty or on a default: read the final
    // lyrics (or idea) and produce a real title instead of "Pop".
    let cleanTitle = s.songTitle.trim()
    const looksDefault = !cleanTitle || /^new doremii song$/i.test(cleanTitle)
    if (looksDefault) {
      try {
        cleanTitle = await window.doReMi.suggestTitle({
          lyrics: finalLyrics || s.styleText || s.songIdea,
          idea: s.songIdea.trim() || s.styleText.trim(),
        })
        set({ songTitle: cleanTitle })
        useUiStore.getState().toast(`Named it "${cleanTitle}"`)
      } catch {
        cleanTitle = s.pickedGenres[0] ? `${s.pickedGenres[0]} Song` : 'Untitled Song'
      }
    }
    const duration = s.durationMode === 'auto'
      ? Math.min(480, Math.max(30, s.pickedStructure.length * 35))
      : Math.max(0.1, (s.durationMin + s.durationMax) / 2)
    set({ generating: true })
    try {
      const task = await window.doReMi.createGeneration({
        title: cleanTitle,
        mode,
        prompt: s.blueprintStatus === 'accepted' && s.blueprint?.caption ? s.blueprint.caption : composedPrompt(s),
        lyrics: finalLyrics,
        structure: s.pickedStructure,
        negativePrompt: s.negativePrompt,
        language: s.vocalMode === 'instrumental' || s.language === 'auto' ? 'en' : s.language,
        duration,
        durationMode: s.durationMode,
        durationMin: s.durationMin,
        durationMax: s.durationMax,
        batchSize: s.variations,
        seed: s.seed,
        model: null,
        performancePreset: s.performance,
        sourceAudioPath: null,
        blueprint: s.blueprintStatus === 'accepted' ? s.blueprint : null,
        guidanceScale: s.guidanceScale,
        inferenceSteps: s.inferenceSteps || undefined,
        lmTemperature: s.lmTemperature,
        lmTopP: s.lmTopP,
        repetitionPenalty: s.repetitionPenalty,
        constrainedDecoding: s.constrainedDecoding,
      })
      set((c) => ({ tasks: [task, ...c.tasks] }))
      if (task.status === 'error') {
        useAppStore.getState().pushLog(`DoReMii generation error: ${task.error}`)
        useUiStore.getState().toast(`Error: ${task.error}`)
      } else if (task.aceTaskId) {
        beginPolling(task)
      }
    } finally {
      set({ generating: false })
    }
  },
}))

useStudioStore.subscribe((state) => persistStudioDraft(state))

