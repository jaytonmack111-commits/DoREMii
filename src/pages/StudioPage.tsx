import { useEffect } from 'react'
import { AudioLines, Check, Dices, Info, ListChecks, Music2, RefreshCw, Users, Wand2, X } from 'lucide-react'
import { useRoomStore } from '../stores/roomStore'
import { BlueprintStatusPanel } from '../components/ui/BlueprintStatusPanel'
import { Cover } from '../components/ui/Cover'
import { LANGUAGES, MODE_LIBRARY, PRESET_PACKS, STRUCTURE, TAG_CATEGORIES, VOCALS, WORKSHOP_TOOLS } from '../lib/constants'
import { useAppStore } from '../stores/appStore'
import { usePlayerStore } from '../stores/playerStore'
import { isEditingMode, useStudioStore, type DetailTier } from '../stores/studioStore'
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
    customTagInput, blueprint, blueprintStatus, blueprintError, lyricsCraft, lyricsQuality, lyricsQualityBusy, lyricsRewriteBusy, writerStage,
    enhanceStyleBusy, enhanceWordsBusy, titleBusy,
    writerModel, writerModels, tasks, generating, set, toggleIn, setWriterModel, loadWriterModels,
    addCustomTag, applyPack, randomIdea, enhanceStyle, enhanceWords, suggestSongTitle, generateBlueprint, patchBlueprint, analyzeBlueprintLyrics, rewriteBlueprintLyrics,
    acceptBlueprint, rejectBlueprint, resetBlueprint, submitGeneration,
  } = studio

  useEffect(() => { void loadWriterModels() }, [loadWriterModels])

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

  function dockHint() {
    if (editing) return `${MODE_LIBRARY.find((m) => m.id === creationMode)?.label} needs a source track - coming in a later pass.`
    if (!engineReady) {
      if (engineWarming) return 'Loading the local models in the background - Generate unlocks when they are ready.'
      if (engine.state === 'error') return engine.lastError || 'Engine needs attention. Check Settings diagnostics.'
      return 'The local engine starts automatically when DoReMii opens.'
    }
    if (vocalMode === 'vocals' && !hasLyricsForVocals) return 'Vocal songs need lyrics: write your own in step 1, or generate and accept a blueprint in step 2.'
    return `${vocalMode === 'vocals' ? 'Vocal song' : 'Instrumental'} · ${durationMode === 'auto' ? 'auto length' : `${formatSeconds(durationMin)}-${formatSeconds(durationMax)}`} · ${variations} variation${variations > 1 ? 's' : ''}`
  }

  return (
    <section className="page studio">
      <div className="studio-head">
        <div>
          <span className="eyebrow">Create Music</span>
          <h1>Build a track from the idea outward.</h1>
        </div>
        <div className="studio-head-actions">
          <button className="mini-action" onClick={randomIdea}><Dices size={15} /> Random Idea</button>
          <div className="segmented small">
            {TIERS.map((t) => (
              <button key={t.id} className={tier === t.id ? 'seg active' : 'seg'} onClick={() => set({ tier: t.id })}>{t.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Step 1: The Idea ---------- */}
      <section className="step-card">
        <header className="step-head">
          <span className="step-num">1</span>
          <div>
            <h3>The Idea</h3>
            <small>Name it, describe it, and shape the sound in plain words.</small>
          </div>
        </header>

        <div className="idea-grid">
          <div className="stacked-block span-all">
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

          <div className="stacked-block">
            <div className="block-head">
              <span className="chip-label">{lyricsTab === 'write' ? 'Lyrics' : lyricsTab === 'prompt' ? 'Idea' : 'Instrumental'}</span>
              <div className="segmented small">
                {(['write', 'prompt', 'instrumental'] as const).map((tab) => (
                  <button
                    key={tab}
                    className={lyricsTab === tab ? 'seg active' : 'seg'}
                    onClick={() => set({ lyricsTab: tab, vocalMode: tab === 'instrumental' ? 'instrumental' : 'vocals' })}
                  >
                    {tab === 'write' ? 'Write' : tab === 'prompt' ? 'Prompt' : 'Instrumental'}
                  </button>
                ))}
              </div>
            </div>
            {lyricsTab === 'instrumental' ? (
              <div className="instrumental-note"><Music2 size={18} /> Instrumental mode - no vocals or lyrics will be generated.</div>
            ) : lyricsTab === 'write' ? (
              <>
                <textarea className="grow-area roomy" value={lyrics} onChange={(e) => set({ lyrics: e.target.value })} placeholder={'[Verse]\nWrite your lyrics here...'} />
                <div className="area-foot">
                  <button className="mini-action accent" onClick={() => void enhanceWords()} disabled={enhanceWordsBusy}>
                    <Wand2 size={14} /> {enhanceWordsBusy ? 'Polishing...' : 'Enhance Lyrics'}
                  </button>
                  <span className="counter">{lyrics.length} chars</span>
                </div>
                <div className="chip-wrap">
                  {WORKSHOP_TOOLS.map((tool) => (
                    <button key={tool} className="chip" onClick={() => soon(`Lyrics ${tool}`)}>{tool}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <textarea className="grow-area roomy" value={songIdea} onChange={(e) => set({ songIdea: e.target.value })} placeholder="Describe the song you want - the story, mood, energy, hook..." />
                <div className="area-foot">
                  <button className="mini-action accent" onClick={() => void enhanceWords()} disabled={enhanceWordsBusy}>
                    <Wand2 size={14} /> {enhanceWordsBusy ? 'Sharpening...' : 'Enhance Idea'}
                  </button>
                  <span className="counter">{songIdea.length} chars</span>
                </div>
              </>
            )}
          </div>

          <div className="stacked-block">
            <div className="block-head">
              <span className="chip-label">Sound &amp; Style</span>
              <span className="hint">The AI maps your words to engine tags</span>
            </div>
            <textarea
              className="grow-area roomy"
              value={styleText}
              onChange={(e) => set({ styleText: e.target.value })}
              placeholder="Describe the sound in your own words - genre, mood, instruments, era, energy..."
            />
            <div className="area-foot">
              <button className="mini-action accent" onClick={() => void enhanceStyle()} disabled={enhanceStyleBusy}>
                <Wand2 size={14} /> {enhanceStyleBusy ? 'Enhancing...' : 'Enhance Style'}
              </button>
              <span className="counter">{styleText.length} chars</span>
            </div>
          </div>

          <div className="stacked-block tag-column">
            <div className="block-head">
              <span className="chip-label">Tag Library</span>
              {tagCount > 0 && <em className="count-badge">{tagCount} picked</em>}
            </div>
            <span className="chip-label">Preset Packs</span>
            <div className="chip-wrap">
              {PRESET_PACKS.map((pack) => (
                <button key={pack.name} className="chip" onClick={() => applyPack(pack)}>{pack.name}</button>
              ))}
            </div>
            <input className="tag-search" value={tagFilter} onChange={(e) => set({ tagFilter: e.target.value })} placeholder="Search genres, moods, instruments..." />
            {TAG_CATEGORIES.map((category) => {
              const items = category.items.filter((item) => !filter || item.toLowerCase().includes(filter))
              if (!items.length) return null
              return (
                <div className="tag-group" key={category.id}>
                  <span className="chip-label">{category.label}</span>
                  <div className="chip-wrap">
                    {items.map((item) => (
                      <button
                        key={item}
                        className={selectedByCategory[category.id].includes(item) ? 'chip on' : 'chip'}
                        onClick={() => toggleIn(TAG_STORE_KEYS[category.id], item)}
                      >
                        {item}
                      </button>
                    ))}
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
              <button className="mini-action" onClick={addCustomTag}>Add Tag</button>
            </div>
            {!!pickedCustomTags.length && (
              <div className="chip-wrap">
                {pickedCustomTags.map((tag) => (
                  <button key={tag} className="chip on" onClick={() => toggleIn('pickedCustomTags', tag)}>{tag}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Step 2: Blueprint ---------- */}
      {vocalMode === 'vocals' && (
        <section className="step-card">
          <header className="step-head">
            <span className="step-num">2</span>
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
              <button className="mini-action accent" onClick={() => void generateBlueprint()} disabled={!engineReady || blueprintStatus === 'generating'}>
                <Wand2 size={14} />
                {blueprintStatus === 'generating' ? 'Generating...' : blueprint ? 'Regenerate' : 'Generate Blueprint'}
              </button>
            </div>
          </header>

          <BlueprintStatusPanel
            status={blueprintStatus}
            error={blueprintError}
            writerStage={writerStage}
            onRetry={() => void generateBlueprint()}
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
              <div className="intent-preview">
                <div>
                  <strong>Based on your idea</strong>
                  <span>{songIdea.trim() || 'No separate idea written yet'}</span>
                </div>
                <div>
                  <strong>Production style</strong>
                  <span>{blueprint.caption || styleText || 'No style caption yet'}</span>
                </div>
                <div>
                  <strong>Required lyric structure</strong>
                  <span>Verse 1, Chorus, Verse 2, Chorus, Bridge, Final Chorus, Outro</span>
                </div>
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
                <button className="mini-action" onClick={() => void generateBlueprint()}><RefreshCw size={14} /> Reroll</button>
                <button className="mini-action danger" onClick={rejectBlueprint}><X size={14} /> Discard</button>
                {showPro && (
                  <button className="writers-room-cta" onClick={() => void useRoomStore.getState().openRoom()}>
                    <Users size={15} /> Open the Writers&rsquo; Room
                  </button>
                )}
              </div>
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
          ) : (
            <p className="muted-copy">No blueprint yet. Hit Generate Blueprint and the songwriter AI turns step 1 into full lyrics, BPM, key and an engine-ready caption.</p>
          )}
        </section>
      )}

      {/* ---------- Step 3: Song Setup ---------- */}
      <section className="step-card">
        <header className="step-head">
          <span className="step-num">{vocalMode === 'vocals' ? 3 : 2}</span>
          <div>
            <h3>Song Setup</h3>
            <small>Voice, length, quality and structure.</small>
          </div>
        </header>

        <div className="setup-grid">
          <label className="stacked">Vocal Mode
            <div className="segmented">
              <button className={vocalMode === 'vocals' ? 'seg active' : 'seg'} onClick={() => set({ vocalMode: 'vocals', lyricsTab: lyricsTab === 'instrumental' ? 'prompt' : lyricsTab })}>Vocals</button>
              <button className={vocalMode === 'instrumental' ? 'seg active' : 'seg'} onClick={() => set({ vocalMode: 'instrumental', lyricsTab: 'instrumental' })}>Instrumental</button>
            </div>
          </label>

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
              <div className="field-grid">
                <label>BPM<input type="number" value={bpm} onChange={(e) => set({ bpm: e.target.value ? Number(e.target.value) : '' })} placeholder="Auto" /></label>
                <label>Key<input value={musicKey} onChange={(e) => set({ musicKey: e.target.value })} placeholder="Auto" /></label>
                <label>Seed<input type="number" value={seed ?? ''} onChange={(e) => set({ seed: e.target.value ? Number(e.target.value) : null })} placeholder="Random" /></label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- Sticky generate dock ---------- */}
      <div className="generate-dock">
        <span className="dock-hint">{dockHint()}</span>
        <button className="generate-cta dock-cta" onClick={() => void submitGeneration()} disabled={!canGenerate}>
          <AudioLines size={20} />
          {generateLabel()}
        </button>
      </div>

      {/* ---------- Your Creations ---------- */}
      <div className="section-head tight"><h2>Your Creations</h2><button className="link-btn" onClick={() => setRoute('library')}>View all</button></div>
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
        {songs.slice(0, 10).map((song, index) => (
          <article className="creation-card" key={song.id} onClick={() => playSong(song)}>
            <div className="creation-cover"><Cover hue={(index * 52 + 280) % 360} size="md" label /></div>
            <strong className="ellipsis">{song.title}</strong>
            <small className="ellipsis">{song.mode}</small>
          </article>
        ))}
        {!songs.length && !tasks.length && <div className="empty-inline">Your generated songs will line up here.</div>}
      </div>
    </section>
  )
}
