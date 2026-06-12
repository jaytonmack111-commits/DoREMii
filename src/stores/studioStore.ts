import { create } from 'zustand'
import type { BlueprintResult, DurationMode, GenerationPollResult, GenerationTask, LyricsCraftResult, LyricsQualityReport, ModeType, PerformancePreset, SongIntent } from '../shared/types'
import { GENRES, MODE_LIBRARY, VIBES } from '../lib/constants'
import { useAppStore } from './appStore'
import { usePlayerStore } from './playerStore'
import { useUiStore } from './uiStore'

export type VocalMode = 'vocals' | 'instrumental'
export type LyricsTab = 'write' | 'prompt' | 'instrumental'
/** How much of the studio is exposed: quick one-box flow, the standard set, or everything. */
export type DetailTier = 'simple' | 'advanced' | 'pro'

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
  writerStage: string | null
  /** 'auto' = strongest installed Ollama model; 'engine' = ACE's small LM only. */
  writerModel: string
  writerModels: string[]
  tasks: GenerationTask[]
  generating: boolean

  set: (patch: Partial<StudioStore>) => void
  setWriterModel: (model: string) => void
  loadWriterModels: () => Promise<void>
  toggleIn: (key: 'pickedGenres' | 'pickedVibes' | 'pickedVocals' | 'pickedInstruments' | 'pickedDrums' | 'pickedProduction' | 'pickedEras' | 'pickedCustomTags' | 'pickedStructure', value: string) => void
  addCustomTag: () => void
  applyPack: (pack: { genres: string[]; vibes: string[] }) => void
  applyTemplate: (t: { idea: string; genres: string[]; vibes: string[] }) => void
  randomIdea: () => void
  enhanceStyle: () => Promise<void>
  generateBlueprint: () => Promise<void>
  patchBlueprint: (patch: Partial<Pick<BlueprintResult, 'caption' | 'lyrics'>>) => void
  analyzeBlueprintLyrics: () => Promise<void>
  rewriteBlueprintLyrics: (instruction: string) => Promise<void>
  acceptBlueprint: () => void
  rejectBlueprint: () => void
  resetBlueprint: () => void
  submitGeneration: () => Promise<void>
}

const pollTimers: Record<string, number> = {}

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
  }
}

function composedPrompt(s: StudioStore) {
  const parts = [
    s.styleText.trim(),
    s.songIdea.trim(),
    s.pickedGenres.join(', '),
    s.pickedVibes.join(', '),
    s.pickedInstruments.join(', '),
    s.pickedDrums.join(', '),
    s.pickedProduction.join(', '),
    s.pickedEras.join(', '),
    s.pickedCustomTags.join(', '),
    s.vocalMode === 'vocals' ? s.pickedVocals.join(', ') : 'instrumental, no vocals',
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
  songTitle: '',
  styleText: '',
  songIdea: '',
  lyrics: '',
  lyricsTab: 'prompt',
  vocalMode: 'vocals',
  creationMode: 'simple',
  language: 'en',
  styleStrength: 60,
  durationMode: 'song',
  durationMin: 200,
  durationMax: 240,
  duration: 220,
  performance: 'balanced',
  variations: 2,
  bpm: '',
  musicKey: '',
  seed: null,
  negativePrompt: 'wrong language, muddy mix, distorted vocals, low fidelity',
  pickedGenres: [],
  pickedVibes: [],
  pickedVocals: [],
  pickedInstruments: [],
  pickedDrums: [],
  pickedProduction: [],
  pickedEras: [],
  pickedCustomTags: [],
  pickedStructure: ['Intro', 'Verse', 'Chorus'],
  tagFilter: '',
  customTagInput: '',
  blueprint: null,
  blueprintStatus: 'idle',
  blueprintError: null,
  lyricsCraft: null,
  lyricsQuality: null,
  lyricsQualityBusy: false,
  lyricsRewriteBusy: false,
  writerStage: null,
  writerModel: localStorage.getItem('doremi.writer.model') || 'auto',
  writerModels: [],
  tasks: [],
  generating: false,

  set: (patch) => set((s) => {
    const next: Partial<StudioStore> = { ...patch }
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
  randomIdea: () => {
    const g = GENRES[Math.floor(Math.random() * GENRES.length)]
    const v = VIBES[Math.floor(Math.random() * VIBES.length)]
    set({
      pickedGenres: [g], pickedVibes: [v],
      styleText: `A ${v.toLowerCase()} ${g} track with rich texture`,
      songIdea: `A ${v.toLowerCase()} ${g} song with a strong, memorable hook`,
    })
    useUiStore.getState().toast('Rolled a fresh idea')
  },
  enhanceStyle: async () => {
    const s = get()
    const idea = s.styleText.trim() || s.songIdea.trim()
    if (!idea) {
      useUiStore.getState().toast('Describe the sound you want first')
      return
    }
    if (useAppStore.getState().engine.health !== 'ready') {
      useUiStore.getState().toast('Start the engine first - Enhance uses the local AI')
      return
    }
    set({ blueprintStatus: 'generating', blueprintError: null })
    useUiStore.getState().toast('Asking the AI to translate your idea into engine-ready style tags…')
    try {
      // The LM knows ACE's accepted tag vocabulary; it rewrites the free-text
      // prompt into a caption the generator actually understands.
      const blueprint = await window.doReMi.createBlueprint({
        query: idea,
        instrumental: s.vocalMode === 'instrumental',
        vocalLanguage: s.vocalMode === 'instrumental' || s.language === 'auto' ? 'en' : s.language,
        tags: selectedTags(s),
      })
      set({
        styleText: blueprint.caption || s.styleText,
        blueprint,
        blueprintStatus: 'ready',
        blueprintError: null,
      })
      useUiStore.getState().toast('Style adapted to engine-friendly tags - review the blueprint')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ blueprintStatus: 'error', blueprintError: message })
      useUiStore.getState().toast(`Enhance failed: ${message}`)
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
    if (useAppStore.getState().engine.health !== 'ready') {
      set({ blueprintError: 'Start the engine first - Blueprint generation needs the ACE engine to draft the song structure.' })
      useUiStore.getState().toast('Engine offline. Start the engine first.')
      return
    }

    const language = s.vocalMode === 'instrumental' || s.language === 'auto' ? 'en' : s.language
    set({ blueprintStatus: 'generating', blueprintError: null, lyricsCraft: null, lyricsQuality: null, lyricsQualityBusy: false, writerStage: 'planning' })
    try {
      // ACE's LM plans the music (caption, BPM, key, duration). The words
      // ALWAYS go through the big local writer for vocal songs: qwen3 drafts,
      // critiques its own draft, then rewrites. Existing lyrics (hand-written
      // or from an earlier blueprint) are handed to it as a draft to improve.
      // The 0.6B engine lyrics are only the emergency fallback.
      const wantsLyrics = s.vocalMode === 'vocals' && s.writerModel !== 'engine'
      const writer = wantsLyrics ? await window.doReMi.getWriterAvailability() : null
      let writerFailure: string | null = writer && !writer.available ? writer.reason : null

      const blueprintPromise = window.doReMi.createBlueprint({
        query: idea,
        instrumental: s.vocalMode === 'instrumental',
        vocalLanguage: language,
        tags: selectedTags(s),
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

      const offProgress = window.doReMi.onWriterProgress((stage) => {
        set({ writerStage: stage })
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
      if (craft?.lyrics.trim()) {
        set({ writerStage: 'harmonizing caption + metadata with the engine' })
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
      })
      useUiStore.getState().toast(craft
        ? `Blueprint ready - lyrics written by ${craft.model} with a critic pass`
        : failedVocalLyrics
          ? 'Lyrics failed quality checks - blueprint blocked'
          : 'Instrumental blueprint ready to review')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ blueprintStatus: 'error', blueprintError: message, writerStage: null })
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
  submitGeneration: async () => {
    const s = get()
    const cleanTitle = s.songTitle.trim() || s.pickedGenres[0] || 'New DoReMii song'
    const mode: ModeType = s.vocalMode === 'instrumental' ? 'instrumental' : (s.creationMode === 'lyrics' ? 'lyrics' : 'simple')
    const finalLyrics = s.vocalMode === 'vocals' ? (s.lyrics.trim() || (s.blueprintStatus === 'accepted' ? s.blueprint?.lyrics.trim() : '') || '') : ''
    if (s.vocalMode === 'vocals' && !finalLyrics) {
      useUiStore.getState().toast('Generate and accept a blueprint, or write lyrics first')
      return
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

