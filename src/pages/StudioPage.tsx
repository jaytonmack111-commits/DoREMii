import { useEffect, useState } from 'react'
import { AudioLines, Check, Dices, Info, ListChecks, Music2, RefreshCw, Users, Wand2, X } from 'lucide-react'
import { useRoomStore } from '../stores/roomStore'
import { BlueprintStatusPanel } from '../components/ui/BlueprintStatusPanel'
import { Cover } from '../components/ui/Cover'
import { LANGUAGES, MODE_LIBRARY, PRESET_PACKS, STRUCTURE, TAG_CATEGORIES, VOCALS, WORKSHOP_TOOLS } from '../lib/constants'
import { useAppStore } from '../stores/appStore'
import { usePlayerStore } from '../stores/playerStore'
import { isEditingMode, useStudioStore, type DetailTier, type QueueKind, type StudioTab } from '../stores/studioStore'
import { useUiStore } from '../stores/uiStore'
import type { DurationMode, PerformancePreset } from '../shared/types'

const TIERS: { id: DetailTier; label: string }[] = [
  { id: 'simple', label: 'Simple' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'pro', label: 'Pro' },
]

const DURATION_MODES: Record<DurationMode, { label: string; min: number; max: number; step: number; defaultMin: number; defaultMax: number }> = {
  sample: { label: 'Sample', min: 0.1, max: 10, step: 0.1, defaultMin: 0.5, defaultMax: 2 },
  loop: { label: 'Loop', min: 5, max: 60, step: 1, defaultMin: 15, defaultMax: 30 },
  song: { label: 'Song', min: 30, max: 480, step: 5, defaultMin: 200, defaultMax: 240 },
  auto: { label: 'Auto', min: 30, max: 480, step: 5, defaultMin: 180, defaultMax: 240 },
}

const TAG_STORE_KEYS = {
  genres: 'pickedGenres',
  vibes: 'pickedVibes',
  vocals: 'pickedVocals',
  instruments: 'pickedInstruments',
  drums: 'pickedDrums',
  production: 'pickedProduction',
  eras: 'pickedEras',
} as const

/** How many tags each section shows before a "+N" expander - keeps the tag
 *  library from stretching the panel off-screen. */
const TAG_PREVIEW_COUNT = 4

function formatSeconds(value: number) {
  if (value < 10) return `${Number(value.toFixed(1))}s`
  const rounded = Math.round(value)
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${rounded}s`
}

export function StudioPage() {
  const studio = useStudioStore()
  const { engine, songs } = useAppStore()
  const playSong = usePlayerStore((s) => s.playSong)
  const { setRoute, soon } = useUiStore()

  const {
    tier, styleText, songIdea, lyrics, lyricsTab, vocalMode, creationMode, language,
    styleStrength, durationMode, durationMin, durationMax, performance, variations, bpm, musicKey,
    seed, negativePrompt, songTitle, pickedGenres, pickedVibes, pickedVocals, pickedInstruments,
    pickedDrums, pickedProduction, pickedEras, pickedCustomTags, pickedStructure, tagFilter,
    customTagInput, blueprint, blueprintStatus, blueprintError, lyricsCraft, lyricsQuality, lyricsQualityBusy, lyricsRewriteBusy, writerStage, blueprintNotes,
    blueprintStartedAt, writerStageStartedAt, blueprintDrafts,
    titleBusy, conceptBusy,
    thinkingPower, energy, vocalGender, tempoFeel, guidanceScale, inferenceSteps, lmTemperature, lmTopP, repetitionPenalty, constrainedDecoding,
    writerModel, writerModels, tasks, generating, activeTab, actionQueue, runningAction,
    set, setActiveTab, queueAction, toggleIn, setWriterModel, loadWriterModels,
    addCustomTag, applyPack, randomIdea, suggestSongTitle, patchBlueprint, analyzeBlueprintLyrics, rewriteBlueprintLyrics,
    acceptBlueprint, rejectBlueprint, resetBlueprint, resetStudio, submitGeneration,
  } = studio

  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set())

  // Queue-aware button helpers: a kind can be idle, queued (with position), or
  // running. Clicking a queued kind cancels it.
  function actionLabel(kind: QueueKind, idle: string, busy: string) {
    if (runningAction === kind) return busy
    const pos = actionQueue.indexOf(kind)
    return pos >= 0 ? `Queued #${pos + 1} · cancel` : idle
  }
  function actionClass(kind: QueueKind, base: string) {
    return `${base}${actionQueue.includes(kind) ? ' queued' : ''}${runningAction === kind ? ' running' : ''}`
  }

  useEffect(() => { void loadWriterModels() }, [loadWriterModels])
  // Instrumental songs have no Blueprint tab; fall back to Idea without forcing
  // a state write (keeps the choice if the user flips back to vocals).
  const visibleTab: StudioTab = activeTab === 'blueprint' && vocalMode !== 'vocals' ? 'idea' : activeTab

  const engineReady = engine.health === 'ready'
  const engineWarming = engine.health === 'warming' || engine.state === 'starting'
  const editing = isEditingMode(creationMode)
  const showAdvanced = tier !== 'simple'
  const showPro = tier === 'pro'
  const durationConfig = DURATION_MODES[durationMode]
  const hasLyricsForVocals = vocalMode === 'instrumental' || Boolean(lyrics.trim()) || (blueprintStatus === 'accepted' && Boolean(blueprint?.lyrics.trim()))
  const blueprintHasLyrics = Boolean(blueprint?.lyrics.trim() && blueprint.lyrics.trim() !== '[Instrumental]')
  const canAcceptBlueprint = Boolean(blueprint && blueprintStatus !== 'accepted' && (vocalMode === 'instrumental' || blueprintHasLyrics))
  const canGenerate = engineReady && !editing && !generating && hasLyricsForVocals
  const filter = tagFilter.trim().toLowerCase()
  const tagCount = pickedGenres.length + pickedVibes.length + pickedVocals.length + pickedInstruments.length
    + pickedDrums.length + pickedProduction.length + pickedEras.length + pickedCustomTags.length
  const selectedByCategory = {
    genres: pickedGenres,
    vibes: pickedVibes,
    vocals: pickedVocals,
    instruments: pickedInstruments,
    drums: pickedDrums,
    production: pickedProduction,
    eras: pickedEras,
  }

  const tabs: { id: StudioTab; label: string; num: number }[] = [
    { id: 'idea', label: 'Idea', num: 1 },
    ...(vocalMode === 'vocals' ? [{ id: 'blueprint' as StudioTab, label: 'Blueprint', num: 2 }] : []),
    { id: 'setup', label: 'Setup', num: vocalMode === 'vocals' ? 3 : 2 },
  ]

  function toggleTagSection(id: string) {
    setExpandedTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function applyDurationMode(nextMode: DurationMode) {
    const next = DURATION_MODES[nextMode]
    set({
      durationMode: nextMode,
      durationMin: next.defaultMin,
      durationMax: next.defaultMax,
      duration: (next.defaultMin + next.defaultMax) / 2,
    })
  }

  function setDurationMin(value: number) {
    const nextMin = Math.min(value, durationMax)
    set({ durationMin: nextMin, duration: (nextMin + durationMax) / 2 })
  }

  function setDurationMax(value: number) {
    const nextMax = Math.max(value, durationMin)
    set({ durationMax: nextMax, duration: (durationMin + nextMax) / 2 })
  }

  function generateLabel() {
    if (generating) return 'Submitting...'
    if (editing) return 'Needs a source track'
    if (!hasLyricsForVocals) return 'Accept a blueprint first'
    if (engineReady) return 'Generate Music'
    if (engineWarming) return 'Engine warming up...'
    if (engine.state === 'error') return 'Engine needs attention'
    return 'Engine starting...'
  }

  return (
    <section className="page studio studio-tabbed">
      <div className="studio-head">
        <div>
          <span className="eyebrow">Create Music</span>
          <h1>Build a track from the idea outward.</h1>
        </div>
        <div className="studio-head-actions">
          <button className="mini-action" onClick={() => void randomIdea()} disabled={conceptBusy}><Dices size={15} /> {conceptBusy ? 'Thinking...' : 'Random Idea'}</button>
          <button className="mini-action" onClick={resetStudio}><X size={14} /> Clear Studio</button>
          <div className="segmented small">
            {TIERS.map((t) => (
              <button key={t.id} className={tier === t.id ? 'seg active' : 'seg'} onClick={() => set({ tier: t.id })}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Tab bar ---------- */}
      <div className="studio-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={visibleTab === t.id}
            className={visibleTab === t.id ? 'studio-tab active' : 'studio-tab'}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="tab-num">{t.num}</span>
            {t.label}
            {t.id === 'blueprint' && blueprintStatus === 'accepted' && <Check size={14} className="tab-check" />}
          </button>
        ))}
      </div>

      <div className="studio-tab-body">
        {/* ---------- Idea tab ---------- */}
        {visibleTab === 'idea' && (
          <div className="idea-tab">
            <div className="idea-main">
              <div className="stacked-block">
                <div className="block-head">
                  <span className="chip-label">Song Name</span>
                  <button className="mini-action" onClick={() => void suggestSongTitle()} disabled={titleBusy}>
                    <RefreshCw size={13} /> {titleBusy ? 'Naming...' : 'Suggest Name'}
                  </button>
                </div>
                <input
                  className="title-input"
                  value={songTitle}
                  onChange={(e) => set({ songTitle: e.target.value })}
                  placeholder="Leave blank and DoReMii names it from the lyrics"
                />
              </div>

              <div className="mode-toggle-centered">
                <div className="segmented">
                  {(['write', 'prompt', 'instrumental'] as const).map((tab) => (
                    <button
                      key={tab}
                      className={lyricsTab === tab ? 'seg active' : 'seg'}
                      onClick={() => set({ lyricsTab: tab, vocalMode: tab === 'instrumental' ? 'instrumental' : 'vocals' })}
                    >
                      {tab === 'write' ? 'Write Lyrics' : tab === 'prompt' ? 'Prompt' : 'Instrumental'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="idea-two-col">
                {/* Left: Idea / Lyrics */}
                <div className="idea-box">
                  <span className="chip-label">{lyricsTab === 'write' ? 'Lyrics' : lyricsTab === 'prompt' ? 'Idea' : 'Instrumental'}</span>
                  {lyricsTab === 'instrumental' ? (
                    <div className="instrumental-note idea-area"><Music2 size={18} /> Instrumental mode - no vocals or lyrics will be generated. Describe the sound on the right.</div>
                  ) : lyricsTab === 'write' ? (
                    <textarea className="idea-area" value={lyrics} onChange={(e) => set({ lyrics: e.target.value })} placeholder={'[Verse]\nWrite your lyrics here...'} />
                  ) : (
                    <textarea className="idea-area" value={songIdea} onChange={(e) => set({ songIdea: e.target.value })} placeholder="Describe the song you want - the story, mood, energy, hook..." />
                  )}
                  {lyricsTab !== 'instrumental' && (
                    <div className="area-foot">
                      <button className={actionClass('enhanceWords', 'mini-action accent')} onClick={() => queueAction('enhanceWords')}>
                        <Wand2 size={14} /> {actionLabel('enhanceWords', lyricsTab === 'write' ? 'Enhance Lyrics' : 'Enhance Idea', 'Enhancing...')}
                      </button>
                      <span className="counter">{(lyricsTab === 'write' ? lyrics : songIdea).length} chars</span>
                    </div>
                  )}
                  {lyricsTab === 'write' && (
                    <div className="chip-wrap">
                      {WORKSHOP_TOOLS.map((tool) => (
                        <button key={tool} className="chip" onClick={() => soon(`Lyrics ${tool}`)}>{tool}</button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Sound & Style */}
                <div className="idea-box style-box">
                  <span className="chip-label style-label">Sound &amp; Style</span>
                  <textarea
                    className="idea-area"
                    value={styleText}
                    onChange={(e) => set({ styleText: e.target.value })}
                    placeholder="Describe the sound in your own words - genre, mood, instruments, era, energy..."
                  />
                  <div className="area-foot">
                    <button className={actionClass('enhanceStyle', 'mini-action accent')} onClick={() => queueAction('enhanceStyle')}>
                      <Wand2 size={14} /> {actionLabel('enhanceStyle', 'Enhance Style', 'Enhancing...')}
                    </button>
                    <div className="foot-right">
                      <span className="hint">The AI maps your words to engine tags</span>
                      <span className="counter">{styleText.length} chars</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tag library - fixed, self-contained, scrolls internally */}
            <aside className="tag-column">
              <div className="block-head">
                <span className="chip-label">Tag Library</span>
                {tagCount > 0 && <em className="count-badge">{tagCount} picked</em>}
              </div>
              <input className="tag-search" value={tagFilter} onChange={(e) => set({ tagFilter: e.target.value })} placeholder="Search genres, moods, instruments..." />
              <div className="tag-scrollarea">
                <span className="chip-label">Preset Packs</span>
                <div className="chip-wrap">
                  {PRESET_PACKS.map((pack) => (
                    <button key={pack.name} className="chip" onClick={() => applyPack(pack)}>{pack.name}</button>
                  ))}
                </div>
                {TAG_CATEGORIES.map((category) => {
                  const items = category.items.filter((item) => !filter || item.toLowerCase().includes(filter))
                  if (!items.length) return null
                  const isExpanded = Boolean(filter) || expandedTags.has(category.id)
                  const visible = isExpanded ? items : items.slice(0, TAG_PREVIEW_COUNT)
                  const hidden = items.length - visible.length
                  return (
                    <div className="tag-group" key={category.id}>
                      <span className="chip-label">{category.label}</span>
                      <div className="chip-wrap">
                        {visible.map((item) => (
                          <button
                            key={item}
                            className={selectedByCategory[category.id].includes(item) ? 'chip on' : 'chip'}
                            onClick={() => toggleIn(TAG_STORE_KEYS[category.id], item)}
                          >
                            {item}
                          </button>
                        ))}
                        {!filter && items.length > TAG_PREVIEW_COUNT && (
                          <button className="chip more" onClick={() => toggleTagSection(category.id)}>
                            {expandedTags.has(category.id) ? 'Show less' : `+${hidden} more`}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div className="custom-tag-row">
                  <input
                    value={customTagInput}
                    onChange={(e) => set({ customTagInput: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
                    placeholder="Add any custom style tag..."
                  />
                  <button className="mini-action" onClick={addCustomTag}>Add</button>
                </div>
                {!!pickedCustomTags.length && (
                  <div className="chip-wrap">
                    {pickedCustomTags.map((tag) => (
                      <button key={tag} className="chip on" onClick={() => toggleIn('pickedCustomTags', tag)}>{tag}</button>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}

        {/* ---------- Blueprint tab ---------- */}
        {visibleTab === 'blueprint' && vocalMode === 'vocals' && (
          <div className="tab-scroll">
            <div className="tab-header">
              <div>
                <h3>Blueprint</h3>
                <small>The AI drafts lyrics and style metadata. Edit anything, then accept.</small>
              </div>
              <div className="blueprint-head-controls">
                <label className="writer-select">
                  Lyrics writer
                  <select value={writerModel} onChange={(e) => setWriterModel(e.target.value)}>
                    <option value="auto">Auto — use Settings default writer</option>
                    {writerModels.map((m) => <option key={m} value={m}>{m} (Ollama)</option>)}
                    <option value="engine">ACE engine LM — fast, basic</option>
                  </select>
                </label>
                <button className={actionClass('generateBlueprint', 'mini-action accent')} onClick={() => queueAction('generateBlueprint')} disabled={!engineReady && !actionQueue.includes('generateBlueprint')}>
                  <Wand2 size={14} />
                  {actionLabel('generateBlueprint', blueprint ? 'Regenerate' : 'Generate Blueprint', 'Generating...')}
                </button>
              </div>
            </div>

            <BlueprintStatusPanel
              status={blueprintStatus}
              error={blueprintError}
              writerStage={writerStage}
              notes={blueprintNotes}
              startedAt={blueprintStartedAt}
              stageStartedAt={writerStageStartedAt}
              drafts={blueprintDrafts}
              onRetry={() => queueAction('generateBlueprint')}
              onCancel={resetBlueprint}
            />

            {blueprint ? (
              <div className={`blueprint-body ${blueprintStatus}`}>
                <div className="meta-strip">
                  <span><em>BPM</em>{blueprint.bpm ?? 'Auto'}</span>
                  <span><em>Key</em>{blueprint.keyscale || 'Auto'}</span>
                  <span><em>Duration</em>{blueprint.duration ? formatSeconds(blueprint.duration) : 'Auto'}</span>
                  <span><em>Language</em>{blueprint.vocalLanguage}</span>
                  <span><em>Music LM</em>{blueprint.lmModel || 'Default'}</span>
                  <span className={lyricsCraft ? 'writer-badge good' : 'writer-badge plain'}>
                    <em>Lyrics by</em>{lyricsCraft ? `${lyricsCraft.model} critic pass` : vocalMode === 'vocals' ? 'Not ready' : 'Instrumental'}
                  </span>
                  {blueprintStatus === 'accepted' && <span className="accepted-pill"><Check size={12} /> Accepted</span>}
                </div>
                <div className="blueprint-columns">
                  <label className="stacked">
                    Style Caption - edit freely
                    <textarea
                      className="grow-area"
                      value={blueprint.caption}
                      onChange={(e) => patchBlueprint({ caption: e.target.value })}
                      placeholder="No caption returned"
                    />
                  </label>
                  <label className="stacked">
                    Lyrics - fix anything you don't like
                    <textarea
                      className="grow-area"
                      value={blueprint.lyrics}
                      onChange={(e) => patchBlueprint({ lyrics: e.target.value })}
                      placeholder={vocalMode === 'vocals' ? 'No approved lyrics yet' : '[Instrumental]'}
                    />
                  </label>
                </div>
                <div className="blueprint-actions-row">
                  <button className="mini-action good" onClick={acceptBlueprint} disabled={!canAcceptBlueprint}>
                    <Check size={14} /> {blueprintStatus === 'accepted' ? 'Accepted' : 'Accept Blueprint'}
                  </button>
                  <button className="mini-action" onClick={() => void analyzeBlueprintLyrics()} disabled={lyricsQualityBusy || !blueprint.lyrics.trim()}>
                    <ListChecks size={14} /> {lyricsQualityBusy ? 'Checking...' : 'Check Lyrics'}
                  </button>
                  <button className="mini-action" onClick={() => queueAction('generateBlueprint')}><RefreshCw size={14} /> Reroll</button>
                  <button className="mini-action danger" onClick={rejectBlueprint}><X size={14} /> Discard</button>
                  {showPro && (
                    <button className="writers-room-cta" onClick={() => void useRoomStore.getState().openRoom()}>
                      <Users size={15} /> Open the Writers&rsquo; Room
                    </button>
                  )}
                </div>
                {lyricsCraft?.drafts?.length ? (
                  <details className="draft-history">
                    <summary>Draft history ({lyricsCraft.drafts.length})</summary>
                    <div className="draft-history-grid">
                      {lyricsCraft.drafts.map((draft) => (
                        <details key={draft.id} className="draft-history-item">
                          <summary>
                            <span>{draft.label}</span>
                            {draft.quality && <em>{draft.quality.score}/100</em>}
                          </summary>
                          <pre>{draft.lyrics}</pre>
                        </details>
                      ))}
                    </div>
                  </details>
                ) : null}
                {lyricsQuality && (
                  <div className={`quality-card ${lyricsQuality.verdict}`}>
                    <div className="quality-score">
                      <strong>{lyricsQuality.score}</strong>
                      <span>/100</span>
                    </div>
                    <div className="quality-main">
                      <div className="quality-head">
                        <strong>{lyricsQuality.verdict === 'pass' ? 'Lyrics pass' : lyricsQuality.verdict === 'needs_work' ? 'Needs polish' : 'Do not generate yet'}</strong>
                        <span>{lyricsQuality.summary}</span>
                      </div>
                      <div className="quality-metrics">
                        <span>{lyricsQuality.structure.sungLineCount} sung lines</span>
                        <span>{lyricsQuality.structure.sections.join(', ') || 'No sections'}</span>
                        <span>{lyricsQuality.structure.hasOutro ? 'Outro present' : 'Outro missing'}</span>
                      </div>
                      {(lyricsQuality.structure.expectedSections?.length || lyricsQuality.structure.missingSections?.length) && (
                        <div className="structure-lock">
                          <strong>Required shape</strong>
                          <div className="chip-wrap">
                            {lyricsQuality.structure.expectedSections?.map((section) => (
                              <span
                                className={`chip tiny ${lyricsQuality.structure.missingSections?.includes(section) ? 'danger' : 'on'}`}
                                key={`expected-${section}`}
                              >
                                {section}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {lyricsQuality.topicLock && (
                        <div className="topic-lock">
                          <strong>Topic lock</strong>
                          <div className="chip-wrap">
                            {lyricsQuality.topicLock.matchedTerms.slice(0, 6).map((term) => <span className="chip tiny on" key={`match-${term}`}>{term}</span>)}
                            {lyricsQuality.topicLock.missingTerms.slice(0, 6).map((term) => <span className="chip tiny warn" key={`miss-${term}`}>missing {term}</span>)}
                            {lyricsQuality.topicLock.forbiddenDrift.slice(0, 6).map((term) => <span className="chip tiny danger" key={`drift-${term}`}>drift {term}</span>)}
                          </div>
                        </div>
                      )}
                      {lyricsQuality.semanticAdherence && (
                        <div className={`adherence-card ${lyricsQuality.semanticAdherence.verdict}`}>
                          <strong>Prompt adherence: {lyricsQuality.semanticAdherence.score}/100</strong>
                          <span>{lyricsQuality.semanticAdherence.verdict.replace('_', ' ')}</span>
                          {!!lyricsQuality.semanticAdherence.notes.length && (
                            <ul>
                              {lyricsQuality.semanticAdherence.notes.slice(0, 3).map((note) => <li key={note}>{note}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                      {lyricsQuality.metrics && (
                        <div className="metric-grid">
                          {Object.entries(lyricsQuality.metrics).map(([key, value]) => (
                            <span key={key}><em>{key.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)}</em>{value}</span>
                          ))}
                        </div>
                      )}
                      {!!lyricsQuality.issues.length && (
                        <ul className="quality-list bad">
                          {lyricsQuality.issues.slice(0, 5).map((issue) => <li key={issue}>{issue}</li>)}
                        </ul>
                      )}
                      {!!lyricsQuality.strengths.length && (
                        <ul className="quality-list good">
                          {lyricsQuality.strengths.slice(0, 4).map((strength) => <li key={strength}>{strength}</li>)}
                        </ul>
                      )}
                      {lyricsQuality.modelCritique && (
                        <details className="quality-critique">
                          <summary>Model critique</summary>
                          <pre>{lyricsQuality.modelCritique}</pre>
                        </details>
                      )}
                      <div className="quality-actions">
                        <button className="mini-action accent" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Fix every issue in the quality report while preserving the core song idea.')}>
                          <Wand2 size={14} /> {lyricsRewriteBusy ? 'Rewriting...' : 'Fix Issues'}
                        </button>
                        <button className="mini-action accent" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Rewrite the full song to follow the user idea much more closely. Keep the production style, but remove unrelated imagery. Do not change the topic. Return the full song with all required sections.')}>
                          More Like Idea
                        </button>
                        <button className="mini-action" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Add or rewrite the outro so the song closes the central idea clearly. Keep all existing good sections, but return the full song with [Outro] included.')}>
                          Generate Outro
                        </button>
                        <button className="mini-action" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Rewrite only the chorus with a stronger, more memorable hook, then return the full song.')}>Rewrite Chorus</button>
                        <button className="mini-action" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Remove all stage directions, screenplay narration, sound effects, and non-sung text.')}>Clean</button>
                        <button className="mini-action" disabled={lyricsRewriteBusy} onClick={() => void rewriteBlueprintLyrics('Make the lyrics more singable with smoother meter and clearer phrasing.')}>Singable</button>
                      </div>
                    </div>
                  </div>
                )}
                {showPro && <p className="hint">Pro: co-write these lyrics live with a producer AI that brings specialist writers into a group chat.</p>}
              </div>
            ) : blueprintStatus !== 'generating' ? (
              <p className="muted-copy">No blueprint yet. Hit Generate Blueprint and the songwriter AI turns your Idea tab into full lyrics, BPM, key and an engine-ready caption.</p>
            ) : null}
          </div>
        )}

        {/* ---------- Setup tab ---------- */}
        {visibleTab === 'setup' && (
          <div className="tab-scroll">
            <div className="tab-header">
              <div>
                <h3>Song Setup</h3>
                <small>Voice, length, quality and structure.</small>
              </div>
            </div>

            <div className="setup-grid">
              <label className="stacked">Vocal Mode
                <div className="segmented">
                  <button className={vocalMode === 'vocals' ? 'seg active' : 'seg'} onClick={() => set({ vocalMode: 'vocals', lyricsTab: lyricsTab === 'instrumental' ? 'prompt' : lyricsTab })}>Vocals</button>
                  <button className={vocalMode === 'instrumental' ? 'seg active' : 'seg'} onClick={() => set({ vocalMode: 'instrumental', lyricsTab: 'instrumental' })}>Instrumental</button>
                </div>
              </label>

              <label className="stacked">Energy
                <div className="segmented small">
                  {(['chill', 'balanced', 'hype'] as const).map((e) => (
                    <button key={e} className={energy === e ? 'seg active' : 'seg'} onClick={() => set({ energy: e })}>{e[0].toUpperCase() + e.slice(1)}</button>
                  ))}
                </div>
              </label>

              <label className="stacked">Tempo Feel
                <div className="segmented small">
                  {(['auto', 'slow', 'medium', 'fast'] as const).map((t) => (
                    <button key={t} className={tempoFeel === t ? 'seg active' : 'seg'} onClick={() => set({ tempoFeel: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
                  ))}
                </div>
              </label>

              {vocalMode === 'vocals' && (
                <label className="stacked">Vocal Character
                  <div className="segmented small">
                    {(['any', 'male', 'female'] as const).map((g) => (
                      <button key={g} className={vocalGender === g ? 'seg active' : 'seg'} onClick={() => set({ vocalGender: g })}>{g[0].toUpperCase() + g.slice(1)}</button>
                    ))}
                  </div>
                </label>
              )}

              {showAdvanced && vocalMode === 'vocals' && (
                <label className="stacked">Language
                  <select value={language} onChange={(e) => set({ language: e.target.value })}>
                    {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </label>
              )}

              <label className="stacked">Quality / Speed
                <select value={performance} onChange={(e) => set({ performance: e.target.value as PerformancePreset })}>
                  <option value="fast_draft">Fast Draft</option>
                  <option value="balanced">Balanced</option>
                  <option value="high_quality">High Quality</option>
                  <option value="experimental">Experimental</option>
                </select>
              </label>

              {showAdvanced && (
                <label className="stacked">Variations
                  <div className="segmented small">
                    {[1, 2].map((n) => (
                      <button key={n} className={variations === n ? 'seg active' : 'seg'} onClick={() => set({ variations: n })}>{n}</button>
                    ))}
                  </div>
                  <span className="hint">2 max — your GPU's safe batch limit</span>
                </label>
              )}

              <div className="duration-box span-2">
                <div className="slider-top"><span>Duration</span><span className="slider-value">{durationMode === 'auto' ? 'Auto' : `${formatSeconds(durationMin)} - ${formatSeconds(durationMax)}`}</span></div>
                <div className="segmented small duration-modes">
                  {(Object.keys(DURATION_MODES) as DurationMode[]).map((mode) => (
                    <button key={mode} className={durationMode === mode ? 'seg active' : 'seg'} onClick={() => applyDurationMode(mode)}>{DURATION_MODES[mode].label}</button>
                  ))}
                </div>
                {durationMode === 'auto' ? (
                  <div className="inline-note"><Info size={14} /> Auto uses your structure to choose a safe target length.</div>
                ) : (
                  <>
                    <label className="duration-range">
                      Min length
                      <input type="range" min={durationConfig.min} max={durationConfig.max} step={durationConfig.step} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
                    </label>
                    <label className="duration-range">
                      Max length
                      <input type="range" min={durationConfig.min} max={durationConfig.max} step={durationConfig.step} value={durationMax} onChange={(e) => setDurationMax(Number(e.target.value))} />
                    </label>
                    <div className="slider-scale"><span>{formatSeconds(durationConfig.min)}</span><span>{formatSeconds(durationConfig.max)}</span></div>
                  </>
                )}
              </div>

              {showAdvanced && (
                <div className="stacked-block span-2">
                  <div className="slider-row">
                    <div className="slider-top"><span>Style Strength</span><span className="slider-value">{styleStrength}%</span></div>
                    <input type="range" min={0} max={100} value={styleStrength} onChange={(e) => set({ styleStrength: Number(e.target.value) })} />
                  </div>
                  <span className="chip-label">Structure</span>
                  <div className="chip-wrap">
                    {STRUCTURE.map((part) => (
                      <button key={part} className={pickedStructure.includes(part) ? 'chip on' : 'chip'} onClick={() => toggleIn('pickedStructure', part)}>{part}</button>
                    ))}
                  </div>
                </div>
              )}

              {showAdvanced && vocalMode === 'vocals' && (
                <div className="stacked-block span-2">
                  <span className="chip-label">Vocals</span>
                  <div className="chip-wrap">
                    {VOCALS.map((v) => (
                      <button key={v} className={pickedVocals.includes(v) ? 'chip on' : 'chip'} onClick={() => toggleIn('pickedVocals', v)}>{v}</button>
                    ))}
                  </div>
                </div>
              )}

              {showAdvanced && (
                <div className="stacked-block span-2">
                  <span className="chip-label">Engine Controls</span>
                  <div className="field-grid">
                    <label>BPM<input type="number" value={bpm} onChange={(e) => set({ bpm: e.target.value ? Number(e.target.value) : '' })} placeholder="Auto" /></label>
                    <label>Key<input value={musicKey} onChange={(e) => set({ musicKey: e.target.value })} placeholder="Auto" /></label>
                    <label>Inference Steps
                      <select value={inferenceSteps} onChange={(e) => set({ inferenceSteps: Number(e.target.value) })}>
                        <option value={0}>Auto (preset)</option>
                        <option value={8}>8 — fast</option>
                        <option value={12}>12</option>
                        <option value={20}>20</option>
                        <option value={28}>28 — max quality</option>
                      </select>
                    </label>
                  </div>
                  <div className="slider-row">
                    <div className="slider-top"><span>Guidance Scale</span><span className="slider-value">{guidanceScale.toFixed(1)}</span></div>
                    <input type="range" min={1} max={15} step={0.5} value={guidanceScale} onChange={(e) => set({ guidanceScale: Number(e.target.value) })} />
                    <span className="hint">Higher follows your prompt harder; lower is looser and more creative.</span>
                  </div>
                </div>
              )}

              {showPro && (
                <div className="stacked-block span-2">
                  <span className="chip-label">Mode Library</span>
                  <div className="chip-wrap">
                    {MODE_LIBRARY.map((m) => (
                      <button key={m.id} className={creationMode === m.id ? 'chip on' : 'chip'} title={m.desc} onClick={() => { set({ creationMode: m.id }); if (m.id === 'instrumental') set({ vocalMode: 'instrumental', lyricsTab: 'instrumental' }) }}>{m.label}</button>
                    ))}
                  </div>
                  {editing && <div className="inline-note"><Info size={14} /> {MODE_LIBRARY.find((m) => m.id === creationMode)?.label} needs a source track - coming in a later pass.</div>}
                </div>
              )}

              {showPro && (
                <div className="stacked-block span-2">
                  <label className="stacked">
                    Negative Prompt - sounds to avoid
                    <textarea className="grow-area short" value={negativePrompt} onChange={(e) => set({ negativePrompt: e.target.value })} />
                  </label>
                  <label className="stacked">Seed
                    <input type="number" value={seed ?? ''} onChange={(e) => set({ seed: e.target.value ? Number(e.target.value) : null })} placeholder="Random" />
                  </label>
                </div>
              )}

              {showPro && (
                <div className="stacked-block span-2">
                  <span className="chip-label">AI Lab</span>
                  <div className="slider-row">
                    <div className="slider-top"><span>Thinking Power — writer &amp; Random Idea</span><span className="slider-value">{thinkingPower}/5</span></div>
                    <input type="range" min={1} max={5} step={1} value={thinkingPower} onChange={(e) => set({ thinkingPower: Number(e.target.value) })} />
                    <span className="hint">{thinkingPower >= 3 ? 'Models reason before answering — slower, noticeably better ideas and lyrics.' : 'Fast, direct answers.'}</span>
                  </div>
                  <div className="field-grid">
                    <div className="slider-row"><div className="slider-top"><span>LM Temperature</span><span className="slider-value">{lmTemperature.toFixed(2)}</span></div><input type="range" min={0.1} max={1.5} step={0.05} value={lmTemperature} onChange={(e) => set({ lmTemperature: Number(e.target.value) })} /></div>
                    <div className="slider-row"><div className="slider-top"><span>LM Top-P</span><span className="slider-value">{lmTopP.toFixed(2)}</span></div><input type="range" min={0.1} max={1} step={0.05} value={lmTopP} onChange={(e) => set({ lmTopP: Number(e.target.value) })} /></div>
                    <div className="slider-row"><div className="slider-top"><span>Repetition Penalty</span><span className="slider-value">{repetitionPenalty.toFixed(2)}</span></div><input type="range" min={1} max={1.5} step={0.01} value={repetitionPenalty} onChange={(e) => set({ repetitionPenalty: Number(e.target.value) })} /></div>
                    <label className="stacked">Constrained Decoding
                      <div className="segmented small">
                        <button className={constrainedDecoding ? 'seg active' : 'seg'} onClick={() => set({ constrainedDecoding: true })}>On</button>
                        <button className={!constrainedDecoding ? 'seg active' : 'seg'} onClick={() => set({ constrainedDecoding: false })}>Off</button>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------- Contextual action bar (compact, per-tab) ---------- */}
      <div className="studio-actionbar">
        {visibleTab === 'idea' && vocalMode === 'vocals' ? (
          <>
            <label className="writer-inline">
              <span>Writer</span>
              <select value={writerModel} onChange={(e) => setWriterModel(e.target.value)}>
                <option value="auto">Auto</option>
                {writerModels.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="engine">ACE LM</option>
              </select>
            </label>
            <button
              className={actionClass('generateBlueprint', 'generate-cta compact')}
              onClick={() => queueAction('generateBlueprint')}
              disabled={!engineReady && !actionQueue.includes('generateBlueprint')}
            >
              <Wand2 size={18} /> {actionLabel('generateBlueprint', 'Generate Blueprint', 'Generating...')}
            </button>
          </>
        ) : (
          <button className="generate-cta compact" onClick={() => void submitGeneration()} disabled={!canGenerate}>
            <AudioLines size={18} /> {generateLabel()}
          </button>
        )}
      </div>

      {/* ---------- Your Creations (compact strip) ---------- */}
      <div className="creations-strip">
        <div className="creations-strip-head">
          <span className="chip-label">Your Creations</span>
          <button className="link-btn" onClick={() => setRoute('library')}>View all</button>
        </div>
        <div className="creations-row">
          {tasks.map((task) => {
            const failed = task.status === 'error' || task.status === 'failed'
            const pct = task.progress != null ? Math.round(Math.min(task.progress, 1) * 100) : null
            const stage = (task.progressText || '').split('|').pop()?.trim() || task.status
            return (
              <article className={`creation-card ${failed ? 'failed' : 'pending'}`} key={task.id}>
                <div className="creation-cover working">
                  {failed ? <X size={20} /> : (
                    <span className="eq-bars"><i /><i /><i /><i /><i /></span>
                  )}
                  {!failed && pct != null && <span className="cover-pct">{pct}%</span>}
                </div>
                {!failed && (
                  <div className="task-progress">
                    <div className="task-progress-fill" style={{ width: `${pct ?? 4}%` }} />
                  </div>
                )}
                <strong className="ellipsis">{task.request.title}</strong>
                <small className="ellipsis" title={task.error || stage}>{task.error || stage}</small>
              </article>
            )
          })}
          {songs.slice(0, 12).map((song, index) => (
            <article className="creation-card" key={song.id} onClick={() => playSong(song)}>
              <div className="creation-cover"><Cover hue={(index * 52 + 280) % 360} size="md" label /></div>
              <strong className="ellipsis">{song.title}</strong>
              <small className="ellipsis">{song.mode}</small>
            </article>
          ))}
          {!songs.length && !tasks.length && <div className="empty-inline">Your generated songs will line up here.</div>}
        </div>
      </div>
    </section>
  )
}
