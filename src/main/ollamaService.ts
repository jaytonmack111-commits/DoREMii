import { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import type { HookCandidate, LyricPlan, LyricPlanSection, LyricsCraftResult, LyricsDraftSnapshot, LyricsQualityReport, SectionDraft, SongBrief, SongIntent, WriterProgressEvent } from '../shared/types.js'
import { getEngineSettings } from './modelSettings.js'

const OLLAMA_URL = 'http://127.0.0.1:11434'
/** Fast-first fallback order: 4b fits alongside ACE and writes a full song in
 *  one pass; bigger models stay available for deep cook; qwen2.5:1.5b is the
 *  lightest option (non-thinking, very fast) for low-VRAM moments. */
const WRITER_MODELS = ['qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen2.5:1.5b']
const ROOM_MODELS = ['qwen3:4b', 'qwen2.5:1.5b', 'qwen3:1.7b', 'llama3.2:3b', 'qwen3:8b', 'qwen3:14b']
const THINK_CTX = 16384
const CHAT_CTX = 8192
const MAX_OUTPUT_TOKENS = 4200
const LONG_THINK_CTX = 32768
const EXPERIMENTAL_THINK_CTX = 65536
let activeWriterAbort: AbortController | null = null
let writerCancelRequested = false

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function tokenBudgetFor(signalLabel: string, think: boolean) {
  if (/adherence/i.test(signalLabel)) return 260
  if (/flow/i.test(signalLabel)) return 420
  if (/critique|analysis/i.test(signalLabel)) return 650
  if (/scene/i.test(signalLabel)) return 650
  if (/title/i.test(signalLabel)) return 80
  if (/concept/i.test(signalLabel)) return 700
  if (/rewrite|draft/i.test(signalLabel)) return 3000
  if (/final/i.test(signalLabel)) return 1800
  return think ? 2200 : 1000
}

function contextWindowFor(model: string, think: boolean) {
  const settings = getEngineSettings()
  const preset = settings.ollamaContextPreset ?? 'long'
  if (!think) return preset === 'experimental' ? 16384 : CHAT_CTX
  const requested = preset === 'experimental' ? EXPERIMENTAL_THINK_CTX : preset === 'long' ? LONG_THINK_CTX : THINK_CTX
  // Keep PC Usable still allows longer context for small writers, but avoids
  // making 14B monopolize memory unless the user explicitly enters experimental mode.
  if (settings.resourceMode === 'keep_usable' && /14b/i.test(model) && preset !== 'experimental') return THINK_CTX
  return requested
}

export function cancelWriterJobs() {
  if (!activeWriterAbort) return { canceled: false }
  writerCancelRequested = true
  activeWriterAbort.abort()
  activeWriterAbort = null
  emitWriterProgress({ stage: 'canceled', note: 'Writer canceled by user.' })
  return { canceled: true }
}

// Tuned to ACE-Step's official musicians guide: lyrics are a TEMPORAL SCRIPT
// the music model reads, with its own tag language. Teaching the writer that
// dialect matters more than poetic ambition.
const SONGWRITER_SYSTEM = `You are a world-class professional songwriter writing lyrics for the ACE-Step music model. Lyrics are a temporal script: they control how the song unfolds over time, so format discipline matters as much as poetry.

CRAFT RULES:
- ONE core metaphor or image per song. Explore its facets across verses. Mixed metaphors (water -> fire -> flying) and adjective-stacking ("neon skies, electric hearts, endless dreams") are the #1 failure mode - never do them.
- The song tells one story about the user's idea: a person, a place, a change. Verse 2 develops what Verse 1 started.
- The chorus carries ONE memorable hook line built from the core image.
- Every sung line belongs to the user's topic. No drift.
- Write like a record is being built section by section: Verse 1 opens the situation, Chorus states the emotional thesis, Verse 2 changes or raises the stakes, Bridge reveals the turn, Final Chorus lifts/resolves, Outro leaves a clean afterimage.
- During rewrites, preserve strong on-topic bars, hooks, callbacks, and section anchors. Replace only weak, off-topic, unsingable, missing, or structurally broken material unless the whole section fails.

ACE FORMAT RULES (follow exactly):
- Section tags in square brackets on their own line: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Bridge], [Final Chorus], [Outro]. Blank line between sections.
- Follow the STRUCTURE PLAN given in the brief exactly - those sections, that order, roughly those line counts. Do not add or skip sections.
- 6-10 syllables per sung line, and lines in the same position of a section should match within 1-2 syllables (the model aligns syllables to beats).
- Think in 4-bar phrases. Most verse sections should be 4, 6, or 8 sung lines; choruses should feel like 4 strong bars plus a hook return. If you break the square pattern, do it once for tension, then resolve it.
- Rhyme with craft, not nursery-rhyme obviousness. Prefer slant rhyme, internal rhyme, vowel echo, and rhythmic callbacks. Avoid every line ending in a perfect AABB jingle unless the user asks for a children's song.
- Let the strongest rhyme or repeated hook land at the end of a bar/line. Do not force awkward word order just to rhyme.
- Avoid preschool couplets and generic poetic padding. Lines should sound singable when spoken over a beat, not like caption prose.
- You MAY use ACE performance tags on their own line inside sections: [Guitar Solo], [Instrumental], [Build], [Drop], [Breakdown], or a vocal hint joined to a section tag like [Chorus - anthemic]. Use at most 2-3 of these in the whole song, matching the musical style.
- Parentheses inside a sung line mean backing vocals: "We rise together (together)". Use sparingly.
- UPPERCASE words mean shouted/intense delivery: use only at true peaks.
- The chorus may repeat its hook; verses must never repeat lines verbatim; never repeat a whole section's text outside the chorus.
- The outro must be sung closure, not a tiny label or a tossed-off line. For normal songs, write 3-4 concise lines that resolve the hook or leave a memorable final image.
- Duration matters: a 3-5 minute vocal song needs enough lyric material to sustain the audio. Do not submit a two-line chorus or tiny verse sketch for a full song. Full songs usually need 24-40 sung lines across the required sections.
- If a draft is allowed to run for a long time, spend the time improving actual lyrics: choose stronger hooks, preserve good bars, repair weak lines, expand short sections, and re-check topic/flow. Never spend long runs on private reasoning that does not improve the visible song.
- When the current task asks for JSON, return JSON only. Inside the JSON, the "lyrics" field must contain ONLY the lyrics with their tags.
- When the current task does not ask for JSON, write ONLY the lyrics with their tags. No commentary, no titles, no markdown (** or #), no screenplay narration ("phone buzzes", "the crowd roars", "her voice cuts the heat") - every non-tag line is words the singer literally sings.`

const SCENE_SYSTEM = `You are a story developer for a hit songwriting team. Given a song idea, invent the CONCRETE story the song will tell. Answer briefly:
1. CORE PREMISE: the song's subject in one plain sentence.
2. POV: who is singing and what they want emotionally.
3. VERSE PATH: what Verse 1, Verse 2, Bridge, and Outro should each reveal.
4. IMAGE PALETTE: 4-6 concrete images the lyrics may reuse.
5. HOOKS: 3 candidate chorus hook lines with clear rhyme potential.
Do NOT write a movie synopsis, action scene, screenplay beat, video prompt, hidden-map twist, or paragraph of plot. Keep it under 170 words. This is a private worksheet, not lyrics.`

const CRITIC_SYSTEM = `You are a ruthless, brutally honest lyric critic for a major label. You destroy weak writing so the rewrite can be great. Inspect for:
- Clichés and dead phrases - especially: stars, dreams, night, heart, soul, fly, shine, light, journey. QUOTE every offender.
- Abstract greeting-card lines that paint no picture. QUOTE them.
- Lines that say nothing or repeat without purpose.
- Weak rhymes (moon/June tier), broken meter, unsingable mouthfuls.
- Story: does anything actually HAPPEN? Is there a person, a place, a change?
- Is the chorus hook genuinely memorable, and why or why not?
- Are these ACTUAL SUNG LYRICS, not screenplay/stage directions? Any narration like "voice cuts", "camera", "phone buzzes", "crowd roars", "singer enters", or italic action text is an automatic reject.
- Does the song have real structure: Verse 1, Chorus, Verse 2, Chorus, optional Bridge, final Chorus/Outro? Intro-only + one verse + one chorus is not enough.
- Are there too many repeated lines? Repeating whole sections outside choruses is an automatic reject.

Be specific, quote lines, end with the 3 highest-impact fixes.
Final line of your reply must be exactly "VERDICT: PASS" only if these lyrics are truly release-ready, otherwise "VERDICT: REJECT". Do NOT rewrite the song yourself.`

const RHYME_FLOW_SYSTEM = `You are a strict rhyme, flow, and singability checker. You do not care about being nice. Reject anything that is not sung lyrics.
Check:
- section structure
- screenplay/stage-direction contamination
- line length and mouth feel
- approximate syllable balance inside each section
- 4-bar phrase feel: verses/choruses should mostly group into 4, 6, or 8 lines
- rhyme or purposeful slant rhyme, internal rhyme, vowel echo, and hook callbacks
- nursery-rhyme/jingle patterns that feel too childish for the requested genre
- chorus hook strength
- repetition problems
Return concise bullet fixes and exactly one final line: VERDICT: PASS or VERDICT: REJECT.`

const ADHERENCE_SYSTEM = `You are DoReMii's prompt-adherence judge. Your job is not to be generous. Decide whether the lyrics actually serve the user's requested song idea.
Reject if the lyrics:
- change the subject
- only gesture at the topic vaguely
- follow the production style but ignore the lyrical premise
- drift into unrelated brands, ads, phones, candy, screenplay imagery, or random scenes
- miss the requested language, mood, genre, or vocal mode

Reply in exactly this shape:
SCORE: 0-100
VERDICT: PASS or NEEDS_WORK or FAIL
NOTES:
- short concrete note
- short concrete note`

const MUSIC_THEORY_SANDWICH = `SONGCRAFT / PROSODY LAYER:
- Start with a singable hook target before writing verses. A chorus without a memorable repeated idea is not finished.
- Lines should feel like bars: most lines land in 6-10 syllables, with stresses falling near the end of the line. Avoid 14+ syllable mouthfuls unless it is rap and the internal rhythm is clear.
- Use rhyme as architecture, not decoration: end rhymes, slant rhymes, internal echoes, alliteration, and callbacks should support the hook.
- Avoid nursery-rhyme sameness. If two consecutive lines perfect-rhyme, the next line should vary rhythm, image, or vowel sound.
- Verse 1 = situation. Verse 2 = consequence/change. Bridge = turn/reveal. Final chorus = bigger emotional meaning. Outro = clean final image or hook echo.
- Keep one central metaphor. Do not stack random pretty images. Relatable concrete detail beats abstract poetry.
- Rap/hip-hop: denser internal rhyme and sharper consonants, 8/16-bar feel, conversational punchlines, no generic inspirational slogans.
- Country/folk: plainspoken images, story progression, natural speech melody, title/hook payoff, not over-poetic.
- Pop/R&B: simple memorable hook, smooth vowels, emotional clarity, pre-chorus lift when useful, polished phrasing.
- Rock/metal/punk: direct verbs, physical energy, chantable chorus, fewer delicate abstractions.
- Electronic/dance: short rhythmic phrases, repeating hook fragments, kinetic verbs, space for drops and builds.`

const BLUEPRINT_PROMPT_SANDWICH = `BLUEPRINT INTELLIGENCE LAYER:
- Separate the job into three mental rooms: concept, music, and lyric. Concept decides what the song is about; music decides how it sounds; lyric decides what is literally sung.
- The idea box is sovereign. Sound/style can change instrumentation, tempo, genre, and mix, but it cannot change the story topic.
- Every blueprint must have a human anchor: who is singing, who/what they are singing to, what changed, and why the chorus matters.
- Before drafting lyrics, decide the chorus promise in plain English. If the chorus cannot be explained in one sentence, the song is not planned yet.
- Every section has a purpose: Verse 1 opens the human situation, Chorus states the hook, Verse 2 adds consequence, Bridge reveals the truth, Final Chorus lands the payoff, Outro leaves the final image.
- Use a repair mindset: keep strong bars, callbacks, and title-payoff lines. Rewrite weak sections surgically. Do not throw away the whole song unless it is structurally broken.
- Model compatibility rule: if strict JSON is hard for the current model, plain tagged lyrics are acceptable, but planning notes, critique, rhyme labels, and analysis are never acceptable inside the lyrics.`

export type { ChatMessage }

export async function chatRaw(model: string, messages: ChatMessage[], temperature: number, think: boolean, signalLabel: string): Promise<{ text: string; thinkBlock: string | null }> {
  return chat(model, messages, temperature, think, signalLabel)
}

async function chat(model: string, messages: ChatMessage[], temperature: number, think: boolean, signalLabel: string): Promise<{ text: string; thinkBlock: string | null }> {
  const qwenThinkingModel = /^qwen3:/i.test(model)
  // Only thinking models (qwen3, deepseek-r1) accept the `think` flag. Sending
  // think:true to a non-thinking model (qwen2.5, llama) makes Ollama error, so
  // those always run plain - which is also faster and leak-free.
  const apiThink = qwenThinkingModel && think
  const finalMessages = !apiThink && qwenThinkingModel
    ? messages.map((message, index) => index === messages.length - 1 && message.role === 'user'
      ? { ...message, content: `${message.content}\n\n/no_think` }
      : message)
    : messages
  // Watchdog: if the model produces NO tokens for this long, it is starved
  // (e.g. ACE holds the VRAM and the model is paging) - abort instead of
  // hanging the whole pipeline for ten minutes.
  const STALL_TIMEOUT_MS = think ? 120_000 : 45_000
  const controller = new AbortController()
  activeWriterAbort = controller
  let stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  const feedWatchdog = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS)
  }

  let response: Response
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: finalMessages,
        stream: true,
        think: apiThink,
        keep_alive: '15m',
        options: {
          temperature,
          num_ctx: contextWindowFor(model, think),
          num_predict: Math.min(MAX_OUTPUT_TOKENS, tokenBudgetFor(signalLabel, think)),
        },
      }),
    })
  } catch (error) {
    clearTimeout(stallTimer)
    if (controller.signal.aborted) {
      throw new Error(writerCancelRequested ? `Ollama ${signalLabel} canceled by user` : `Ollama ${signalLabel} stalled (no tokens for ${STALL_TIMEOUT_MS / 1000}s) - model ${model} is likely starved for VRAM`, { cause: error })
    }
    throw error
  }
  if (!response.ok) {
    clearTimeout(stallTimer)
    throw new Error(`Ollama ${signalLabel} failed: HTTP ${response.status}`)
  }
  let streamedText = ''
  let streamedThinking = ''
  const reader = response.body?.getReader()
  if (!reader) { clearTimeout(stallTimer); throw new Error(`Ollama ${signalLabel} returned no response body`) }
  const decoder = new TextDecoder()
  let buffer = ''
  try {
  while (true) {
    let done: boolean, value: Uint8Array | undefined
    try {
      ({ done, value } = await reader.read())
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(writerCancelRequested ? `Ollama ${signalLabel} canceled by user` : `Ollama ${signalLabel} stalled (no tokens for ${STALL_TIMEOUT_MS / 1000}s) - model ${model} is likely starved for VRAM`, { cause: error })
      }
      throw error
    }
    feedWatchdog()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as { message?: { content?: string; thinking?: string }; done?: boolean; error?: string }
      if (chunk.error) throw new Error(`Ollama ${signalLabel} failed: ${chunk.error}`)
      streamedText += chunk.message?.content ?? ''
      streamedThinking += chunk.message?.thinking ?? ''
    }
  }
  if (buffer.trim()) {
    const chunk = JSON.parse(buffer) as { message?: { content?: string; thinking?: string }; error?: string }
    if (chunk.error) throw new Error(`Ollama ${signalLabel} failed: ${chunk.error}`)
    streamedText += chunk.message?.content ?? ''
    streamedThinking += chunk.message?.thinking ?? ''
  }
  } finally {
    clearTimeout(stallTimer)
    if (activeWriterAbort === controller) activeWriterAbort = null
    writerCancelRequested = false
  }

  let text = stripReasoning(streamedText.trim())
  let thinkBlock = streamedThinking.trim() || null
  // Pull any stray <think> block out of the content channel into thinking.
  if (!thinkBlock) {
    const thinkMatch = streamedText.match(/<think>([\s\S]*?)<\/think>/)
    if (thinkMatch) thinkBlock = thinkMatch[1].trim()
  }
  // If the model reasoned in plain content anyway, salvage the real answer
  // instead of throwing - never hard-fail the pipeline on a reasoning leak.
  text = stripLeakedReasoning(text)
  // Last resort: if content is empty but we have thinking, recover its tail.
  if (!text && thinkBlock) {
    text = thinkBlock.split(/\n+/).filter(Boolean).slice(-6).join('\n')
  }
  if (!text) throw new Error(`Ollama ${signalLabel} returned an empty response`)

  return { text, thinkBlock }
}

export function emitWriterProgress(progress: string | WriterProgressEvent) {
  if (!BrowserWindow?.getAllWindows) return
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) {
    wins[0].webContents.send('writer:progress', typeof progress === 'string' ? { stage: progress } : progress)
  }
}

function modelPrefersPlainLyrics(model: string) {
  return !/^qwen3:/i.test(model) || /^qwen3:4b/i.test(model) || /^llama/i.test(model)
}

const LYRIC_SECTION_RE = /^\s*\[(?:intro|verse(?:\s*\d+)?|pre-chorus|chorus|hook|bridge|final chorus|outro|drop|breakdown|instrumental|build)[^\]]*\]\s*$/i
const NON_LYRIC_LINE_RE = /^(?:okay|first,|but wait|now,|alternatively|maybe|for the outro|rhyme\/flow|adherence|score:|verdict:|notes:|critic|local validator|rewrite instruction|requirements?:|the user|looking at|let's|i need|i should|return only|these lines|that'?s|this means|plan violation|prompt adherence|section scores?|line decisions?|song brief|story worksheet|selected hook|approved hook|best hook|hook promise|candidate|the chorus pays off|a professional critic|local validator rejects)\b/i

function sectionNameFromTag(line: string) {
  return line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1]?.toLowerCase().replace(/\s+/g, ' ').trim() ?? ''
}

function isSingableLyricLine(line: string) {
  const trimmed = line.trim().replace(/^[-*]\s*/, '')
  if (!trimmed) return false
  if (LYRIC_SECTION_RE.test(trimmed)) return false
  if (NON_LYRIC_LINE_RE.test(trimmed)) return false
  if (/^\s*(?:\d+[.)]|[A-F][.)]|hook\s+[a-f])\s+/i.test(trimmed)) return false
  if (/"[^"]+"/.test(trimmed) && /\b(?:pays off|listener|sing back|hook|title|line)\b/i.test(trimmed)) return false
  if (/\b(?:as a line the listener can sing back|pays off|hook target|line count target|rhyme\/meter|must include|avoid:|write only|return json|section tag)\b/i.test(trimmed)) return false
  if (/^\{|\}$/.test(trimmed)) return false
  return true
}

/** Clean model formatting tics so ACE gets pure [Tag] + sung-line lyrics. */
function sanitizeLyrics(text: string) {
  const cleaned = text
    .replace(/\*\*/g, '')                          // markdown bold
    .replace(/^\s*\*\([^)]*\)\*\s*$/gm, '')        // *(stage directions)*
    .replace(/^\s*\*[^*\n]+\*\s*$/gm, '')          // *phone buzzes twice*
    .replace(/\([^)\n]*(?:sfx|sound|camera|singer|voice|crowd|phone|enters|begins)[^)\n]*\)/gi, '')
    .replace(/^\s*#+\s*/gm, '')                    // markdown headers
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const lines: string[] = []
  let lastSection = ''
  for (const raw of cleaned.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const currentSection = sectionNameFromTag(line)
    if (currentSection) {
      if (currentSection === lastSection) continue
      lastSection = currentSection
      lines.push(`[${line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1]?.trim() ?? currentSection}]`)
      continue
    }
    if (line.trim() && NON_LYRIC_LINE_RE.test(line.trim())) continue
    if (/\b(?:the chorus pays off|as a line the listener can sing back|hook promise|story worksheet|selected hook|approved hook)\b/i.test(line)) continue
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeSectionLyrics(section: string, raw: string) {
  const clean = sanitizeLyrics(raw)
  const wanted = section.toLowerCase().replace(/\s+/g, ' ').trim()
  const sectionLines = sungLinesBySection(clean)[wanted]
  if (sectionLines?.length) return sanitizeLyrics(`${sectionTag(section)}\n${sectionLines.join('\n')}`)
  const singable = clean.split(/\r?\n/).filter((line) => isSingableLyricLine(line))
  return sanitizeLyrics(`${sectionTag(section)}\n${singable.join('\n')}`)
}

function extractJsonCandidates(text: string) {
  const cleaned = stripReasoning(text).trim()
  const candidates = new Set<string>()
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? []
  for (const block of fenced) {
    const inner = block.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
    if (inner.startsWith('{')) candidates.add(inner)
  }
  if (cleaned.startsWith('{')) candidates.add(cleaned)
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.add(cleaned.slice(start, i + 1))
        start = -1
      }
    }
  }
  const greedy = cleaned.match(/\{[\s\S]*\}/)?.[0]
  if (greedy) candidates.add(greedy)
  return [...candidates]
}

function extractLyricsOnly(raw: string) {
  const envelope = parseLyricsEnvelope(raw)
  const clean = sanitizeLyrics(stripLeakedReasoning(envelope?.lyrics || raw))
  const lines = clean.split(/\r?\n/)
  const start = lines.findIndex((line) => LYRIC_SECTION_RE.test(line))
  if (start === -1) return ''

  const kept: string[] = []
  for (const line of lines.slice(start)) {
    const trimmed = line.trim()
    if (trimmed && NON_LYRIC_LINE_RE.test(trimmed)) break
    if (/^\s*[-*]\s*(?:the|this|try|maybe|fix|replace|adjust)\b/i.test(trimmed)) break
    if (trimmed && !LYRIC_SECTION_RE.test(trimmed) && !isSingableLyricLine(trimmed)) break
    kept.push(line.replace(/\s+\([A-Z]\)\s*$/i, ''))
  }

  const extracted = sanitizeLyrics(kept.join('\n'))
  if (sungLinesBySection(extracted).untagged?.length) return ''
  const sungLineCount = Object.entries(sungLinesBySection(extracted))
    .filter(([section]) => section !== 'untagged')
    .flatMap(([, sectionLines]) => sectionLines)
    .length
  return sungLineCount >= 2 ? extracted : ''
}

function parseLyricsEnvelope(raw: string): { lyrics: string; keptLines?: string[]; rewrittenLines?: string[]; plan?: LyricPlan } | null {
  const candidates = extractJsonCandidates(raw)
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { lyrics?: unknown; keptLines?: unknown; rewrittenLines?: unknown; plan?: unknown }
      if (typeof parsed.lyrics === 'string' && parsed.lyrics.includes('[')) {
        return {
          lyrics: parsed.lyrics,
          keptLines: Array.isArray(parsed.keptLines) ? parsed.keptLines.filter((x): x is string => typeof x === 'string') : undefined,
          rewrittenLines: Array.isArray(parsed.rewrittenLines) ? parsed.rewrittenLines.filter((x): x is string => typeof x === 'string') : undefined,
          plan: isLyricPlan(parsed.plan) ? parsed.plan : undefined,
        }
      }
    } catch {
      // Not a JSON envelope - fall back to tagged lyric extraction.
    }
  }
  return null
}

async function repairLyricsEnvelope(model: string, raw: string, brief: string, lyricPlan: LyricPlan, label: string) {
  const rawText = stripLeakedReasoning(stripReasoning(raw)).slice(0, 5000)
  const repaired = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: `${brief}

The previous ${label} response was malformed or contained planning/critique text instead of clean lyrics.

Bad response to salvage or replace:
${rawText}

Repair task:
- If there are usable sung lines, keep the good on-topic bars.
- If not, write a fresh full lyric from the plan.
- Follow the lyric plan exactly.
- Do not include notes, critique, labels like "A/B", explanations, markdown, or prose outside JSON.

Return STRICT JSON only:
{"plan":${JSON.stringify(lyricPlan)},"lyrics":"[Verse 1]\\n...","keptLines":[],"rewrittenLines":[],"sectionScores":[],"notes":[]}`,
    },
  ], 0.65, true, `${label}-repair`)
  return extractLyricsOnly(repaired.text)
}

function makeDraftSnapshot(label: string, lyrics: string, note: string, intent?: SongIntent, idea?: string, previousLyrics?: string | null): LyricsDraftSnapshot {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    lyrics,
    note,
    createdAt: new Date().toISOString(),
    quality: buildQualityReport(lyrics, null, intent, idea),
    previousLyrics: previousLyrics ?? null,
  }
}

function sungLinesBySection(lyrics: string) {
  const sections: Record<string, string[]> = {}
  let current = 'untagged'
  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const tag = line.match(/^\[([^\]]+)\]$/)
    if (tag) {
      current = tag[1].toLowerCase()
      sections[current] ??= []
      continue
    }
    sections[current] ??= []
    sections[current].push(line)
  }
  return sections
}

const STOP_TOPIC_WORDS = new Set([
  'about', 'song', 'track', 'music', 'make', 'write', 'generate', 'energetic', 'upbeat', 'happy', 'sad',
  'dark', 'epic', 'cool', 'vibe', 'vibes', 'style', 'with', 'that', 'this', 'from', 'into', 'like',
  'and', 'the', 'for', 'you', 'your', 'our', 'are', 'was', 'were', 'will', 'would', 'should',
])

const DRIFT_TERMS = [
  'candy', 'chocolate', 'advertisement', 'commercial', 'jingle', 'product', 'brand',
  'phone', 'screen', 'camera', 'scene', 'script', 'screenplay', 'sarah', 'sister',
  'dollar', 'storefront', 'flavor', 'ribbon fluff',
]

const TOPIC_SYNONYMS: Record<string, string[]> = {
  camping: ['camping', 'campfire', 'campfires', 'tent', 'tents', 'trail', 'trails', 'pine', 'pines', 'forest', 'woods', 'backpack', 'lantern', 'campsite', 'wilderness', 'embers', 'sleeping bag'],
  camp: ['camp', 'campfire', 'tent', 'trail', 'forest', 'woods', 'campsite', 'lantern'],
  turtle: ['turtle', 'turtles', 'shell', 'reef', 'sea turtle'],
  shanty: ['shanty', 'sail', 'sails', 'deck', 'harbor', 'anchor', 'crew', 'sea'],
}

function normalizeWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
}

function getIntentIdea(intent?: SongIntent | null, fallbackIdea?: string) {
  return [
    intent?.songTitle,
    intent?.rawIdea,
    intent?.idea,
  ].filter(Boolean).join(' ').trim() || fallbackIdea?.trim() || ''
}

function buildTopicLock(intent?: SongIntent | null, fallbackIdea?: string, lyrics = '') {
  const idea = getIntentIdea(intent, fallbackIdea)
  const ideaWords = normalizeWords(idea)
  const requiredBase = ideaWords
    .filter((word) => word.length > 3 && !STOP_TOPIC_WORDS.has(word))
    .slice(0, 8)
  const expanded = new Set<string>()
  for (const word of requiredBase) {
    expanded.add(word)
    for (const synonym of TOPIC_SYNONYMS[word] ?? []) expanded.add(synonym)
  }
  const requiredTerms = Array.from(expanded)
  const lyricText = lyrics.toLowerCase()
  const matchedTerms = requiredTerms.filter((term) => lyricText.includes(term.toLowerCase()))
  const missingTerms = requiredBase.filter((term) => {
    const group = [term, ...(TOPIC_SYNONYMS[term] ?? [])]
    return !group.some((candidate) => lyricText.includes(candidate.toLowerCase()))
  })
  const ideaLower = idea.toLowerCase()
  const forbiddenDrift = DRIFT_TERMS.filter((term) => lyricText.includes(term) && !ideaLower.includes(term))
  return { requiredTerms, matchedTerms, missingTerms, forbiddenDrift }
}

function expectedSectionsFor(intent?: SongIntent | null) {
  if (intent?.vocalMode === 'instrumental') return []
  // Single source of truth: the same duration-aware plan the writer was given.
  // Intro/Pre-Chorus and performance tags are optional extras, never required.
  return structurePlanFor(intent ?? undefined).sections
    .map((s) => s.tag.replace(/[[\]]/g, '').toLowerCase())
    .filter((name) => !/^(intro|pre-chorus)/.test(name))
}

function hasExpectedSection(sectionNames: string[], expected: string) {
  if (expected === 'hook') return sectionNames.some((name) => /hook|chorus|drop/i.test(name))
  if (expected === 'final chorus') return sectionNames.some((name) => /final\s*chorus|chorus/i.test(name))
  return sectionNames.some((name) => name.replace(/\s+/g, ' ').trim() === expected || name.startsWith(expected))
}

function parseAdherence(text: string): LyricsQualityReport['semanticAdherence'] {
  const scoreMatch = text.match(/SCORE:\s*(\d+)/i)
  const verdictRaw = text.match(/VERDICT:\s*(PASS|NEEDS_WORK|FAIL)/i)?.[1]?.toLowerCase()
  const score = scoreMatch ? Math.max(0, Math.min(100, Number(scoreMatch[1]))) : 65
  const verdict = verdictRaw === 'pass' ? 'pass' : verdictRaw === 'fail' ? 'fail' : 'needs_work'
  const notesBlock = text.split(/NOTES:/i)[1] ?? text
  const notes = notesBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 5)
  return { score, verdict, notes }
}

function validateLyrics(lyrics: string, intent?: SongIntent | null, fallbackIdea?: string): string[] {
  const issues: string[] = []
  if (intent?.vocalMode === 'instrumental') return issues
  const clean = sanitizeLyrics(lyrics)
  const sections = sungLinesBySection(clean)
  const sectionNames = Object.keys(sections)
  const allLines = Object.values(sections).flat()
  const nonChorusLines = Object.entries(sections)
    .filter(([name]) => !/^chorus/.test(name))
    .flatMap(([, lines]) => lines)
  const hasVerse1 = sectionNames.some((name) => /^verse\s*1?$/.test(name))
  const hasVerse2 = sectionNames.some((name) => /^verse\s*2$/.test(name))
  const hasChorus = sectionNames.some((name) => /^chorus/.test(name))
  const outroLines = Object.entries(sections)
    .filter(([name]) => /^outro/.test(name))
    .flatMap(([, lines]) => lines)
  const expectedSections = expectedSectionsFor(intent)
  const missingSections = [...new Set(expectedSections)].filter((section) => !hasExpectedSection(sectionNames, section))
  for (const section of missingSections) {
    issues.push(`Missing [${section.replace(/\b\w/g, (char) => char.toUpperCase())}].`)
  }
  if (!intent) {
    if (!hasVerse1) issues.push('Missing [Verse 1].')
    if (!hasVerse2) issues.push('Missing [Verse 2].')
    if (!hasChorus) issues.push('Missing [Chorus].')
  }
  const durationMax = Number(intent?.durationMax ?? 150)
  const minLines = intent?.durationMode === 'sample'
    ? 2
    : intent?.durationMode === 'loop'
      ? 6
      : durationMax >= 300
        ? 38
        : durationMax >= 240
          ? 32
          : durationMax >= 180
            ? 26
            : durationMax >= 120
              ? 22
              : 16
  if (allLines.length < minLines) issues.push(`Too short for this ${intent?.durationMode ?? 'song'} (${Math.round(durationMax)}s max); needs about ${minLines}+ sung lines or a shorter duration.`)
  if ((intent?.durationMode ?? 'song') === 'song' && expectedSections.includes('outro') && outroLines.length > 0 && outroLines.length < 3) {
    issues.push('Outro is too short; normal songs need 3-4 sung closing lines that resolve the central idea.')
  }
  for (const [section, lines] of Object.entries(sections)) {
    if (/^verse\s*[12]/.test(section) && lines.length > 0 && lines.length < 4) {
      issues.push(`[${section.replace(/\b\w/g, (char) => char.toUpperCase())}] is too short; verses need at least 4 sung lines.`)
    }
    if (/^(chorus|final chorus)/.test(section) && lines.length > 0 && lines.length < 4) {
      issues.push(`[${section.replace(/\b\w/g, (char) => char.toUpperCase())}] is too short; choruses need at least 4 singable hook lines.`)
    }
    if (/^bridge/.test(section) && durationMax >= 120 && lines.length > 0 && lines.length < 4) {
      issues.push('[Bridge] is too short; full songs need a real turn, usually 4 lines.')
    }
  }

  const screenplayPattern = /\b(?:voice cuts|camera|we see|scene|phone buzz|buzzes|crowd roars|singer enters|vocal enters|begins singing|verse opens|the track|arrangement|instrumental|sfx|stage direction|screenplay)\b/i
  for (const line of allLines) {
    if (/^\*.*\*$/.test(line) || screenplayPattern.test(line)) {
      issues.push(`Screenplay/stage direction line is not singable: "${line}"`)
      break
    }
    const words = line.replace(/[^\p{L}' -]/gu, '').split(/\s+/).filter(Boolean)
    if (words.length > 16) {
      issues.push(`Line is too long to sing naturally: "${line}"`)
      break
    }
  }

  const normalized = nonChorusLines
    .map((line) => line.toLowerCase().replace(/[^\p{L}' ]/gu, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 8)
  const unique = new Set(normalized)
  if (normalized.length >= 8 && unique.size / normalized.length < 0.72) {
    issues.push('Too many repeated lines outside intentional chorus hooks.')
  }
  if (/\b(?:i can't stop asking the questions|everything's in my way|you always stay strong)\b/i.test(clean)) {
    issues.push('Detected generic ACE fallback repetition pattern.')
  }
  const topicLock = buildTopicLock(intent, fallbackIdea, clean)
  if (topicLock.requiredTerms.length && topicLock.matchedTerms.length === 0) {
    issues.push(`Off-prompt: the lyrics do not clearly use the song idea (${topicLock.requiredTerms.slice(0, 5).join(', ')}).`)
  } else if (topicLock.missingTerms.length >= Math.min(3, Math.max(1, topicLock.requiredTerms.length))) {
    issues.push(`Weak prompt match: missing core idea words like ${topicLock.missingTerms.slice(0, 4).join(', ')}.`)
  }
  if (topicLock.forbiddenDrift.length) {
    issues.push(`Off-topic drift detected: ${topicLock.forbiddenDrift.slice(0, 5).join(', ')}.`)
  }
  const prosody = analyzeProsody(clean)
  if (prosody.outlierLines.length) {
    issues.push(`Uneven syllable flow: ${prosody.outlierLines[0]}`)
  }
  if (prosody.fourBarWarnings.length) {
    issues.push(prosody.fourBarWarnings[0])
  }
  if (prosody.nurseryRhymeWarnings.length) {
    issues.push(prosody.nurseryRhymeWarnings[0])
  }
  return issues
}

function estimateSyllables(line: string) {
  const words = line.toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(Boolean)
  let total = 0
  for (const word of words) {
    const clean = word.replace(/'s$/, '').replace(/[^a-z]/g, '')
    if (!clean) continue
    const groups = clean.match(/[aeiouy]+/g)?.length ?? 1
    const silentE = clean.length > 3 && /e$/.test(clean) && !/[aeiouy]le$/.test(clean) ? 1 : 0
    total += Math.max(1, groups - silentE)
  }
  return Math.max(1, total)
}

function endRhymeKey(line: string) {
  const last = line.toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(Boolean).pop() ?? ''
  const clean = last.replace(/'s$/, '').replace(/[^a-z]/g, '')
  if (!clean) return ''
  const match = clean.match(/[aeiouy][a-z]*$/)
  return match?.[0] ?? clean.slice(-3)
}

function internalEchoes(line: string) {
  const words = line.toLowerCase().replace(/[^a-z'\s-]/g, ' ').split(/\s+/).filter(Boolean)
  const keys = words.map((word) => {
    const clean = word.replace(/'s$/, '').replace(/[^a-z]/g, '')
    return clean.length > 3 ? clean.match(/[aeiouy][a-z]*$/)?.[0] ?? '' : ''
  }).filter(Boolean)
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key).slice(0, 3)
}

function analyzeProsody(lyrics: string): NonNullable<LyricsQualityReport['prosody']> {
  const sections = sungLinesBySection(lyrics)
  const allSyllables: number[] = []
  const outlierLines: string[] = []
  const fourBarWarnings: string[] = []
  const nurseryRhymeWarnings: string[] = []
  const lineStats: NonNullable<LyricsQualityReport['prosody']>['lineStats'] = []
  const endRhymeMap: Record<string, string[]> = {}
  const internalRhymeHints: string[] = []

  for (const [section, lines] of Object.entries(sections)) {
    if (section === 'untagged' || !lines.length) continue
    const syllables = lines.map(estimateSyllables)
    allSyllables.push(...syllables)
    const avg = syllables.reduce((sum, n) => sum + n, 0) / syllables.length
    lines.forEach((line, index) => {
      const count = syllables[index]
      const endRhyme = endRhymeKey(line)
      const echoes = internalEchoes(line)
      lineStats.push({ section, line, syllables: count, endRhyme, internalEchoes: echoes })
      if (endRhyme) (endRhymeMap[endRhyme] ??= []).push(`[${section}] ${line}`)
      if (echoes.length) internalRhymeHints.push(`[${section}] ${echoes.join(', ')} echoes in "${line}"`)
      if (count < 4 || count > 14 || Math.abs(count - avg) > 4) {
        outlierLines.push(`[${section}] ${count} syllables: "${line}"`)
      }
    })
    if (/verse|chorus/.test(section) && lines.length > 2 && ![4, 6, 8].includes(lines.length)) {
      fourBarWarnings.push(`[${section}] has ${lines.length} sung lines; 4, 6, or 8 usually lands cleaner for ACE timing.`)
    }
    const keys = lines.map(endRhymeKey).filter(Boolean)
    if (keys.length >= 4) {
      const perfectPairs = keys.slice(0, -1).filter((key, index) => key && key === keys[index + 1]).length
      const uniqueRatio = new Set(keys).size / keys.length
      if (perfectPairs >= 2 || uniqueRatio < 0.45) {
        nurseryRhymeWarnings.push(`[${section}] leans too hard on obvious end rhymes; use slant/internal rhyme or vary the cadence.`)
      }
    }
  }

  const averageSyllables = allSyllables.length
    ? Math.round((allSyllables.reduce((sum, n) => sum + n, 0) / allSyllables.length) * 10) / 10
    : 0
  return {
    averageSyllables,
    outlierLines: outlierLines.slice(0, 4),
    fourBarWarnings: fourBarWarnings.slice(0, 4),
    nurseryRhymeWarnings: nurseryRhymeWarnings.slice(0, 4),
    lineStats,
    endRhymeMap: Object.fromEntries(Object.entries(endRhymeMap).filter(([, lines]) => lines.length > 1).slice(0, 12)),
    internalRhymeHints: internalRhymeHints.slice(0, 6),
  }
}

function buildLineDecisions(
  lyrics: string,
  intent?: SongIntent | null,
  fallbackIdea?: string,
): NonNullable<LyricsQualityReport['lineDecisions']> {
  const sections = sungLinesBySection(lyrics)
  const topicLock = buildTopicLock(intent, fallbackIdea, lyrics)
  const requiredTerms = topicLock.requiredTerms.map((term) => term.toLowerCase())
  const seen = new Map<string, number>()
  const decisions: NonNullable<LyricsQualityReport['lineDecisions']> = []
  for (const [section, lines] of Object.entries(sections)) {
    if (section === 'untagged') continue
    lines.forEach((line, index) => {
      const normalized = line.toLowerCase().replace(/[^\p{L}' ]/gu, '').replace(/\s+/g, ' ').trim()
      seen.set(normalized, (seen.get(normalized) ?? 0) + 1)
      const syllables = estimateSyllables(line)
      const reasons: string[] = []
      let decision: 'keep' | 'rewrite' | 'cut' | 'expand' = 'keep'
      if (/^\*.*\*$/.test(line) || /\b(?:voice cuts|camera|scene|phone buzz|crowd roars|the track|arrangement|sfx|screenplay)\b/i.test(line)) {
        decision = 'cut'
        reasons.push('not sung lyric text')
      }
      if (syllables < 4 || syllables > 14) {
        decision = decision === 'cut' ? 'cut' : 'rewrite'
        reasons.push(`${syllables} syllables`)
      }
      if (normalized && (seen.get(normalized) ?? 0) > 1 && !/^chorus|final chorus/.test(section)) {
        decision = 'rewrite'
        reasons.push('repeated outside chorus')
      }
      const hasTopic = requiredTerms.length === 0 || requiredTerms.some((term) => normalized.includes(term))
      if (!hasTopic && /verse|chorus|bridge|outro/.test(section)) {
        decision = decision === 'keep' ? 'rewrite' : decision
        reasons.push('weak topic lock')
      }
      if (/^outro/.test(section) && lines.length < 3) {
        decision = decision === 'keep' ? 'expand' : decision
        reasons.push('outro needs closure')
      }
      decisions.push({
        section,
        lineNumber: index + 1,
        text: line,
        decision,
        reasons: reasons.length ? reasons : ['strong enough to preserve'],
        syllables,
        endRhyme: endRhymeKey(line),
      })
    })
  }
  return decisions
}

function buildSectionScores(
  lyrics: string,
  lineDecisions: NonNullable<LyricsQualityReport['lineDecisions']>,
): NonNullable<LyricsQualityReport['sectionScores']> {
  const sections = sungLinesBySection(lyrics)
  return Object.entries(sections)
    .filter(([section]) => section !== 'untagged')
    .map(([section, lines]) => {
      const local = lineDecisions.filter((item) => item.section === section)
      const rewriteCount = local.filter((item) => item.decision === 'rewrite').length
      const cutCount = local.filter((item) => item.decision === 'cut').length
      const expandCount = local.filter((item) => item.decision === 'expand').length
      let score = 100 - rewriteCount * 18 - cutCount * 30 - expandCount * 14
      if (/verse|chorus/.test(section) && ![4, 6, 8].includes(lines.length)) score -= 12
      if (/outro/.test(section) && lines.length < 3) score -= 30
      score = Math.max(0, Math.min(100, score))
      const verdict: 'keep' | 'rewrite' | 'cut' | 'expand' = cutCount ? 'cut' : expandCount ? 'expand' : rewriteCount ? 'rewrite' : 'keep'
      const notes = [
        `${lines.length} lines`,
        rewriteCount ? `${rewriteCount} rewrite` : '',
        cutCount ? `${cutCount} cut` : '',
        expandCount ? `${expandCount} expand` : '',
      ].filter(Boolean)
      return { section, score, verdict, notes }
    })
}

function buildGenerationGate(report: Omit<LyricsQualityReport, 'generationGate'>): NonNullable<LyricsQualityReport['generationGate']> {
  const reasons: string[] = []
  const missing = report.structure.missingSections ?? []
  const metrics = report.metrics
  const sectionScores = report.sectionScores ?? []
  const plan = report.planCompliance
  const semantic = report.semanticAdherence

  if (missing.some((section) => /verse 1|verse 2|chorus|outro/i.test(section))) {
    reasons.push(`Missing required section(s): ${missing.join(', ')}.`)
  }
  if (!report.structure.hasChorus) reasons.push('No chorus/hook section is present.')
  if (report.structure.expectedSections?.includes('outro') && !report.structure.hasOutro) reasons.push('Full vocal songs need an outro before ACE generation.')
  if (report.structure.sungLineCount < 16 && report.structure.expectedSections?.includes('verse 2')) reasons.push('Too few sung lines for a full vocal song.')
  if ((metrics?.promptMatch ?? 100) < 65 || semantic?.verdict === 'fail') reasons.push('Prompt match is too weak; the lyrics drift away from the idea.')
  if ((metrics?.languageMatch ?? 100) < 80) reasons.push('Language match failed.')
  if ((metrics?.engineSafety ?? 100) < 80) reasons.push('Lyrics contain engine-unsafe text such as directions, critique, or screenplay language.')
  if (plan?.syllablePlan === 'fail') reasons.push('Syllable plan failed badly enough that ACE timing may suffer.')
  if (plan?.rhymeScheme === 'fail') reasons.push('Rhyme/flow plan failed across multiple required sections.')
  if (plan && plan.relatabilityScore < 45) reasons.push('Relatability is too low; the lyrics need a clearer human stake.')
  const weakSections = sectionScores.filter((section) => /verse|chorus|outro/i.test(section.section) && section.score < 55)
  if (weakSections.length) reasons.push(`Weak required section(s): ${weakSections.map((section) => `${section.section} ${section.score}/100`).join(', ')}.`)
  if (report.issues.some((issue) => /screenplay|stage direction|critique|planning text|non-sung/i.test(issue))) {
    reasons.push('Non-lyric text appears inside the lyric body.')
  }

  const uniqueReasons = [...new Set(reasons)]
  return {
    status: uniqueReasons.length ? 'needs_repair' : 'ready_for_ace',
    ready: uniqueReasons.length === 0,
    reasons: uniqueReasons,
  }
}

function buildQualityReport(
  lyrics: string,
  modelCritique: string | null = null,
  intent?: SongIntent | null,
  fallbackIdea?: string,
  semanticAdherence?: LyricsQualityReport['semanticAdherence'] | null,
  plan?: LyricPlan | null,
): LyricsQualityReport {
  const clean = sanitizeLyrics(lyrics)
  const sections = sungLinesBySection(clean)
  const sectionNames = Object.keys(sections)
  const allLines = Object.values(sections).flat()
  const issues = validateLyrics(clean, intent, fallbackIdea)
  const prosody = analyzeProsody(clean)
  const lineDecisions = buildLineDecisions(clean, intent, fallbackIdea)
  const sectionScores = buildSectionScores(clean, lineDecisions)
  if (semanticAdherence?.verdict === 'fail') {
    issues.push(`Prompt adherence failed: ${semanticAdherence.notes[0] ?? 'lyrics drift away from the requested idea'}.`)
  } else if (semanticAdherence?.verdict === 'needs_work') {
    issues.push(`Prompt adherence needs work: ${semanticAdherence.notes[0] ?? 'lyrics only partly match the requested idea'}.`)
  }
  const hasVerse1 = sectionNames.some((name) => /^verse\s*1?$/.test(name))
  const hasVerse2 = sectionNames.some((name) => /^verse\s*2$/.test(name))
  const hasChorus = sectionNames.some((name) => /^chorus/.test(name))
  const hasBridge = sectionNames.some((name) => /^bridge/.test(name))
  const hasOutro = sectionNames.some((name) => /^outro/.test(name))
  const expectedSections = expectedSectionsFor(intent)
  const missingSections = [...new Set(expectedSections)].filter((section) => !hasExpectedSection(sectionNames, section))
  const topicLock = buildTopicLock(intent, fallbackIdea, clean)
  const planCompliance = plan ? checkPlanCompliance(clean, plan) : undefined
  if (planCompliance?.issues.length) {
    issues.push(...planCompliance.issues.slice(0, 4))
  }
  const chorusLines = Object.entries(sections)
    .filter(([name]) => /^chorus/.test(name))
    .flatMap(([, lines]) => lines)
  const strengths: string[] = []
  if (hasVerse1 && hasVerse2 && hasChorus) strengths.push('Complete verse/chorus song structure.')
  if (hasBridge) strengths.push('Includes a bridge for contrast.')
  if (hasOutro) strengths.push('Includes an outro that can close the song.')
  if (topicLock.requiredTerms.length && topicLock.matchedTerms.length) strengths.push(`Matches the prompt through: ${topicLock.matchedTerms.slice(0, 5).join(', ')}.`)
  if (allLines.length >= 20) strengths.push('Enough sung lines for a full song.')
  if (chorusLines.length >= 4) strengths.push('Chorus has room for a memorable hook.')
  if (!issues.some((issue) => /stage|screenplay/i.test(issue))) strengths.push('No obvious stage-direction contamination.')

  let score = 100
  score -= issues.length * 16
  if (!hasVerse1 && expectedSections.includes('verse 1')) score -= 12
  if (!hasVerse2 && expectedSections.includes('verse 2')) score -= 12
  if (!hasChorus) score -= 18
  if (missingSections.includes('outro')) score -= 12
  if (allLines.length < (intent?.durationMode === 'sample' ? 2 : intent?.durationMode === 'loop' ? 6 : 16)) score -= 18
  if (chorusLines.length < 4) score -= 10
  if (topicLock.requiredTerms.length && topicLock.matchedTerms.length === 0) score -= 35
  if (topicLock.forbiddenDrift.length) score -= 24
  if (semanticAdherence?.verdict === 'fail') score -= 35
  if (semanticAdherence?.verdict === 'needs_work') score -= 18
  if (planCompliance?.rhymeScheme === 'fail') score -= 12
  if (planCompliance?.syllablePlan === 'fail') score -= 16
  if (planCompliance && planCompliance.relatabilityScore < 45) score -= 12
  score = Math.max(0, Math.min(100, score))
  const verdict: LyricsQualityReport['verdict'] = score >= 82 && issues.length === 0 ? 'pass' : score >= 55 ? 'needs_work' : 'fail'
  const localPromptMatch = topicLock.requiredTerms.length
    ? Math.round((topicLock.matchedTerms.length / Math.max(1, topicLock.requiredTerms.length)) * 100)
    : 100
  const promptMatch = semanticAdherence ? Math.min(localPromptMatch, semanticAdherence.score) : localPromptMatch
  const structureScore = Math.max(0, 100 - missingSections.length * 22)

  const report: Omit<LyricsQualityReport, 'generationGate'> = {
    score,
    verdict,
    summary: verdict === 'pass'
      ? 'These lyrics pass the local structure and singability checks.'
      : verdict === 'needs_work'
        ? 'These lyrics are usable as a draft, but need fixes before generation.'
        : 'These lyrics should not be sent to the music generator yet.',
    issues,
    strengths,
    structure: {
      sections: sectionNames,
      expectedSections,
      missingSections,
      sungLineCount: allLines.length,
      hasVerse1,
      hasVerse2,
      hasChorus,
      hasBridge,
      hasOutro,
    },
    metrics: {
      promptMatch: Math.min(100, promptMatch),
      structure: structureScore,
      singability: issues.some((issue) => /too long|sing/i.test(issue)) ? 55 : 90,
      rhymeFlow: /VERDICT:\s*REJECT/i.test(modelCritique ?? '') ? 55 : 80,
      hookStrength: chorusLines.length >= 4 ? 78 : 45,
      originality: issues.some((issue) => /generic|fallback|repeated/i.test(issue)) ? 45 : 78,
      languageMatch: 100,
      genreFit: 75,
      repetition: issues.some((issue) => /repeated/i.test(issue)) ? 40 : 88,
      engineSafety: issues.some((issue) => /stage|screenplay|Off-topic/i.test(issue)) ? 45 : 92,
    },
    prosody,
    sectionScores,
    lineDecisions,
    semanticAdherence: semanticAdherence ?? undefined,
    planCompliance,
    topicLock,
    modelCritique,
  }
  return { ...report, generationGate: buildGenerationGate(report) }
}

function rhymePassesForGoal(goal: LyricPlanSection, lines: string[]) {
  if (lines.length < 4) return true
  const scheme = goal.rhymeScheme.toLowerCase()
  const rhymes = lines.slice(0, Math.min(8, lines.length)).map((line) => endRhymeKey(line))
  const echoes = lines.flatMap(internalEchoes)
  const repeatedRhymes = rhymes.filter((key, index) => key && rhymes.indexOf(key) !== index)
  const hookWords = normalizeWords(goal.mustDo.join(' ')).filter((word) => word.length > 3)
  const hookCallbacks = hookWords.filter((word) => lines.filter((line) => line.toLowerCase().includes(word)).length >= 2)

  if (/internal|rap|hip-hop|aaba/.test(scheme)) {
    return repeatedRhymes.length >= 1 || echoes.length >= 2 || rhymes[0] === rhymes[1] || rhymes[2] === rhymes[3]
  }
  if (/natural speech|abcb|country|folk/.test(scheme)) {
    return rhymes[1] === rhymes[3] || repeatedRhymes.length >= 1 || hookCallbacks.length >= 1
  }
  if (/repeating hook|dance|fragment/.test(scheme)) {
    return hookCallbacks.length >= 1 || repeatedRhymes.length >= 1
  }
  if (/hook callback/.test(scheme)) {
    return hookCallbacks.length >= 1 || rhymes[0] === rhymes[2] || rhymes[1] === rhymes[3]
  }
  if (/abab/.test(scheme)) {
    return rhymes[0] === rhymes[2] || rhymes[1] === rhymes[3] || repeatedRhymes.length >= 2
  }
  return repeatedRhymes.length >= 1 || echoes.length >= 1
}

function checkPlanCompliance(lyrics: string, plan: LyricPlan): NonNullable<LyricsQualityReport['planCompliance']> {
  const sections = sungLinesBySection(lyrics)
  const issues: string[] = []
  let syllableMisses = 0
  let rhymeMisses = 0
  for (const goal of plan.sectionGoals) {
    const key = Object.keys(sections).find((section) => section.replace(/\s+/g, ' ').trim() === goal.section.toLowerCase() || section.startsWith(goal.section.toLowerCase()))
    const lines = key ? sections[key] ?? [] : []
    if (!lines.length && !/intro|instrumental|pre-chorus/i.test(goal.section)) {
      issues.push(`Plan violation: missing [${goal.section}].`)
      rhymeMisses += 1
      continue
    }
    const sungLines = lines.filter((line) => !LYRIC_SECTION_RE.test(line))
    const outOfRange = sungLines.filter((line) => {
      const count = estimateSyllables(line)
      return count < goal.syllableMin || count > goal.syllableMax
    })
    syllableMisses += outOfRange.length
    if (outOfRange.length) issues.push(`Plan violation: [${goal.section}] has ${outOfRange.length} line(s) outside ${goal.syllableMin}-${goal.syllableMax} syllables.`)
    if (sungLines.length >= 4 && !rhymePassesForGoal(goal, sungLines)) {
      rhymeMisses += 1
      issues.push(`Plan warning: [${goal.section}] does not clearly satisfy ${goal.rhymeScheme}.`)
    }
  }
  const lyricLower = lyrics.toLowerCase()
  const relatableWords = ['i ', 'you ', 'we ', 'home', 'work', 'friend', 'love', 'miss', 'wait', 'try', 'want', 'need', 'feel', 'remember', 'tonight', 'morning', 'hands', 'street', 'car', 'room', 'door', 'call', 'name']
  const humanAnchor = /\b(i|you|we|me|my|your|our)\b/i.test(lyrics) ? 22 : 0
  const changeAnchor = /\b(learn|learned|change|changed|leave|left|come back|try|tried|finally|still|again|better|afraid|free)\b/i.test(lyricLower) ? 18 : 0
  const concreteAnchor = relatableWords.filter((word) => lyricLower.includes(word)).length * 10
  const relatabilityScore = Math.min(100, Math.max(20, humanAnchor + changeAnchor + concreteAnchor))
  const vibeWords = plan.vibe.toLowerCase().split(/\s+/).filter((word) => word.length > 3)
  const vibeMatch = !vibeWords.length || vibeWords.some((word) => lyricLower.includes(word)) || plan.vibe === 'relatable and emotionally direct'
    ? 'pass'
    : 'needs_work'
  return {
    rhymeScheme: rhymeMisses > 2 ? 'fail' : rhymeMisses ? 'needs_work' : 'pass',
    syllablePlan: syllableMisses > 5 ? 'fail' : syllableMisses ? 'needs_work' : 'pass',
    relatabilityScore,
    vibeMatch,
    issues,
  }
}

async function runAdherenceCheck(
  model: string | null,
  lyrics: string,
  intent?: SongIntent | null,
  fallbackIdea?: string,
): Promise<LyricsQualityReport['semanticAdherence'] | null> {
  if (!model || intent?.vocalMode === 'instrumental') return null
  try {
    const result = await chat(model, [
      { role: 'system', content: ADHERENCE_SYSTEM },
      {
        role: 'user',
        content: `${buildIntentBrief(intent, fallbackIdea)}\n\nLyrics to judge:\n${sanitizeLyrics(lyrics)}`,
      },
    ], 0.15, false, 'lyrics-adherence')
    return parseAdherence(result.text)
  } catch {
    return null
  }
}

function buildIntentBrief(intent?: SongIntent | null, fallbackIdea?: string) {
  if (!intent) return fallbackIdea ? `Song idea: ${fallbackIdea}` : ''
  const topicLock = buildTopicLock(intent, fallbackIdea)
  return [
    'SONG INTENT PACKET - obey this over any model drift:',
    intent.songTitle ? `Title: ${intent.songTitle}` : '',
    `User idea / creative anchor: ${intent.rawIdea || intent.idea || fallbackIdea || 'not provided'}`,
    intent.styleCaption ? `Production style only (do not change the subject): ${intent.styleCaption}` : '',
    intent.tags.length ? `Tags: ${intent.tags.join(', ')}` : '',
    `Vocal mode: ${intent.vocalMode}`,
    `Language: ${intent.language || 'en'}`,
    `Duration target: ${intent.durationMode} ${intent.durationMin}-${intent.durationMax}s`,
    intent.structure.length ? `Required structure preference: ${intent.structure.join(' -> ')}` : 'Required structure preference: full song',
    intent.negativePrompt ? `Avoid: ${intent.negativePrompt}` : '',
    topicLock.requiredTerms.length ? `Topic lock words/images to honor: ${topicLock.requiredTerms.slice(0, 12).join(', ')}` : '',
    'The user idea is the creative anchor. Sound/style is production only. Do not drift into unrelated topics.',
  ].filter(Boolean).join('\n')
}

export async function analyzeLyrics(input: { lyrics: string; idea?: string; model?: string; intent?: SongIntent }): Promise<LyricsQualityReport> {
  const clean = sanitizeLyrics(input.lyrics)
  if (!clean) {
    return {
      score: 0,
      verdict: 'fail',
      summary: 'No lyrics were provided.',
      issues: ['No lyrics were provided.'],
      strengths: [],
      structure: { sections: [], sungLineCount: 0, hasVerse1: false, hasVerse2: false, hasChorus: false, hasBridge: false, hasOutro: false },
      modelCritique: null,
    }
  }

  let modelCritique: string | null = null
  const model = await pickWriterModel(input.model)
  if (model) {
    try {
      const critiqueRes = await chat(model, [
        { role: 'system', content: RHYME_FLOW_SYSTEM },
        { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nCheck these lyrics and give the most important fixes:\n${clean}` },
      ], 0.25, false, 'lyrics-analysis')
      modelCritique = critiqueRes.text
    } catch (error) {
      modelCritique = `Model critique unavailable: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const adherence = await runAdherenceCheck(model, clean, input.intent, input.idea)
  const combinedCritique = [
    modelCritique,
    adherence ? `ADHERENCE CHECK:\nSCORE: ${adherence.score}\nVERDICT: ${adherence.verdict}\nNOTES:\n${adherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n') || null
  return buildQualityReport(clean, combinedCritique, input.intent, input.idea, adherence)
}

export async function rewriteLyrics(input: { lyrics: string; idea?: string; instruction: string; model?: string; intent?: SongIntent }): Promise<LyricsCraftResult> {
  const model = await pickWriterModel(input.model)
  if (!model) throw new Error('No writer model available in Ollama')
  const clean = sanitizeLyrics(input.lyrics)
  if (!clean) throw new Error('No lyrics to rewrite')
  const lyricPlan = createFallbackLyricPlan(input.intent, input.idea)
  const startingQuality = buildQualityReport(clean, null, input.intent, input.idea, null, lyricPlan)
  const lockedLines = startingQuality.lineDecisions?.filter((line) => line.decision === 'keep').map((line) => `[${line.section}] ${line.text}`) ?? []
  const repairLines = startingQuality.lineDecisions?.filter((line) => line.decision !== 'keep').map((line) => `[${line.section} line ${line.lineNumber}] ${line.decision.toUpperCase()}: ${line.text} (${line.reasons.join('; ')})`) ?? []
  emitWriterProgress({ stage: 'rewrite', note: 'Rebuilding the lyrics from the current quality issues and the song intent packet.' })
  const rewriteRes = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: [
        buildIntentBrief(input.intent, input.idea),
        lyricPlanBrief(lyricPlan),
        `Rewrite instruction: ${input.instruction}`,
        'Surgical rewrite rule: keep any strong, on-topic, singable bars exactly or nearly intact. Replace only lines named by the quality issues, weak/outlier lines, missing sections, bland filler, and transitions. Preserve the best hook/callback if it works.',
        `Current quality issues:\n${startingQuality.issues.length ? startingQuality.issues.map((issue) => `- ${issue}`).join('\n') : '- none'}`,
        `LOCKED GOOD BARS - preserve these unless grammar forces a tiny edit:\n${lockedLines.length ? lockedLines.slice(0, 24).map((line) => `- ${line}`).join('\n') : '- none identified'}`,
        `LINES TO REPAIR - only these should change unless a section is broken:\n${repairLines.length ? repairLines.slice(0, 24).map((line) => `- ${line}`).join('\n') : '- none identified'}`,
        `Current lyrics:\n${clean}`,
        'Return a JSON object only: {"lyrics":"[Verse 1]\\n...","keptLines":["exact preserved line"],"rewrittenLines":["changed line"]}. The lyrics string must contain the full fixed song with section tags.',
      ].filter(Boolean).join('\n\n'),
    },
  ], 0.75, true, 'lyrics-rewrite')
  let rewritten = extractLyricsOnly(rewriteRes.text)
  if (!rewritten) {
    emitWriterProgress({ stage: 'rewrite', note: 'The rewrite response was malformed, so DoReMii is repairing it into strict tagged lyrics.' })
    rewritten = await repairLyricsEnvelope(model, rewriteRes.text || rewriteRes.thinkBlock || '', buildIntentBrief(input.intent, input.idea), lyricPlan, 'lyrics-rewrite')
  }
  if (!rewritten) {
    throw new Error('The rewrite returned critique notes instead of tagged lyrics. Try again or switch writer models.')
  }
  const draftSnapshot = makeDraftSnapshot('Rewrite draft', rewritten, 'Surgical rewrite from the requested fix.', input.intent, input.idea, clean)
  emitWriterProgress({ stage: 'rewrite', note: 'Rewrite draft is ready for a fresh critique.', draft: draftSnapshot })
  emitWriterProgress({ stage: 'self-critique', note: 'Checking the rewrite for structure, singability, prompt match, and off-topic drift.' })
  const critiqueRes = await chat(model, [
    { role: 'system', content: RHYME_FLOW_SYSTEM },
    { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nCheck these rewritten lyrics:\n${rewritten}` },
  ], 0.25, false, 'lyrics-rewrite-critique')
  const adherence = await runAdherenceCheck(model, rewritten, input.intent, input.idea)
  const critique = [
    critiqueRes.text,
    adherence ? `ADHERENCE CHECK:\nSCORE: ${adherence.score}\nVERDICT: ${adherence.verdict}\nNOTES:\n${adherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n')
  let quality = buildQualityReport(rewritten, critique, input.intent, input.idea, adherence, lyricPlan)
  const rescueBrief = [
    buildIntentBrief(input.intent, input.idea),
    lyricPlanBrief(lyricPlan),
  ].join('\n\n')
  for (let rescueRound = 0; rescueRound < 2 && !quality.generationGate?.ready; rescueRound += 1) {
    const rescued = await repairAgainstGate(model, rewritten, rescueBrief, lyricPlan, quality, `manual-rewrite-${rescueRound + 1}`)
    if (rescued !== rewritten) {
      rewritten = rescued
      const rescueAdherence = await runAdherenceCheck(model, rewritten, input.intent, input.idea)
      const rescueCritique = [
        critique,
        `MANUAL REWRITE RESCUE ROUND ${rescueRound + 1} TARGETS:\n${quality.generationGate?.reasons.map((reason) => `- ${reason}`).join('\n') ?? '- none'}`,
        rescueAdherence ? `RESCUE ADHERENCE CHECK:\nSCORE: ${rescueAdherence.score}\nVERDICT: ${rescueAdherence.verdict}\nNOTES:\n${rescueAdherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
      ].filter(Boolean).join('\n\n')
      quality = buildQualityReport(rewritten, rescueCritique, input.intent, input.idea, rescueAdherence, lyricPlan)
    } else {
      break
    }
  }
  emitWriterProgress({ stage: 'finalizing', note: 'Packaging the clean rewrite with its quality report.' })
  return {
    plan: lyricPlan,
    lyrics: rewritten,
    draft: clean,
    drafts: [draftSnapshot],
    critique,
    quality,
    model,
    createdAt: new Date().toISOString(),
  }
}

export async function listWriterModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!response.ok) return []
    const body = await response.json() as { models?: { name: string }[] }
    return (body.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

function pickFromInstalled(names: string[], preferred: string | undefined, fallbacks: string[]) {
  if (preferred && names.some((n) => n === preferred || n.startsWith(preferred))) return preferred
  return fallbacks.find((wanted) => names.some((n) => n === wanted || n.startsWith(wanted))) ?? names[0] ?? null
}

export async function pickWriterModel(preferred?: string): Promise<string | null> {
  const names = await listWriterModels()
  if (preferred) return pickFromInstalled(names, preferred, WRITER_MODELS)
  const settings = getEngineSettings()
  return pickFromInstalled(names, settings.lyricWriterModel, WRITER_MODELS)
}

export async function pickRoomModel(preferred?: string): Promise<string | null> {
  const names = await listWriterModels()
  if (preferred) return pickFromInstalled(names, preferred, ROOM_MODELS)
  const settings = getEngineSettings()
  return pickFromInstalled(names, settings.writerRoomModel, ROOM_MODELS)
}

export async function isWriterAvailable(): Promise<{ available: boolean; model: string; reason: string | null }> {
  const model = await pickWriterModel()
  if (model) return { available: true, model, reason: null }
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`)
    if (!response.ok) return { available: false, model: WRITER_MODELS[0], reason: 'Ollama is not responding' }
    return { available: false, model: WRITER_MODELS[0], reason: `no writer model pulled (want ${WRITER_MODELS.join(' or ')})` }
  } catch {
    return { available: false, model: WRITER_MODELS[0], reason: 'Ollama is not running' }
  }
}

/** Strip qwen3 reasoning from content. Handles three shapes seen in the wild:
 *  full <think>...</think> blocks, a dangling </think> with NO opening tag
 *  (qwen3 emits this with think=false - the real cause of the leak), and clean
 *  content with neither. Always keep only what follows the LAST </think>. */
function stripReasoning(raw: string): string {
  let text = raw
  const closeIdx = text.lastIndexOf('</think>')
  if (closeIdx !== -1) text = text.slice(closeIdx + '</think>'.length)
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  return text.trim()
}

/** Safety net for when a small model reasons in PLAIN content (no <think> tags)
 *  and trails its final answer after cues like "Final answer:" / "we'll write:".
 *  If we detect a long reasoning monologue, keep only the text after the last
 *  such cue; otherwise return the text unchanged. */
function stripLeakedReasoning(raw: string): string {
  const text = raw.trim()
  const reasoningCues = /\b(we are given|the task is|let me|we must|we need to|option:|i think|let's|we can say|the user (says|wants|specified))\b/i
  if (text.length < 400 || !reasoningCues.test(text)) return text
  const finalCue = /(?:final (?:answer|version|decision)|we'?ll write|so,? final|here'?s the (?:final|rewrite)|revised)[:\s-]*/gi
  let lastIdx = -1
  let m: RegExpExecArray | null
  while ((m = finalCue.exec(text)) !== null) lastIdx = m.index + m[0].length
  if (lastIdx >= 0) {
    const tail = text.slice(lastIdx).trim()
    if (tail.length > 20) return tail
  }
  // No clear marker - take the last non-empty paragraph as the likely answer.
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return paras.length ? paras[paras.length - 1] : text
}

/** Clean single-shot completion that AVOIDS the FINAL_MARKER hack entirely.
 *  The marker hack (used by the lyric pipeline to suppress qwen3 thinking)
 *  confused the model into reasoning ABOUT the marker and leaking that
 *  reasoning as output. Here we either let qwen3 think natively (think=true,
 *  reasoning routed to message.thinking) or suppress thinking cleanly with
 *  /no_think - both give a clean answer in message.content. */
export async function ollamaComplete(
  model: string,
  system: string,
  user: string,
  opts?: { think?: boolean; temperature?: number },
): Promise<string> {
  const think = opts?.think ?? false
  const temperature = opts?.temperature ?? 0.8
  const isQwen = /^qwen3:/i.test(model)
  // Only thinking models accept `think`; qwen2.5/llama run plain (and clean).
  const apiThink = isQwen && think
  const userContent = !apiThink && isQwen ? `${user}\n\n/no_think` : user

  const controller = new AbortController()
  activeWriterAbort = controller
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think: apiThink,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        options: { temperature, num_ctx: contextWindowFor(model, think), num_predict: Math.min(MAX_OUTPUT_TOKENS, tokenBudgetFor('completion', think)) },
      }),
    })
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)
    const body = await response.json() as { message?: { content?: string; thinking?: string }; error?: string }
    if (body.error) throw new Error(body.error)
    let text = stripReasoning(body.message?.content ?? '')
    // If everything ended up in the thinking channel, recover the tail of it.
    if (!text && body.message?.thinking) {
      const lines = body.message.thinking.trim().split(/\n+/).filter(Boolean)
      text = lines.slice(-4).join('\n')
    }
    return text.trim()
  } finally {
    if (activeWriterAbort === controller) activeWriterAbort = null
    writerCancelRequested = false
  }
}

const ENHANCE_PROMPTS: Record<'style' | 'idea' | 'lyrics', string> = {
  style: `You polish sound-and-style descriptions for an AI music generator. Rewrite the user's text into ONE vivid production description: genre, energy, vocal character, key instruments, drum feel, production texture, era. Keep every intention the user expressed. 2-4 sentences, no lyrics, no section tags. Reply with ONLY the rewritten description - no preamble, no quotes, no explanation.`,
  idea: `You are a songwriting development producer. Transform the user's rough idea into a stronger SONG BRIEF, not a movie plot. Preserve the core topic exactly, then add: emotional angle, point of view, hook target, verse-to-chorus arc, and 3-5 lyric-friendly images. Avoid over-plotted action, hidden-map twists, screenplay language, character dumps, and video/image prompt wording. 2-4 compact sentences. Reply with ONLY the improved song idea - no preamble, no quotes, no explanation.`,
  lyrics: `You are a lyric editor. Improve the user's lyrics IN PLACE: keep their structure tags, story, and most of their words. Fix weak lines, rhythm, and rhyme; tighten syllables for singability (6-10 per line). Reply with ONLY the improved lyrics, nothing else.`,
}

function extractJsonAnswer(raw: string) {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return ''
  try {
    const parsed = JSON.parse(match[0]) as { answer?: string }
    return (parsed.answer ?? '').trim()
  } catch {
    return ''
  }
}

function cleanQuotedText(value: string) {
  return value.replace(/^["'\u201c]+|["'\u201d]+$/g, '').trim()
}

function looksLikeExplanation(value: string) {
  return /why this one|first sentence|second sentence|rationale|here'?s why|because:/i.test(value)
}

/** Single-shot text improver for the Studio's Enhance buttons. Ollama-only,
 *  so it works even while ACE is still warming. */
export async function enhanceText(input: { kind: 'style' | 'idea' | 'lyrics'; text: string; tags?: string[]; model?: string; think?: boolean }): Promise<string> {
  const text = input.text.trim()
  if (!text) throw new Error('Write something first, then Enhance can improve it.')
  const model = await pickWriterModel(input.model)
  if (!model) {
    const why = (await isWriterAvailable()).reason
    throw new Error(`Enhance needs the local writer (Ollama): ${why}`)
  }
  const tagLine = input.tags?.length ? `\n\nSelected style tags to respect: ${input.tags.join(', ')}` : ''
  // think:true is REQUIRED for reliability: with thinking suppressed, qwen3
  // small models reason in plain content (no <think> tags) and dump the whole
  // monologue into the box. think:true routes reasoning to its own channel so
  // message.content is just the clean rewrite.
  const improved = await ollamaComplete(model, ENHANCE_PROMPTS[input.kind], `${text}${tagLine}`, {
    think: true,
    temperature: 0.7,
  })
  let cleaned = cleanQuotedText(stripLeakedReasoning(improved))
  if (looksLikeExplanation(cleaned)) {
    const jsonImproved = await ollamaComplete(
      model,
      `${ENHANCE_PROMPTS[input.kind]}\n\nReply as STRICT JSON only: {"answer":"the rewritten text"}. Do not include bullets, markdown, rationale, or commentary.`,
      `${text}${tagLine}`,
      { think: true, temperature: 0.55 },
    )
    cleaned = cleanQuotedText(extractJsonAnswer(jsonImproved) || stripLeakedReasoning(jsonImproved))
  }
  if (!cleaned) throw new Error('The writer returned nothing - try again or raise thinking power.')
  if (looksLikeExplanation(cleaned)) {
    throw new Error('The writer returned analysis instead of a clean rewrite - try again or switch to a stronger writer model.')
  }
  return cleaned
}

/** Deterministic title fallback: strongest hook line from the lyrics. */
export function fallbackTitle(lyrics: string, idea?: string): string {
  const lines = lyrics.split(/\r?\n/).map((l) => l.trim())
  const chorusIndex = lines.findIndex((l) => /^\[.*chorus.*\]$/i.test(l))
  const searchFrom = chorusIndex >= 0 ? chorusIndex + 1 : 0
  const hook = lines.slice(searchFrom).find((l) => l && !l.startsWith('[') && !l.startsWith('('))
    ?? lines.find((l) => l && !l.startsWith('[') && !l.startsWith('('))
  const source = hook || idea || 'Untitled Song'
  const words = source.replace(/[.,!?;:"]+/g, '').split(/\s+/).filter(Boolean).slice(0, 6)
  return words.map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ') || 'Untitled Song'
}

/** Name the song from its final lyrics. Falls back to the hook line when the
 *  writer is unavailable, so a song is never saved as "Pop" again. */
export async function suggestTitle(input: { lyrics: string; idea?: string; model?: string }): Promise<string> {
  const model = await pickWriterModel(input.model)
  if (!model) return fallbackTitle(input.lyrics, input.idea)
  try {
    const text = await ollamaComplete(
      model,
      'You name songs. Read the lyrics and reply with ONE evocative title, 1-5 words, Title Case. No quotes, no punctuation at the end, no explanation - just the title.',
      `${input.idea ? `Song concept: ${input.idea}\n\n` : ''}Lyrics:\n${input.lyrics.slice(0, 2400)}`,
      { think: true, temperature: 0.8 },
    )
    const clean = stripLeakedReasoning(text)
    const lastLine = clean.split(/\r?\n/).filter(Boolean).pop() ?? ''
    const title = lastLine.replace(/^["'“]+|["'”]+$/g, '').replace(/[.!?]+$/, '').trim()
    if (title && title.length <= 60 && !/^(title|song)\b[:\s]/i.test(title)) return title
    return fallbackTitle(input.lyrics, input.idea)
  } catch {
    return fallbackTitle(input.lyrics, input.idea)
  }
}

const RANDOM_GENRES = ['radio pop', 'pop rock', 'trap soul', 'folk pop', 'country pop', 'alt-rock', 'synthwave', 'afrobeats', 'bedroom pop', 'lo-fi hip-hop', 'gospel house', 'jazz pop', 'hyperpop', 'alt-country', 'UK garage', 'bossa nova', 'future funk', 'ambient folk', 'punk rap', 'dance pop', 'indie R&B', 'garage rock']
const RANDOM_HUMAN_STAKES = [
  'trying to apologize before a friendship goes quiet',
  'getting one last night with friends before everything changes',
  'driving home after a breakup and pretending the radio is enough',
  'working a closing shift while dreaming about a different life',
  'falling for someone who keeps sending mixed signals',
  'celebrating a small win after months of feeling stuck',
  'missing home but refusing to turn around',
  'learning to be proud without needing everyone to understand',
  'choosing joy in a week that tried to drain it out',
  'remembering a summer that made ordinary streets feel golden',
  'wanting to be brave enough to say the honest thing',
  'turning a boring weekend into a legendary memory',
  'finding confidence after being underestimated',
  'holding onto hope while money, time, and sleep are all short',
  'letting go of a version of yourself that was only surviving',
  'feeling invincible for three minutes on a crowded dance floor',
]
const RANDOM_SETTINGS = [
  'late-night kitchen',
  'parking lot after work',
  'rainy bus stop',
  'cheap apartment with music leaking through the walls',
  'small-town fair',
  'road trip at sunrise',
  'school gym after the lights go low',
  'corner store in summer heat',
  'campfire with friends',
  'bedroom studio',
  'wedding afterparty',
  'train platform',
  'empty beach morning',
  'crowded house party',
  'open highway',
  'back porch during a storm',
]
const RANDOM_VIBES = [
  'relatable and hooky',
  'funny but secretly sincere',
  'triumphant and clean',
  'bittersweet but warm',
  'romantic and nervous',
  'stern and confident',
  'playful and rhythmic',
  'dark but not hopeless',
  'nostalgic and bright',
  'big chorus, grounded verses',
]
const RANDOM_STRUCTURES = [
  'anthem: verse tension, chorus release, bridge truth, outro resolve',
  'confession: proud verse one, honest verse two, final chorus acceptance',
  'party song: crowded verses, private hook, chantable final chorus',
  'letter song: direct address, remembered detail, chorus as the unsaid truth',
  'comeback song: setback, decision, lift, victory outro',
  'road song: movement, place names, chorus built around one repeated phrase',
  'duet-ready call and response: narrator line, group answer, bigger chorus',
  'comic-to-heartfelt: funny concrete details turning sincere by the bridge',
  'dance-floor release: pressure in verses, simple hook, rhythmic payoff',
  'story ballad: clear scene, emotional turn, closing image without plot twists',
]
const RANDOM_RELATIONSHIPS = [
  'best friends who are almost family',
  'two people avoiding an honest conversation',
  'a person talking to their younger self',
  'coworkers surviving the same long shift',
  'siblings who only show love by joking',
  'someone singing to the version of themself that almost gave up',
  'a couple trying to enjoy one ordinary night',
  'a group chat that became a lifeline',
  'a stranger whose small kindness changes the night',
  'the singer and the city they are outgrowing',
]
const RANDOM_PRESSURES = [
  'the clock is running out',
  'money is tight',
  'everyone expects them to act fine',
  'a goodbye is coming',
  'the party is louder than the feeling underneath it',
  'they have one chance to say the truth',
  'they are trying not to repeat an old mistake',
  'the memory is better than the present',
  'they are tired of being underestimated',
  'they know the moment will not last',
]
const RANDOM_OBJECTS = [
  'a cracked phone screen',
  'a borrowed jacket',
  'gas station coffee',
  'a receipt with a number on it',
  'muddy sneakers',
  'a half-charged speaker',
  'porch lights',
  'a paper crown',
  'a key that no longer fits',
  'a dashboard photo',
  'cold fries in a paper bag',
  'a hoodie that still smells like summer',
  'a voicemail nobody deletes',
  'glow sticks fading on the floor',
]
const RANDOM_HOOK_ANGLES = [
  'the chorus turns one plain sentence into the emotional thesis',
  'the hook is a chant people can sing back after one listen',
  'the title line lands as a confession in the chorus',
  'the chorus flips a sad detail into a reason to keep moving',
  'the hook repeats a concrete image until it becomes symbolic',
  'the chorus answers the question raised by verse one',
  'the final chorus changes one word to show growth',
  'the hook feels simple on purpose, like something said out loud in a car',
]
const RANDOM_DETAILS = [
  'use one funny detail that becomes sincere later',
  'start with a specific everyday object, then widen into the emotion',
  'keep the story in one night rather than a whole life history',
  'make verse two reveal what the singer was afraid to admit',
  'let the bridge say the thing the verses kept dodging',
  'make the chorus emotionally direct instead of abstract',
  'include one sensory detail from the setting, but keep people at the center',
  'make the outro quieter and more honest than the chorus',
]
const BANNED_CONCEPT_PHRASES = [
  'last train',
  'dying town',
  'find the one moment',
  'find the moment',
  'moment it turns',
  'build the whole story toward it',
  'recurring dream',
  'hidden map',
  'collapsed mural',
  'drowned mermaid',
  'street painter',
  'street artist',
  'spray can',
  'marinella',
  'neo-soul production',
  'one final night',
  'filled with laughter but shadowed',
  'tomorrow will bring change',
  'future feels uncertain',
  'secluded beach',
]
let recentConceptSeeds: string[] = []
let recentStyleSeeds: string[] = []

interface ConceptSeed {
  stakes: string
  setting: string
  vibe: string
  shape: string
  relationship: string
  pressure: string
  object: string
  hookAngle: string
  detail: string
}

function buildConceptSeed(pick: <T>(items: T[]) => T, remember: (seed: string) => void): ConceptSeed {
  const availableStakes = RANDOM_HUMAN_STAKES.filter((item) => !recentConceptSeeds.includes(item))
  const stakes = pick(availableStakes.length ? availableStakes : RANDOM_HUMAN_STAKES)
  const seed = {
    stakes,
    setting: pick(RANDOM_SETTINGS),
    vibe: pick(RANDOM_VIBES),
    shape: pick(RANDOM_STRUCTURES),
    relationship: pick(RANDOM_RELATIONSHIPS),
    pressure: pick(RANDOM_PRESSURES),
    object: pick(RANDOM_OBJECTS),
    hookAngle: pick(RANDOM_HOOK_ANGLES),
    detail: pick(RANDOM_DETAILS),
  }
  remember(`${seed.stakes}|${seed.setting}|${seed.vibe}`)
  return seed
}

function titleFromSeed(seed: ConceptSeed) {
  const titlePieces = [
    seed.object.replace(/^(a|an)\s+/i, ''),
    seed.setting.replace(/^(a|an)\s+/i, ''),
    seed.pressure.replace(/^(the|a|an)\s+/i, ''),
  ]
  const source = titlePieces[Math.floor(Math.random() * titlePieces.length)]
  return source
    .replace(/\b(is|are|they|them|their|that|the|and|with|into|from)\b/gi, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ') || 'Almost Honest'
}

function songIdeaFallback(pick: <T>(items: T[]) => T, remember: (seed: string) => void, seed = buildConceptSeed(pick, remember)) {
  const cleanShape = seed.shape.split(':').pop()?.trim() || 'verse tension, chorus release, bridge truth, outro resolve'
  return {
    title: titleFromSeed(seed),
    idea: `A ${seed.vibe} song about ${seed.stakes}, told through ${seed.relationship} in a ${seed.setting} while ${seed.pressure}. Build the verses around ${seed.object} and concrete choices, then make the chorus ${seed.hookAngle}; shape it as ${cleanShape}.`,
  }
}

function normalizeConceptIdea(parsed: Record<string, unknown>) {
  const title = String(parsed.title ?? '').trim()
  const explicitIdea = String(parsed.idea ?? '').trim()
  if (explicitIdea) return { title, idea: explicitIdea }
  const parts = [
    parsed.premise,
    parsed.listenerSituation,
    parsed.verseArc,
    parsed.hookAngle,
  ].map((part) => String(part ?? '').trim()).filter(Boolean)
  return { title, idea: parts.join(' ') }
}

function conceptQualityIssues(title: string, idea: string) {
  const issues: string[] = []
  const text = `${title} ${idea}`.toLowerCase()
  if (idea.length < 80) issues.push('too short to guide lyrics')
  if (idea.length > 460) issues.push('too long; sounds like prose instead of a song brief')
  if (BANNED_CONCEPT_PHRASES.some((phrase) => text.includes(phrase))) issues.push('contains a recently banned or overused concept phrase')
  if (/\b(hidden|revealing|secret)\s+(map|tunnel|portal|prophecy)\b/i.test(idea)) issues.push('movie-plot twist instead of a singable premise')
  if (/\b(camera|shot|frame|visual|image generator|video|scene opens|final image)\b/i.test(idea)) issues.push('sounds like an image/video prompt')
  if ((idea.match(/\b[A-Z][a-z]{3,}\b/g) ?? []).length > 4) issues.push('too many proper-name/lore details')
  if (!/\b(chorus|hook|title line|refrain)\b/i.test(idea)) issues.push('missing hook or chorus target')
  if (!/\b(verse|verses|verse one|verse two|bridge|outro)\b/i.test(idea)) issues.push('missing verse-to-song arc')
  if (!/\b(friend|friends|love|home|work|shift|party|family|younger self|someone|singer|they|we|I|me|you|us|heart|hope|regret|confidence|goodbye|memory|truth)\b/i.test(idea)) issues.push('missing human listener stakes')
  if (/\buncertainty\b/i.test(idea) && !/\bwhy|because|truth|afraid|hope|change|goodbye\b/i.test(idea)) issues.push('uses vague uncertainty without a clear human reason')
  return issues
}

async function repairConceptIdea(model: string, seed: ConceptSeed, badTitle: string, badIdea: string, issues: string[], think?: boolean) {
  const raw = await ollamaComplete(
    model,
    `Repair a weak song concept. Reply as STRICT JSON only: {"title":"2-5 words","idea":"2 sentences max"}.
Rules:
- Make it a song brief, not a film scene or image prompt.
- Keep the human situation relatable and singable.
- Include a clear hook/chorus target and a verse-to-chorus arc.
- Do not add random character lore, hidden maps, murals, or screenplay action.`,
    `Seed to obey:
Human stakes: ${seed.stakes}
Relationship: ${seed.relationship}
Setting: ${seed.setting}
Pressure: ${seed.pressure}
Object detail: ${seed.object}
Vibe: ${seed.vibe}
Song shape: ${seed.shape}
Hook angle: ${seed.hookAngle}
Extra instruction: ${seed.detail}

Rejected title: ${badTitle}
Rejected idea: ${badIdea}
Problems to fix: ${issues.join('; ')}`,
    { think: think ?? true, temperature: 0.7 },
  )
  const match = stripLeakedReasoning(raw).match(/\{[\s\S]*\}/)
  if (!match) return null
  const parsed = normalizeConceptIdea(JSON.parse(match[0]) as Record<string, unknown>)
  const fixedIssues = conceptQualityIssues(parsed.title, parsed.idea)
  return fixedIssues.length ? null : parsed
}

export async function generateConceptIdea(input?: { think?: boolean; model?: string }): Promise<{ title: string; idea: string }> {
  const model = await pickWriterModel(input?.model)
  const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]
  const remember = (seed: string) => {
    recentConceptSeeds = [seed, ...recentConceptSeeds.filter((item) => item !== seed)].slice(0, 6)
  }
  const seed = buildConceptSeed(pick, remember)
  if (!model) return songIdeaFallback(pick, remember, seed)
  try {
    const raw = await ollamaComplete(
      model,
      `You are DoReMii's A&R concept writer. You create SONG CONCEPTS that make lyrics easier, not movie plots.

Reply as STRICT JSON only:
{"title":"2-5 word song title","premise":"one clear sentence","listenerSituation":"one human situation listeners recognize","verseArc":"how verse 1 grows into verse 2/bridge","hookAngle":"what the chorus proves or repeats","idea":"2 sentences max combining the best parts"}
Rules:
- Do not name random characters unless the user asks.
- Do not write action-scene plot twists, hidden maps, collapsed murals, drowned mermaids, screenplay beats, secret tunnels, or image/video prompts.
- Do not default to painters, murals, canvas, rain-erases-art, neo-soul, or over-poetic gallery imagery.
- Make the stakes human and singable: love, friendship, confidence, celebration, grief, work, home, regret, hope, or freedom.
- The idea must be easy to turn into lyrics with verses, chorus, bridge, and outro.
- Mention the hook angle and verse arc; do not summarize a whole short story.
- Weirdness is allowed only as one detail; the emotional premise must stay clear.
- Keep the idea compact and music-native: who sings, why it matters, what the chorus says.`,
      `Human stake: ${seed.stakes}
Relationship lens: ${seed.relationship}
Setting: ${seed.setting}
Pressure: ${seed.pressure}
Concrete object: ${seed.object}
Vibe: ${seed.vibe}
Song shape: ${seed.shape}
Hook angle: ${seed.hookAngle}
Detail instruction: ${seed.detail}
Recent seeds to avoid: ${recentConceptSeeds.join('; ') || 'none'}
Write one compact song idea now.`,
      { think: input?.think ?? true, temperature: 0.95 },
    )
    const match = stripLeakedReasoning(raw).match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = normalizeConceptIdea(JSON.parse(match[0]) as Record<string, unknown>)
      const issues = conceptQualityIssues(parsed.title, parsed.idea)
      if (!issues.length) return parsed
      const fixed = await repairConceptIdea(model, seed, parsed.title, parsed.idea, issues, input?.think)
      if (fixed) return fixed
    }
    return songIdeaFallback(pick, remember, seed)
  } catch {
    return songIdeaFallback(pick, remember, seed)
  }
}

const STYLE_SIGNATURES = [
  'rubbery bass line',
  'bright acoustic strums',
  'glassy synth hook',
  'live-room drum groove',
  'muted piano pulse',
  'call-and-response backing vocals',
  'picked electric guitar motif',
  '808 kick pattern',
  'warm organ pad',
  'handclap/snare pocket',
  'dry funk guitar chops',
  'subby UK garage bass',
  'brass stabs',
  'stomp-clap percussion',
  'dusty breakbeat',
  'pulsing arpeggiator',
]
const STYLE_MOVEMENTS = [
  'drops to a stripped verse before a wide final chorus',
  'starts intimate and adds layers every eight bars',
  'uses a half-time bridge before snapping back into the hook',
  'keeps the verses dry and close, then opens the chorus with harmony',
  'adds one surprise texture in the bridge without changing the song topic',
  'begins with a hooky motif, pulls back for verse one, then stacks gang vocals in the final chorus',
  'moves from conversational verses into a chantable, crowd-ready hook',
  'lets the drums vanish for the bridge so the final chorus lands bigger',
]

function cleanStyleCaption(value: string) {
  return cleanQuotedText(value)
    .replace(/^here'?s\s+(a\s+)?(sound\s*&\s*style|style|caption)[^:]*:\s*/i, '')
    .replace(/^sound\s*&\s*style\s*caption\s*:\s*/i, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function styleQualityIssues(style: string, idea: string, genre: string) {
  const issues: string[] = []
  const text = style.toLowerCase()
  if (style.length < 140) issues.push('too short to guide production')
  if (style.length > 620) issues.push('too long for a clean ACE caption')
  if (/^here'?s|caption for|sound\s*&\s*style caption/i.test(style)) issues.push('contains UI/preamble text')
  if (!text.includes(genre.split(/\s+/)[0].toLowerCase()) && !/\b(pop|rock|rap|hip-hop|country|folk|metal|edm|dance|garage|jazz|r&b|synth|punk|afro|bossa|funk)\b/i.test(style)) issues.push('missing clear genre/subgenre')
  if (!/\b(bpm|tempo|slow|midtempo|fast|brisk|laid-back|driving|half-time|uptempo)\b/i.test(style)) issues.push('missing tempo feel')
  if (!/\b(vocal|singer|rap|chant|harmony|lead)\b/i.test(style)) issues.push('missing vocal character')
  if (!/\b(drum|kick|snare|beat|percussion|breakbeat|groove)\b/i.test(style)) issues.push('missing drum feel')
  if (!/\b(bass|guitar|piano|synth|organ|brass|strings|pad|keys|arpeggio)\b/i.test(style)) issues.push('missing key instruments')
  if (!/\b(mix|texture|polished|gritty|warm|dry|wide|lo-fi|glossy|raw|intimate)\b/i.test(style)) issues.push('missing mix texture')
  if (/\bneo-soul\b/i.test(style) && !/\bneo-soul\b/i.test(idea)) issues.push('unrequested neo-soul drift')
  if (/\bpaint|canvas|mural|rain washes\b/i.test(style) && !/\bpaint|canvas|mural|rain\b/i.test(idea)) issues.push('unrequested painting/rain imagery')
  return issues
}

function styleFallback(genre: string, signature: string, movement: string) {
  return `${genre} production built directly around the song idea, with a clear lead vocal, ${signature}, and a drum pocket that supports the emotional turn instead of overpowering it. The mix should feel specific and dimensional, with one memorable instrumental motif, and the arrangement ${movement}.`
}

async function repairStyleCaption(model: string, input: { title?: string; idea: string; tags?: string[]; think?: boolean }, genre: string, badStyle: string, issues: string[]) {
  const raw = await ollamaComplete(
    model,
    `Repair a weak SOUND & STYLE caption. Reply with ONLY 2-3 sentences, no preamble, no quotes, no markdown.
Include genre/subgenre, tempo feel, vocal character, key instruments, drum feel, mix texture, and arrangement movement.
Keep the song topic unchanged.`,
    `Title: ${input.title || 'untitled'}
Song idea: ${input.idea}
Genre seed: ${genre}
Tags: ${input.tags?.join(', ') || 'none'}
Rejected caption: ${badStyle}
Problems to fix: ${issues.join('; ')}`,
    { think: input.think ?? true, temperature: 0.65 },
  )
  const fixed = cleanStyleCaption(stripLeakedReasoning(raw))
  return styleQualityIssues(fixed, input.idea, genre).length ? '' : fixed
}

export async function generateStyleForIdea(input: { title?: string; idea: string; tags?: string[]; model?: string; think?: boolean }): Promise<string> {
  const model = await pickWriterModel(input.model)
  const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]
  const availableGenres = RANDOM_GENRES.filter((item) => !recentStyleSeeds.includes(item))
  const genre = pick(availableGenres.length ? availableGenres : RANDOM_GENRES)
  recentStyleSeeds = [genre, ...recentStyleSeeds.filter((item) => item !== genre)].slice(0, 8)
  const tagLine = input.tags?.length ? `User tags to respect: ${input.tags.join(', ')}` : `Suggested genre flavor: ${genre}`
  const signature = pick(STYLE_SIGNATURES)
  const movement = pick(STYLE_MOVEMENTS)
  const fallback = styleFallback(genre, signature, movement)
  if (!model) return fallback
  try {
    const text = await ollamaComplete(
      model,
      `You write SOUND & STYLE captions for an AI music generator. Base the production on the song idea, but do not rewrite the premise.

Reply with ONLY 2-3 vivid sentences.
Must include: genre/subgenre, tempo feel, vocal character, key instruments, drum feel, mix texture, and arrangement movement.
Rules:
- Do not add lyrics.
- Do not change the song topic.
- Do not default to neo-soul, painting imagery, rain, canvas, or generic "clear lead vocal, hook-forward chorus" phrasing unless the idea/tags ask for it.
- Make this style distinct from common playlist-card defaults.`,
      `Title: ${input.title || 'untitled'}
Song idea: ${input.idea}
${tagLine}
Recently used style seeds to avoid: ${recentStyleSeeds.join(', ')}`,
      { think: input.think ?? true, temperature: 0.85 },
    )
    const cleaned = cleanStyleCaption(stripLeakedReasoning(text))
    const issues = styleQualityIssues(cleaned, input.idea, genre)
    if (cleaned && !looksLikeExplanation(cleaned) && !issues.length) return cleaned
    const repaired = await repairStyleCaption(model, input, genre, cleaned, issues)
    return repaired || fallback
  } catch {
    return fallback
  }
}

/** AI-backed Random Idea: returns a DISTINCT concept and production style
 *  (one is about meaning, the other about sound) instead of two near-identical
 *  one-liners. Falls back to seeded randoms if the writer is unavailable. */
export async function generateConcept(input?: { think?: boolean; model?: string }): Promise<{ title: string; idea: string; style: string }> {
  const concept = await generateConceptIdea(input)
  const style = await generateStyleForIdea({ ...input, title: concept.title, idea: concept.idea })
  return { ...concept, style }
}

export function pullOllamaModel(model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ollama', ['pull', model], {
      windowsHide: true,
      env: process.env,
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(output.trim() || `${model} pulled successfully.`)
      else reject(new Error(output.trim() || `ollama pull ${model} failed with code ${code}`))
    })
  })
}

/** Duration-aware structure plan, per ACE's own duration math: a structure
 *  that doesn't fit the runtime makes the engine cram lyrics into nonsense. */
export function structurePlanFor(intent?: SongIntent): { sections: { tag: string; lines: string }[]; minDuration: number; text: string } {
  const target = intent?.durationMode === 'auto'
    ? 210
    : Math.max(intent?.durationMin ?? 180, 10)
  const mode = intent?.durationMode ?? 'song'
  let sections: { tag: string; lines: string }[]
  let minDuration: number
  if (mode === 'sample' || target < 45) {
    sections = [{ tag: '[Hook]', lines: '1-2 lines' }]
    minDuration = 10
  } else if (mode === 'loop' || target < 90) {
    sections = [
      { tag: '[Verse 1]', lines: '4 lines' },
      { tag: '[Chorus]', lines: '4 lines' },
    ]
    minDuration = 45
  } else if (target < 170) {
    sections = [
      { tag: '[Verse 1]', lines: '4-6 lines' },
      { tag: '[Chorus]', lines: '4 lines' },
      { tag: '[Verse 2]', lines: '4-6 lines' },
      { tag: '[Chorus]', lines: '4 lines' },
      { tag: '[Outro]', lines: '3 lines' },
    ]
    minDuration = 120
  } else if (target < 220) {
    sections = [
      { tag: '[Verse 1]', lines: '4-6 lines' },
      { tag: '[Chorus]', lines: '4 lines' },
      { tag: '[Verse 2]', lines: '4-6 lines' },
      { tag: '[Chorus]', lines: '4 lines' },
      { tag: '[Bridge]', lines: '2-4 lines' },
      { tag: '[Final Chorus]', lines: '4 lines' },
      { tag: '[Outro]', lines: '3-4 lines' },
    ]
    minDuration = 180
  } else {
    sections = [
      { tag: '[Intro]', lines: 'instrumental or 1 line' },
      { tag: '[Verse 1]', lines: '6 lines' },
      { tag: '[Pre-Chorus]', lines: '2 lines' },
      { tag: '[Chorus]', lines: '4-6 lines' },
      { tag: '[Verse 2]', lines: '6 lines' },
      { tag: '[Pre-Chorus]', lines: '2 lines' },
      { tag: '[Chorus]', lines: '4-6 lines' },
      { tag: '[Bridge]', lines: '4 lines' },
      { tag: '[Final Chorus]', lines: '4-6 lines' },
      { tag: '[Outro]', lines: '3-4 lines' },
    ]
    minDuration = 210
  }
  const text = `STRUCTURE PLAN (target ~${Math.round(target)}s - follow exactly):\n${sections.map((s) => `${s.tag}  (${s.lines})`).join('\n')}`
  return { sections, minDuration, text }
}

function isLyricPlan(value: unknown): value is LyricPlan {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as LyricPlan).sectionGoals))
}

function inferVibe(intent?: SongIntent | null, idea?: string) {
  const hay = `${intent?.tags.join(' ') ?? ''} ${intent?.styleCaption ?? ''} ${intent?.rawIdea ?? idea ?? ''}`.toLowerCase()
  if (/funny|goofy|silly|comedy/.test(hay)) return 'playful'
  if (/dark|angry|stern|hard|aggressive/.test(hay)) return 'stern'
  if (/romantic|love|tender/.test(hay)) return 'romantic'
  if (/victory|triumph|anthem|epic/.test(hay)) return 'triumphant'
  if (/sad|lonely|melancholy/.test(hay)) return 'bittersweet'
  return 'relatable and emotionally direct'
}

function inferGenre(intent?: SongIntent | null) {
  const tags = intent?.tags ?? []
  return tags.find((tag) => /pop|rock|rap|hip-hop|country|folk|metal|edm|synthwave|ambient|jazz|r&b/i.test(tag)) || 'modern pop'
}

function createFallbackLyricPlan(intent?: SongIntent | null, idea?: string): LyricPlan {
  const topic = getIntentIdea(intent, idea) || 'the user song idea'
  const topicLock = buildTopicLock(intent, idea)
  const structure = structurePlanFor(intent ?? undefined)
  const vibe = inferVibe(intent, idea)
  const genre = inferGenre(intent)
  const sectionGoals = structure.sections.map((section, index) => {
    const sectionName = section.tag.replace(/[[\]]/g, '')
    const isChorus = /chorus|hook/i.test(sectionName)
    const isOutro = /outro/i.test(sectionName)
    const isRap = /rap|hip-hop|drill|trap/i.test(genre)
    const isCountry = /country|folk|bluegrass/i.test(genre)
    const isDance = /edm|house|garage|dance|techno|synthwave/i.test(genre)
    const lineCount = Number(section.lines.match(/\d+/)?.[0] ?? (isChorus ? 4 : isOutro ? 3 : 6))
    const rhymeScheme = isRap
      ? (isChorus ? 'hook callback + internal rhyme' : 'AABA with internal rhyme')
      : isCountry
        ? (isChorus ? 'ABAB title payoff' : 'ABCB natural speech rhyme')
        : isDance
          ? (isChorus ? 'repeating hook fragments' : 'ABAB short rhythmic phrases')
          : isChorus ? 'ABAB with hook callback' : lineCount <= 4 ? 'ABAB' : 'ABABCC'
    return {
      section: sectionName,
      purpose: isChorus
        ? `state the hook in a memorable, singable way tied to ${topic}`
        : isOutro
          ? 'close the emotional loop with a final image, not a throwaway label'
          : index === 0
            ? `open the listener-facing situation around ${topic}`
            : `develop the premise and raise or resolve the stakes around ${topic}`,
      lineCount,
      rhymeScheme,
      syllableMin: isRap ? 7 : isDance ? 4 : isChorus ? 6 : 7,
      syllableMax: isRap ? 13 : isDance ? 9 : isChorus ? 10 : 11,
      mustDo: topicLock.requiredTerms.slice(0, 6),
      avoid: [...topicLock.forbiddenDrift, 'screenplay narration', 'generic greeting-card phrases'],
    }
  })
  return {
    songPremise: topic.slice(0, 220),
    emotionalAngle: vibe,
    relatableListenerSituation: `A listener should recognize a human stake in this: wanting, losing, proving, missing, celebrating, or changing through ${topic}.`,
    pointOfView: 'first person unless the user clearly requests another narrator',
    vibe,
    genre,
    genreFusion: null,
    hookPhraseTarget: topicLock.requiredTerms.slice(0, 3).join(' ') || 'a clear repeated hook from the title',
    forbiddenDriftWords: [...new Set([...DRIFT_TERMS, ...topicLock.forbiddenDrift])].slice(0, 18),
    sectionGoals,
    createdAt: new Date().toISOString(),
  }
}

function lyricPlanBrief(plan: LyricPlan) {
  return [
    'LYRIC PLAN - this is the source of truth before drafting:',
    MUSIC_THEORY_SANDWICH,
    `Premise: ${plan.songPremise}`,
    `Relatable situation: ${plan.relatableListenerSituation}`,
    `POV: ${plan.pointOfView}`,
    `Vibe: ${plan.vibe}`,
    `Genre: ${plan.genre}${plan.genreFusion ? ` fused with ${plan.genreFusion}` : ''}`,
    `Hook target: ${plan.hookPhraseTarget}`,
    `Forbidden drift: ${plan.forbiddenDriftWords.join(', ')}`,
    'Section goals:',
    ...plan.sectionGoals.map((section) => `- [${section.section}] ${section.lineCount} lines, ${section.rhymeScheme}, ${section.syllableMin}-${section.syllableMax} syllables: ${section.purpose}`),
  ].join('\n')
}

async function repairAgainstGate(
  model: string,
  lyrics: string,
  brief: string,
  lyricPlan: LyricPlan,
  quality: LyricsQualityReport,
  label: string,
) {
  const blockers = quality.generationGate?.reasons ?? []
  if (!blockers.length) return lyrics
  const weakSections = quality.sectionScores
    ?.filter((section) => section.verdict !== 'keep' || section.score < 70)
    .map((section) => `[${section.section}] ${section.score}/100 ${section.verdict}: ${section.notes.join(', ')}`)
    .slice(0, 10) ?? []
  const repairLines = quality.lineDecisions
    ?.filter((line) => line.decision !== 'keep')
    .map((line) => `[${line.section} line ${line.lineNumber}] ${line.decision.toUpperCase()}: ${line.text} (${line.reasons.join('; ')})`)
    .slice(0, 32) ?? []
  const lockedLines = quality.lineDecisions
    ?.filter((line) => line.decision === 'keep')
    .map((line) => `[${line.section}] ${line.text}`)
    .slice(0, 32) ?? []

  emitWriterProgress({ stage: 'rewrite', note: `Quality rescue: ${blockers.slice(0, 2).join(' ')}` })
  const rescue = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: `${brief}

${lyricPlanBrief(lyricPlan)}

The draft below is BLOCKED from ACE generation. You must fix the blocker causes, not merely polish.

BLOCKERS:
${blockers.map((reason) => `- ${reason}`).join('\n')}

WEAK SECTIONS:
${weakSections.length ? weakSections.map((item) => `- ${item}`).join('\n') : '- none'}

LINES TO REPAIR:
${repairLines.length ? repairLines.map((item) => `- ${item}`).join('\n') : '- none'}

LOCKED GOOD BARS TO KEEP:
${lockedLines.length ? lockedLines.map((item) => `- ${item}`).join('\n') : '- none'}

Current lyrics:
${lyrics}

Repair requirements:
- Return ONLY strict JSON with a "lyrics" string.
- Keep locked good bars where possible.
- Fix every blocker directly.
- If a required section is weak, rewrite that whole section.
- If the chorus is weak, create a clearer repeated hook tied to the title/idea.
- If relatability is low, add first-person or direct-address human stakes.
- If rhyme/syllables fail, make lines singable for the genre rather than forcing childish rhymes.
- No critique, no planning notes, no rhyme labels, no screenplay text.

Return:
{"plan":${JSON.stringify(lyricPlan)},"lyrics":"[Verse 1]\\n...","keptLines":[],"rewrittenLines":[],"notes":["fixed blocker: ..."]}`,
    },
  ], 0.72, true, `${label}-quality-rescue`)
  return extractLyricsOnly(rescue.text) || await repairLyricsEnvelope(model, rescue.text || rescue.thinkBlock || '', brief, lyricPlan, `${label}-quality-rescue`) || lyrics
}

function fallbackLyricsFromPlan(plan: LyricPlan) {
  const terms = plan.hookPhraseTarget || plan.songPremise.split(/\s+/).slice(0, 4).join(' ')
  const cleanHook = terms.replace(/[^\p{L}\p{N}' -]/gu, ' ').replace(/\s+/g, ' ').trim() || 'this feeling'
  const images = plan.sectionGoals.flatMap((section) => section.mustDo).filter(Boolean)
  const imageA = images[0] || 'morning'
  const imageB = images[1] || 'doorway'
  const imageC = images[2] || 'road'
  const linesFor = (section: LyricPlan['sectionGoals'][number]) => {
    const name = section.section.toLowerCase()
    if (/chorus/.test(name)) {
      return [
        `I keep ${cleanHook} close tonight`,
        `Turn it up till it feels right`,
        `If the world starts pulling away`,
        `I sing ${cleanHook} anyway`,
      ].slice(0, Math.max(3, Math.min(section.lineCount, 6)))
    }
    if (/bridge/.test(name)) {
      return [
        `Maybe I was scared to change`,
        `Maybe hope can rearrange`,
        `Everything I thought I knew`,
        `Into something I can use`,
      ].slice(0, Math.max(2, Math.min(section.lineCount, 4)))
    }
    if (/outro/.test(name)) {
      return [
        `${cleanHook} in the quiet air`,
        `One last line and I leave it there`,
        `If tomorrow calls my name`,
        `I will answer less afraid`,
      ].slice(0, Math.max(3, Math.min(section.lineCount, 4)))
    }
    if (/verse 2/.test(name)) {
      return [
        `By the ${imageC}, I learned to breathe`,
        `Let the old weight fall from me`,
        `What I lost became a spark`,
        `Leading somewhere through the dark`,
      ].slice(0, Math.max(4, Math.min(section.lineCount, 6)))
    }
    return [
      `I found ${imageA} in my hands`,
      `Tried to make the moment stand`,
      `By the ${imageB}, I said your name`,
      `Nothing small would feel the same`,
    ].slice(0, Math.max(4, Math.min(section.lineCount, 6)))
  }
  return sanitizeLyrics(plan.sectionGoals.map((section) => `[${section.section}]\n${linesFor(section).join('\n')}`).join('\n\n'))
}

/** Grab one of ACE's curated example lyric sheets as a FORM reference for the
 *  writer (never content). Engine-off is fine - we just skip it. */
async function fetchEngineExample(): Promise<string | null> {
  try {
    const response = await fetch('http://127.0.0.1:8001/create_random_sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sample_type: 'custom_mode' }),
    })
    if (!response.ok) return null
    const body = await response.json() as { data?: { lyrics?: string } }
    const lyrics = (body.data?.lyrics || '').trim()
    if (!lyrics || lyrics.length < 40) return null
    return lyrics.split('\n').slice(0, 24).join('\n')
  } catch {
    return null
  }
}

/** Quick speed probe: can this model produce tokens right now? When ACE holds
 *  most of the VRAM, big models page to RAM and crawl at ~1 tok/s - better to
 *  demote to a smaller model than hang the pipeline. */
async function modelIsResponsive(model: string, budgetMs = 60_000): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budgetMs)
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, prompt: 'ok', stream: false, think: false, keep_alive: '15m', options: { num_predict: 4 } }),
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Pick the strongest model that is actually responsive right now,
 *  walking down the chain when VRAM starvation makes big models crawl. */
async function pickResponsiveWriter(preferred?: string): Promise<{ model: string; demotedFrom: string | null }> {
  const first = await pickWriterModel(preferred)
  if (!first) throw new Error('No writer model available in Ollama')
  const installed = await listWriterModels()
  const chain = [first, ...['qwen3:14b', 'qwen3:8b', 'qwen3:4b', 'qwen2.5:1.5b', 'llama3.2:3b'].filter((m) => m !== first && installed.some((n) => n === m || n.startsWith(m)))]
  for (const candidate of chain) {
    if (await modelIsResponsive(candidate)) {
      return { model: candidate, demotedFrom: candidate === first ? null : first }
    }
  }
  // Nothing answered the probe - return the preferred model and let the
  // per-call watchdog surface a clear error.
  return { model: first, demotedFrom: null }
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
}

function scoreSongBrief(brief: SongBrief, intent?: SongIntent | null, idea?: string): SongBrief['quality'] {
  const topicLock = buildTopicLock(intent, idea)
  const hay = [
    brief.premise,
    brief.listenerSituation,
    brief.emotionalConflict,
    brief.hookPromise,
    brief.verse1Purpose,
    brief.verse2Escalation,
    brief.bridgeReveal,
    brief.outroResolution,
    brief.concreteImages.join(' '),
  ].join(' ').toLowerCase()
  const matchedTerms = topicLock.requiredTerms.filter((term) => hay.includes(term.toLowerCase()))
  const humanWords = ['i ', 'you ', 'we ', 'friend', 'love', 'miss', 'want', 'need', 'afraid', 'hope', 'home', 'night', 'memory', 'tomorrow']
  const concrete = brief.concreteImages.filter((image) => image.split(/\s+/).length <= 5).length
  const issues: string[] = []
  if (matchedTerms.length < Math.min(2, topicLock.requiredTerms.length)) issues.push('Brief does not anchor enough core topic words.')
  if (!brief.hookPromise || brief.hookPromise.length < 18) issues.push('Hook promise is too vague.')
  if (concrete < 3) issues.push('Brief needs 3-5 concrete song images.')
  if (!humanWords.some((word) => hay.includes(word))) issues.push('Brief needs a clearer human listener situation.')
  return {
    relatability: clampScore(45 + humanWords.filter((word) => hay.includes(word)).length * 9 + (brief.listenerSituation.length > 45 ? 16 : 0)),
    hookPotential: clampScore(brief.hookPromise.length > 35 ? 82 : brief.hookPromise.length > 18 ? 65 : 35),
    genreFit: clampScore(brief.premise && brief.verse1Purpose && brief.verse2Escalation ? 78 : 45),
    specificity: clampScore(40 + concrete * 12 + matchedTerms.length * 8),
    groundedness: clampScore(50 + concrete * 10 - Math.max(0, brief.forbiddenDrift.length - 8) * 2),
    songShapeReadiness: clampScore([brief.verse1Purpose, brief.verse2Escalation, brief.bridgeReveal, brief.outroResolution].filter((x) => x.length > 20).length * 22),
    issues,
  }
}

function makeSongBriefFallback(intent?: SongIntent | null, idea?: string, plan?: LyricPlan): SongBrief {
  const topic = getIntentIdea(intent, idea) || 'a personal moment worth turning into a song'
  const topicLock = buildTopicLock(intent, idea)
  const images = topicLock.requiredTerms.slice(0, 5)
  while (images.length < 3) images.push(['front door', 'late night street', 'half-lit room', 'old photograph'][images.length])
  const title = intent?.songTitle?.trim() || plan?.hookPhraseTarget || 'the title'
  const brief: SongBrief = {
    premise: topic.slice(0, 260),
    narrator: plan?.pointOfView || 'first-person singer with a direct, human voice',
    listenerSituation: plan?.relatableListenerSituation || `Someone is trying to say the thing they usually hide, using ${images[0]} as the first concrete image.`,
    emotionalConflict: plan?.emotionalAngle || 'wanting to move forward while still feeling the pull of the moment',
    hookPromise: `The chorus pays off "${title}" as a line the listener can sing back.`,
    verse1Purpose: plan?.sectionGoals.find((s) => /verse 1/i.test(s.section))?.purpose || 'show the first recognizable moment and the emotional problem',
    verse2Escalation: plan?.sectionGoals.find((s) => /verse 2/i.test(s.section))?.purpose || 'raise the stakes with a new detail instead of repeating verse one',
    bridgeReveal: plan?.sectionGoals.find((s) => /bridge/i.test(s.section))?.purpose || 'turn the meaning inward and reveal what the singer finally understands',
    outroResolution: plan?.sectionGoals.find((s) => /outro/i.test(s.section))?.purpose || 'close with one final concrete image and emotional release',
    forbiddenDrift: [...new Set([...(plan?.forbiddenDriftWords ?? []), ...topicLock.forbiddenDrift])].slice(0, 12),
    concreteImages: images.slice(0, 5),
    quality: { relatability: 0, hookPotential: 0, genreFit: 0, specificity: 0, groundedness: 0, songShapeReadiness: 0, issues: [] },
    createdAt: new Date().toISOString(),
  }
  return { ...brief, quality: scoreSongBrief(brief, intent, idea) }
}

function parseSongBrief(raw: string, fallback: SongBrief, intent?: SongIntent | null, idea?: string): SongBrief {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate) as Partial<Record<keyof SongBrief, unknown>>
      const brief: SongBrief = {
        premise: typeof parsed.premise === 'string' ? parsed.premise.trim() : fallback.premise,
        narrator: typeof parsed.narrator === 'string' ? parsed.narrator.trim() : fallback.narrator,
        listenerSituation: typeof parsed.listenerSituation === 'string' ? parsed.listenerSituation.trim() : fallback.listenerSituation,
        emotionalConflict: typeof parsed.emotionalConflict === 'string' ? parsed.emotionalConflict.trim() : fallback.emotionalConflict,
        hookPromise: typeof parsed.hookPromise === 'string' ? parsed.hookPromise.trim() : fallback.hookPromise,
        verse1Purpose: typeof parsed.verse1Purpose === 'string' ? parsed.verse1Purpose.trim() : fallback.verse1Purpose,
        verse2Escalation: typeof parsed.verse2Escalation === 'string' ? parsed.verse2Escalation.trim() : fallback.verse2Escalation,
        bridgeReveal: typeof parsed.bridgeReveal === 'string' ? parsed.bridgeReveal.trim() : fallback.bridgeReveal,
        outroResolution: typeof parsed.outroResolution === 'string' ? parsed.outroResolution.trim() : fallback.outroResolution,
        forbiddenDrift: parseStringArray(parsed.forbiddenDrift).length ? parseStringArray(parsed.forbiddenDrift) : fallback.forbiddenDrift,
        concreteImages: parseStringArray(parsed.concreteImages).length ? parseStringArray(parsed.concreteImages).slice(0, 5) : fallback.concreteImages,
        quality: fallback.quality,
        createdAt: new Date().toISOString(),
      }
      return { ...brief, quality: scoreSongBrief(brief, intent, idea) }
    } catch {
      // Fall through to deterministic brief.
    }
  }
  return fallback
}

function songBriefPrompt(baseBrief: string, lyricPlan: LyricPlan) {
  return `${baseBrief}

Create a SONG BRIEF before lyrics. This is not a video prompt and not a plot synopsis.
It must be song-shaped, relatable, and useful for writing sections.

Return STRICT JSON only:
{
  "premise":"one sentence song premise",
  "narrator":"who is singing and POV",
  "listenerSituation":"everyday human situation the listener recognizes",
  "emotionalConflict":"what feeling is unresolved",
  "hookPromise":"what the chorus will prove or repeat",
  "verse1Purpose":"what Verse 1 reveals",
  "verse2Escalation":"how Verse 2 moves forward",
  "bridgeReveal":"what the bridge turns or admits",
  "outroResolution":"how the song closes",
  "forbiddenDrift":["things not to write about"],
  "concreteImages":["3-5 grounded images"]
}

Planning constraints:
${lyricPlanBrief(lyricPlan)}

No screenplay, no film scene, no long plot. Make this a music brief.`
}

function scoreHookCandidate(lines: string[], label: string, brief: SongBrief, intent?: SongIntent | null, idea?: string): HookCandidate {
  const cleanLines = lines.map((line) => line.trim()).filter((line) => isSingableLyricLine(line)).slice(0, 4)
  const text = cleanLines.join(' ').toLowerCase()
  const topicLock = buildTopicLock(intent, idea)
  const titleTerms = (intent?.songTitle || '').toLowerCase().split(/\W+/).filter((term) => term.length > 2)
  const topicHits = topicLock.requiredTerms.filter((term) => text.includes(term.toLowerCase())).length
  const titleHits = titleTerms.filter((term) => text.includes(term)).length
  const avgSyllables = cleanLines.length ? cleanLines.reduce((sum, line) => sum + estimateSyllables(line), 0) / cleanLines.length : 99
  const repeated = cleanLines.some((line, index) => cleanLines.findIndex((other) => other.toLowerCase() === line.toLowerCase()) !== index)
  const scores = {
    titlePayoff: clampScore(45 + titleHits * 18 + (text.includes(brief.hookPromise.toLowerCase().split(/\W+/)[0] ?? '') ? 8 : 0)),
    singability: clampScore(100 - Math.abs(avgSyllables - 8) * 7),
    memorability: clampScore(50 + (repeated ? 18 : 0) + (cleanLines.length <= 4 ? 12 : 0) + (/[?!]/.test(cleanLines.join('')) ? 4 : 0)),
    emotionalClarity: clampScore(brief.emotionalConflict.split(/\W+/).filter((term) => term.length > 3 && text.includes(term.toLowerCase())).length * 12 + 55),
    topicMatch: clampScore(40 + topicHits * 18),
    rhymePotential: clampScore(cleanLines.length >= 2 ? 68 + Math.min(20, cleanLines.filter((line) => endRhymeKey(line)).length * 4) : 35),
  }
  const score = clampScore(Object.values(scores).reduce((sum, value) => sum + value, 0) / 6)
  return {
    id: crypto.randomUUID(),
    label,
    lines: cleanLines.length ? cleanLines : fallbackHookLines(brief, intent, idea),
    score,
    scores,
    notes: [
      scores.topicMatch < 65 ? 'Needs stronger topic lock.' : 'Topic is present.',
      scores.singability < 65 ? 'Line lengths may be hard to sing.' : 'Singable line lengths.',
      scores.titlePayoff < 65 ? 'Could pay off the title more clearly.' : 'Title payoff is clear.',
    ],
  }
}

function fallbackHookLines(brief: SongBrief, intent?: SongIntent | null, idea?: string) {
  const title = (intent?.songTitle || '').trim()
  const topic = buildTopicLock(intent, idea).requiredTerms.find(Boolean) || brief.concreteImages[0] || 'this moment'
  if (title && title.length <= 34) {
    return [
      `${title}, I keep holding on`,
      `When the whole night tries to let me go`,
      `${title}, I can still sing along`,
      `Till the last little light comes home`,
    ]
  }
  return [
    `I keep holding on to ${topic}`,
    `When the whole night tries to let me go`,
    `I keep singing through ${topic}`,
    `Till the last little light comes home`,
  ]
}

function parseHookCandidates(raw: string, brief: SongBrief, intent?: SongIntent | null, idea?: string): HookCandidate[] {
  for (const candidate of extractJsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate) as { hooks?: unknown; bestHook?: unknown }
      if (Array.isArray(parsed.hooks)) {
        const hooks = parsed.hooks.flatMap((item, index) => {
          if (!item || typeof item !== 'object') return []
          const object = item as { name?: unknown; label?: unknown; lines?: unknown }
          const lines = parseStringArray(object.lines)
          return [scoreHookCandidate(lines, String(object.name || object.label || `Hook ${index + 1}`), brief, intent, idea)]
        }).filter((hook) => hook.lines.length)
        const best = String(parsed.bestHook || '').toLowerCase()
        const selected = hooks.find((hook) => hook.label.toLowerCase() === best) ?? [...hooks].sort((a, b) => b.score - a.score)[0]
        return hooks.map((hook) => ({ ...hook, selected: hook.id === selected?.id })).slice(0, 8)
      }
    } catch {
      // Plain parsing below.
    }
  }
  const buckets: { label: string; lines: string[] }[] = []
  let current: { label: string; lines: string[] } | null = null
  for (const line of stripLeakedReasoning(raw).split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^[-*]\s*/, '')
    if (!trimmed) continue
    const hookLabel = trimmed.match(/^(?:hook|candidate|best hook)\s*([a-z0-9]*)[:.-]\s*(.*)$/i)
    if (hookLabel) {
      if (current) buckets.push(current)
      current = { label: `Hook ${hookLabel[1] || buckets.length + 1}`, lines: hookLabel[2] ? [hookLabel[2].trim()] : [] }
    } else if (current && !NON_LYRIC_LINE_RE.test(trimmed)) {
      current.lines.push(trimmed)
    }
  }
  if (current) buckets.push(current)
  const hooks = buckets.length
    ? buckets.map((bucket) => scoreHookCandidate(bucket.lines, bucket.label, brief, intent, idea))
    : [
        scoreHookCandidate(fallbackHookLines(brief, intent, idea), 'Fallback Hook', brief, intent, idea),
        scoreHookCandidate([`I keep the promise in my hands`, 'Even when the room goes blue', `I turn the hurt into a chance`, 'And bring it back to you'], 'Fallback Hook 2', brief, intent, idea),
      ]
  const best = [...hooks].sort((a, b) => b.score - a.score)[0]
  return hooks.map((hook) => ({ ...hook, selected: hook.id === best.id })).slice(0, 8)
}

function sectionTag(section: string) {
  return `[${section}]`
}

function sectionPurposeFromBrief(section: LyricPlanSection, brief: SongBrief) {
  if (/verse 1/i.test(section.section)) return brief.verse1Purpose
  if (/verse 2/i.test(section.section)) return brief.verse2Escalation
  if (/bridge/i.test(section.section)) return brief.bridgeReveal
  if (/outro/i.test(section.section)) return brief.outroResolution
  if (/chorus|hook/i.test(section.section)) return brief.hookPromise
  return section.purpose
}

function scoreSectionDraft(section: LyricPlanSection, lyrics: string, purpose: string): SectionDraft {
  const body = normalizeSectionLyrics(section.section, extractLyricsOnly(lyrics) || lyrics)
  const lines = sungLinesBySection(body)[section.section.toLowerCase()] ?? body.split(/\r?\n/).filter((line) => line.trim() && !LYRIC_SECTION_RE.test(line))
  const syllables = lines.map(estimateSyllables)
  const avg = syllables.length ? syllables.reduce((sum, value) => sum + value, 0) / syllables.length : 99
  const lineScore = clampScore(100 - Math.abs(lines.length - section.lineCount) * 12)
  const syllableScore = clampScore(100 - Math.max(0, section.syllableMin - avg, avg - section.syllableMax) * 10)
  const purposeWords = purpose.toLowerCase().split(/\W+/).filter((term) => term.length > 4).slice(0, 8)
  const purposeScore = clampScore(45 + purposeWords.filter((term) => body.toLowerCase().includes(term)).length * 10)
  const score = clampScore((lineScore + syllableScore + purposeScore) / 3)
  return {
    section: section.section,
    lyrics: body,
    score,
    verdict: score >= 78 ? 'keep' : score >= 55 ? 'rewrite' : lines.length < Math.max(2, section.lineCount - 2) ? 'expand' : 'rewrite',
    purpose,
    repairReason: score >= 78 ? undefined : `Needs ${section.lineCount} lines, ${section.syllableMin}-${section.syllableMax} syllables, and clearer purpose: ${purpose}`,
    lockedLines: score >= 78 ? lines : lines.filter((line) => estimateSyllables(line) >= section.syllableMin && estimateSyllables(line) <= section.syllableMax).slice(0, 2),
  }
}

async function writeSectionDraft(
  model: string,
  plainLyricsMode: boolean,
  baseBrief: string,
  songBrief: SongBrief,
  lyricPlan: LyricPlan,
  section: LyricPlanSection,
  selectedHook: HookCandidate,
  previousSections: SectionDraft[],
) {
  const purpose = sectionPurposeFromBrief(section, songBrief)
  const hookText = selectedHook.lines.join('\n')
  if (/chorus/i.test(section.section) && !/final/i.test(section.section)) {
    return scoreSectionDraft(section, hookText, purpose)
  }
  const response = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: `${baseBrief}

SONG BRIEF:
${JSON.stringify(songBrief, null, 2)}

APPROVED HOOK:
${hookText}

Already written sections:
${previousSections.map((draft) => normalizeSectionLyrics(draft.section, draft.lyrics)).join('\n\n') || 'none'}

Write ONLY this section now: ${sectionTag(section.section)}
Purpose: ${purpose}
Line count target: ${section.lineCount}
Rhyme/meter target: ${section.rhymeScheme}, ${section.syllableMin}-${section.syllableMax} syllables per line
Must include or imply: ${section.mustDo.join(', ') || songBrief.concreteImages.join(', ')}
Avoid: ${section.avoid.join(', ')}

Rules:
- Output only the section tag and sung lyric lines for this section.
- No critique, no notes, no rhyme labels, no screenplay, no markdown.
- Use the approved hook if this is Final Chorus, with small emotional lift.
- Make this section support the hook promise.

${plainLyricsMode ? 'Return plain tagged lyrics only.' : `Return STRICT JSON only: {"lyrics":"${sectionTag(section.section)}\\nline\\nline"}`}`,
    },
  ], /chorus/i.test(section.section) ? 0.72 : 0.82, true, `section-${section.section}`)
  const clean = extractLyricsOnly(response.text) || await repairLyricsEnvelope(model, response.text || response.thinkBlock || '', baseBrief, lyricPlan, `section-${section.section}`)
  return scoreSectionDraft(section, clean || fallbackLyricsFromPlan({ ...lyricPlan, sectionGoals: [section] }), purpose)
}

function compileSections(sections: SectionDraft[]) {
  return sanitizeLyrics(sections.map((section) => normalizeSectionLyrics(section.section, section.lyrics)).join('\n\n'))
}

/** Scene -> draft -> critique -> rewrite, looping while the critic rejects
 *  (max 2 rewrites). Thinking mode on for the creative passes. */
/** Fast mode: write the whole song in one focused pass, then score-and-advise
 *  (never block). ~1-2 Ollama calls instead of 20-40, so a blueprint lands in
 *  a couple minutes instead of 30+. Deeper critique is the opt-in 'deep' cook. */
async function craftLyricsFast(input: {
  idea: string
  tags: string[]
  language: string
  structure: string[]
  existingLyrics?: string
  intent?: SongIntent
}, model: string): Promise<LyricsCraftResult> {
  const lyricPlan = createFallbackLyricPlan(input.intent, input.idea)
  const structurePlan = structurePlanFor(input.intent)
  const wantsThink = /^qwen3:/i.test(model)
  emitWriterProgress({ stage: 'planning', note: `Fast draft with ${model}: planning ${lyricPlan.vibe} ${lyricPlan.genre}, hook "${lyricPlan.hookPhraseTarget}".` })

  const brief = [
    buildIntentBrief(input.intent, input.idea),
    input.tags.length ? `Musical style: ${input.tags.join(', ')}` : '',
    MUSIC_THEORY_SANDWICH,
    structurePlan.text,
    lyricPlanBrief(lyricPlan),
    input.language && input.language !== 'en' ? `Write the lyrics in language code: ${input.language}` : 'Write the lyrics in English.',
    input.existingLyrics?.trim() ? `The user has a draft - mine it for anything good, then surpass it:\n${input.existingLyrics.trim()}` : '',
    'Every lyric line must clearly belong to the user idea. Write the COMPLETE song now: every planned section, in order, with [Section] tags, singable lines, and the planned rhyme scheme. Return ONLY the lyrics with section tags - no commentary, no critique, no JSON.',
  ].filter(Boolean).join('\n\n')

  emitWriterProgress({ stage: 'drafting', note: 'Writing the full song in one pass.' })
  let lyrics = ''
  try {
    const res = await chat(model, [
      { role: 'system', content: SONGWRITER_SYSTEM },
      { role: 'user', content: brief },
    ], 0.85, wantsThink, 'fast-draft')
    lyrics = extractLyricsOnly(res.text) || ''
    if (!lyrics) lyrics = await repairLyricsEnvelope(model, res.text || res.thinkBlock || '', brief, lyricPlan, 'fast-draft') || ''
  } catch (error) {
    emitWriterProgress({ stage: 'drafting', note: `Fast draft hit an error (${error instanceof Error ? error.message : 'unknown'}); using a safe starter lyric from the plan.` })
  }
  if (!lyrics || !sanitizeLyrics(lyrics).trim()) lyrics = fallbackLyricsFromPlan(lyricPlan)
  lyrics = sanitizeLyrics(lyrics)

  const quality = buildQualityReport(lyrics, null, input.intent, input.idea, undefined, lyricPlan)
  const draftSnapshot = makeDraftSnapshot('Draft 1', lyrics, 'Fast one-pass draft. Use Deep Cook for a multi-round critic polish.', input.intent, input.idea)
  emitWriterProgress({ stage: 'finalizing', note: `Fast draft ready (quality ${quality.score}/100). Edit it directly or run Deep Cook to refine.`, draft: draftSnapshot })
  return {
    plan: lyricPlan,
    repairs: [],
    lyrics,
    draft: lyrics,
    drafts: [draftSnapshot],
    critique: '',
    quality,
    model,
    createdAt: new Date().toISOString(),
  }
}

export async function craftLyrics(input: {
  idea: string
  tags: string[]
  language: string
  structure: string[]
  existingLyrics?: string
  model?: string
  intent?: SongIntent
}): Promise<LyricsCraftResult> {
  const settings = getEngineSettings()
  const picked = await pickResponsiveWriter(input.model || settings.sectionWriterModel || settings.lyricWriterModel)
  const model = picked.model
  // Fast mode: one focused pass. Skips the multi-role probes, section loop, and
  // critic/rescue loops entirely - the source of the 30-minute blueprints.
  if ((settings.lyricCookMode ?? 'fast') === 'fast') {
    return craftLyricsFast(input, model)
  }
  const pickRoleModel = async (preferred?: string) => {
    if (input.model) return model
    return (await pickResponsiveWriter(preferred || model)).model
  }
  const briefModel = await pickRoleModel(settings.ideaWriterModel)
  const hookModel = await pickRoleModel(settings.hookWriterModel)
  const sectionModel = await pickRoleModel(settings.sectionWriterModel)
  const criticModel = await pickRoleModel(settings.criticModel)
  const prosodyModel = await pickRoleModel(settings.prosodyModel)
  const finalModel = await pickRoleModel(settings.finalCompilerModel)
  if (picked.demotedFrom) {
    emitWriterProgress({ stage: 'planning', note: `${picked.demotedFrom} is starved for VRAM, so the writer is using ${model} instead.` })
  }

  const structurePlan = structurePlanFor(input.intent)
  const lyricPlan = createFallbackLyricPlan(input.intent, input.idea)
  const plainLyricsMode = modelPrefersPlainLyrics(sectionModel)
  const engineExample = await fetchEngineExample()
  const brief = [
    buildIntentBrief(input.intent, input.idea),
    input.tags.length ? `Musical style: ${input.tags.join(', ')}` : '',
    MUSIC_THEORY_SANDWICH,
    BLUEPRINT_PROMPT_SANDWICH,
    structurePlan.text,
    lyricPlanBrief(lyricPlan),
    input.language && input.language !== 'en' ? `Write the lyrics in language code: ${input.language}` : 'Write the lyrics in English.',
    input.existingLyrics?.trim()
      ? `The user has a draft - mine it for anything good, then surpass it:\n${input.existingLyrics.trim()}`
      : '',
    'Every lyric line must clearly belong to the user idea. If the idea is camping, sing camping/outdoor images, not candy, ads, phones, or unrelated scenes.',
    engineExample
      ? `FORMAT REFERENCE - an example of well-formatted ACE lyrics (copy the FORM: tags, line lengths, spacing - NEVER the content or topic):\n${engineExample}`
      : '',
  ].filter(Boolean).join('\n\n')

  // Pass 0 - create a song-shaped brief so the draft can't become a generic
  // plot synopsis or unrelated poem.
  const drafts: LyricsDraftSnapshot[] = []
  const repairs: string[] = []
  emitWriterProgress({ stage: 'planning', note: `Planning: ${lyricPlan.vibe} ${lyricPlan.genre}; hook target "${lyricPlan.hookPhraseTarget}"; ${lyricPlan.sectionGoals.length} sections with rhyme and syllable targets.` })
  const fallbackBrief = makeSongBriefFallback(input.intent, input.idea, lyricPlan)
  const briefRes = await chat(briefModel, [
    { role: 'system', content: SCENE_SYSTEM },
    { role: 'user', content: songBriefPrompt(brief, lyricPlan) },
  ], 0.7, true, 'song-brief')
  let songBrief = parseSongBrief(briefRes.text || briefRes.thinkBlock || '', fallbackBrief, input.intent, input.idea)
  if (songBrief.quality.issues.length) {
    repairs.push(`Brief repaired before drafting: ${songBrief.quality.issues.join(' ')}`)
    songBrief = { ...fallbackBrief, quality: scoreSongBrief(fallbackBrief, input.intent, input.idea) }
  }
  emitWriterProgress({ stage: 'planning', note: `Song brief: ${songBrief.premise} Hook promise: ${songBrief.hookPromise}`, brief: songBrief })

  emitWriterProgress({ stage: 'planning', note: 'Writing hook candidates first so the song has a center before verses are drafted.' })
  const hookRes = await chat(hookModel, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: `${brief}

${lyricPlanBrief(lyricPlan)}

Story worksheet:
${JSON.stringify(songBrief, null, 2)}

Hook-first task:
- Write 6 chorus hook candidates.
- Each candidate must be 2-4 sung lines.
- Tie directly to the title/idea/topic lock.
- Make it repeatable, emotionally clear, and singable.
- No verses yet, no critique, no explanation.

${plainLyricsMode
  ? 'Return plain text only: Hook A, Hook B, Hook C, Hook D, Hook E, Hook F, and Best Hook. No analysis paragraph.'
  : 'Return STRICT JSON only:\n{"hooks":[{"name":"Hook A","lines":["line","line"]},{"name":"Hook B","lines":["line","line"]},{"name":"Hook C","lines":["line","line"]},{"name":"Hook D","lines":["line","line"]},{"name":"Hook E","lines":["line","line"]},{"name":"Hook F","lines":["line","line"]}],"bestHook":"Hook A","reason":"short reason"}'}`,
    },
  ], 0.82, true, 'hook-draft')
  const hookBrief = stripLeakedReasoning(hookRes.text).slice(0, 2200)
  const hooks = parseHookCandidates(hookBrief, songBrief, input.intent, input.idea)
  const selectedHook = hooks.find((hook) => hook.selected) ?? [...hooks].sort((a, b) => b.score - a.score)[0]
  emitWriterProgress({ stage: 'planning', note: `Selected hook (${selectedHook.score}/100): ${selectedHook.lines.join(' / ')}`, hooks })

  // Pass 1 - section assembly. Each section is written with its own purpose,
  // meter target, and relation to the approved hook.
  emitWriterProgress({ stage: 'drafting', note: 'Writing Draft 1 section by section so weak parts can be repaired without destroying good bars.' })
  const sectionDrafts: SectionDraft[] = []
  for (const section of lyricPlan.sectionGoals) {
    const sectionDraft = await writeSectionDraft(sectionModel, plainLyricsMode, brief, songBrief, lyricPlan, section, selectedHook, sectionDrafts)
    sectionDrafts.push(sectionDraft)
    emitWriterProgress({ stage: 'drafting', note: `${section.section}: ${sectionDraft.score}/100 ${sectionDraft.verdict}`, section: sectionDraft })
  }
  let draft = compileSections(sectionDrafts)
  if (!draft) {
    emitWriterProgress({ stage: 'drafting', note: 'The section compiler found no clean lyrics, so DoReMii is creating a safe starter lyric from the plan.' })
    draft = fallbackLyricsFromPlan(lyricPlan)
  }
  const draftOne = makeDraftSnapshot('Draft 1', draft, 'First complete lyric draft from the song worksheet.', input.intent, input.idea)
  drafts.push(draftOne)
  emitWriterProgress({ stage: 'drafting', note: 'Draft 1 is ready. The critic is checking topic match, rhyme, structure, and singability next.', draft: draftOne })

  // Passes 2..n - critic loop: critique, rewrite, re-critique. Keep this tight
  // for Blueprint UX; deeper "let it cook" passes belong behind a Pro control.
  let current = draft
  let critique: string
  let validationIssues = validateLyrics(current, input.intent, input.idea)
  const maxRewriteRounds = settings.lyricCookMode === 'unbounded'
    ? Number.POSITIVE_INFINITY
    : settings.lyricCookMode === 'deep'
      ? (/qwen3:14b/i.test(model) ? 8 : /qwen3:8b/i.test(model) ? 6 : 3)
      : (/qwen3:14b/i.test(model) ? 4 : /qwen3:8b/i.test(model) ? 3 : /qwen3:4b/i.test(model) ? 1 : 2)
  let bestQualityScore = buildQualityReport(current, null, input.intent, input.idea, undefined, lyricPlan).score
  let stalledRepairRounds = 0
  for (let round = 0; round < maxRewriteRounds; round += 1) {
    emitWriterProgress({ stage: 'self-critique', note: `Critiquing ${drafts[drafts.length - 1]?.label ?? 'the current draft'} against the prompt, structure, and flow rules.` })
    const critiqueRes = await chat(criticModel, [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: `The song brief was:\n${brief}\n\nLocal validator issues that are automatic rejects:\n${validationIssues.length ? validationIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nThe lyrics to critique:\n${current}` },
    ], 0.4, false, `critique-${round + 1}`)
    critique = critiqueRes.text

    const flowRes = await chat(prosodyModel, [
      { role: 'system', content: RHYME_FLOW_SYSTEM },
      { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nCheck these lyrics for rhyme, flow, structure, and singability:\n${current}` },
    ], 0.25, false, `flow-${round + 1}`)
    const adherence = await runAdherenceCheck(criticModel, current, input.intent, input.idea)
    critique = [
      critique,
      `RHYME/FLOW CHECK:\n${flowRes.text}`,
      adherence ? `ADHERENCE CHECK:\nSCORE: ${adherence.score}\nVERDICT: ${adherence.verdict}\nNOTES:\n${adherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
    ].filter(Boolean).join('\n\n')

    const passed = /VERDICT:\s*PASS/i.test(critique)
      && adherence?.verdict !== 'fail'
      && validateLyrics(current, input.intent, input.idea).length === 0
    if (passed) break

    emitWriterProgress({ stage: 'rewrite', note: 'The draft did not clear every gate, so the writer is rebuilding weak sections instead of appending notes.' })
    validationIssues = validateLyrics(current, input.intent, input.idea)
    const repairReport = buildQualityReport(current, critique, input.intent, input.idea, adherence, lyricPlan)
    const lockedLines = repairReport.lineDecisions?.filter((line) => line.decision === 'keep').map((line) => `[${line.section}] ${line.text}`) ?? []
    const repairLines = repairReport.lineDecisions?.filter((line) => line.decision !== 'keep').map((line) => `[${line.section} line ${line.lineNumber}] ${line.decision.toUpperCase()}: ${line.text} (${line.reasons.join('; ')})`) ?? []
    const rewriteRes = await chat(finalModel, [
      { role: 'system', content: SONGWRITER_SYSTEM },
      { role: 'user', content: `${brief}\n\nSong brief:\n${JSON.stringify(songBrief, null, 2)}\n\nApproved hook:\n${selectedHook.lines.join('\n')}` },
      { role: 'assistant', content: current },
        { role: 'user', content: `A professional critic and local validator reviewed your lyrics.\n\nCritic review:\n${critique}\n\nLocal validator rejects:\n${validationIssues.length ? validationIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nRewrite from scratch only if the section is structurally broken. Otherwise perform a surgical rewrite. Requirements:\n- Output ONLY sung lyrics with section tags.\n- ${structurePlan.text.replace(/\n/g, '\n- ')}\n- ${lyricPlanBrief(lyricPlan).replace(/\n/g, '\n- ')}\n- Keep every verse and hook anchored to the topic lock in the song intent packet.\n- Preserve the strongest on-topic bars, hooks, and callbacks from the previous draft.\n- Replace weak, off-topic, unsingable, filler, or validator-rejected lines.\n- One core metaphor for the whole song; no adjective-stacking.\n- Follow the planned syllable ranges and rhyme schemes section by section.\n- Verse 2 must progress from Verse 1; Bridge must turn the song; Outro must close with 3-4 sung lines.\n- No screenplay, no phone/camera/crowd descriptions - every non-tag line is sung.\n- Strong hook in the chorus; do not repeat verses verbatim.\n- Do not paste critic notes, rhyme labels, or planning text into the lyrics.\n\nLOCKED GOOD BARS - preserve these unless grammar forces a tiny edit:\n${lockedLines.length ? lockedLines.slice(0, 24).map((line) => `- ${line}`).join('\n') : '- none identified'}\n\nLINES TO REPAIR - only these should change unless a section is broken:\n${repairLines.length ? repairLines.slice(0, 24).map((line) => `- ${line}`).join('\n') : '- none identified'}\n\n${plainLyricsMode ? 'Return ONLY the full revised song lyrics with section tags.' : `Return a JSON object only: {"plan":${JSON.stringify(lyricPlan)},"lyrics":"[Verse 1]\\n...","keptLines":["exact preserved line"],"rewrittenLines":["changed line"],"sectionScores":[],"notes":[]}. The lyrics string must contain the full revised song with section tags.`}` },
    ], 0.85, true, `rewrite-${round + 1}`)
    let rewritten = extractLyricsOnly(rewriteRes.text)
    if (!rewritten) {
      emitWriterProgress({ stage: 'rewrite', note: 'The rewrite returned notes instead of tagged lyrics, so DoReMii is repairing that draft before continuing.' })
      rewritten = await repairLyricsEnvelope(finalModel, rewriteRes.text || rewriteRes.thinkBlock || '', brief, lyricPlan, `rewrite-${round + 1}`)
    }
    if (!rewritten) {
      emitWriterProgress({ stage: 'rewrite', note: 'The repair still failed, so DoReMii kept the previous clean draft and will not treat notes as lyrics.' })
      break
    }
    current = rewritten
    repairs.push(`Rewrite round ${round + 1}: ${validationIssues.slice(0, 3).join(' ') || 'critic requested stronger section repair.'}`)
    validationIssues = validateLyrics(current, input.intent, input.idea)
    const snapshot = makeDraftSnapshot(`Draft ${drafts.length + 1}`, current, `Surgical rewrite round ${round + 1} after critic and flow checks.`, input.intent, input.idea, drafts[drafts.length - 1]?.lyrics ?? null)
    drafts.push(snapshot)
    const latestScore = snapshot.quality?.score ?? 0
    if (latestScore > bestQualityScore + 4) {
      bestQualityScore = latestScore
      stalledRepairRounds = 0
    } else {
      stalledRepairRounds += 1
      if (settings.lyricCookMode === 'unbounded' && stalledRepairRounds >= 3) {
        emitWriterProgress({ stage: 'rewrite', note: 'The last repair passes stopped improving, so DoReMii is ending the cook instead of looping forever on the same weak pattern.' })
        break
      }
    }
    emitWriterProgress({ stage: 'rewrite', note: `${snapshot.label} is ready. Comparing it against the previous draft and running a fresh quality gate.`, draft: snapshot })
  }

  emitWriterProgress({ stage: 'finalizing', note: 'Running the final critic, rhyme/flow check, prompt-adherence check, and quality score.' })
  const finalIssues = validateLyrics(current, input.intent, input.idea)
  const finalCritiqueRes = await chat(criticModel, [
    { role: 'system', content: CRITIC_SYSTEM },
    { role: 'user', content: `Final quality gate. The song brief was:\n${brief}\n\nLocal validator issues:\n${finalIssues.length ? finalIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nFinal candidate lyrics:\n${current}` },
  ], 0.25, false, 'final-critique')
  const finalFlowRes = await chat(prosodyModel, [
    { role: 'system', content: RHYME_FLOW_SYSTEM },
    { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nFinal rhyme/flow check:\n${current}` },
  ], 0.2, false, 'final-flow')
  const finalAdherence = await runAdherenceCheck(criticModel, current, input.intent, input.idea)
  critique = [
    finalCritiqueRes.text,
    `RHYME/FLOW CHECK:\n${finalFlowRes.text}`,
    finalAdherence ? `ADHERENCE CHECK:\nSCORE: ${finalAdherence.score}\nVERDICT: ${finalAdherence.verdict}\nNOTES:\n${finalAdherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n')
  let quality = buildQualityReport(current, critique, input.intent, input.idea, finalAdherence, lyricPlan)
  const rescuePasses = settings.lyricCookMode === 'unbounded'
    ? Number.POSITIVE_INFINITY
    : settings.lyricCookMode === 'deep'
      ? (/qwen3:14b/i.test(model) ? 8 : /qwen3:8b/i.test(model) ? 6 : 3)
      : (/qwen3:14b/i.test(model) ? 4 : /qwen3:8b/i.test(model) ? 3 : /qwen3:4b/i.test(model) ? 2 : 2)
  for (let rescueRound = 0; rescueRound < rescuePasses && !quality.generationGate?.ready; rescueRound += 1) {
    const repaired = await repairAgainstGate(finalModel, current, brief, lyricPlan, quality, `final-${rescueRound + 1}`)
    if (repaired !== current) {
      current = repaired
      const rescueAdherence = await runAdherenceCheck(criticModel, current, input.intent, input.idea)
      const rescueCritique = [
        critique,
        `QUALITY RESCUE ROUND ${rescueRound + 1} TARGETS:\n${quality.generationGate?.reasons.map((reason) => `- ${reason}`).join('\n') ?? '- none'}`,
        rescueAdherence ? `RESCUE ADHERENCE CHECK:\nSCORE: ${rescueAdherence.score}\nVERDICT: ${rescueAdherence.verdict}\nNOTES:\n${rescueAdherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
      ].filter(Boolean).join('\n\n')
      quality = buildQualityReport(current, rescueCritique, input.intent, input.idea, rescueAdherence, lyricPlan)
      repairs.push(`Quality rescue ${rescueRound + 1}: targeted ${quality.generationGate?.reasons.slice(0, 2).join(' ') || 'final gate blockers.'}`)
      const rescueDraft = makeDraftSnapshot(`Draft ${drafts.length + 1}`, current, `Quality rescue pass ${rescueRound + 1} targeted the Ready for ACE blockers.`, input.intent, input.idea, drafts[drafts.length - 1]?.lyrics ?? null)
      drafts.push(rescueDraft)
      emitWriterProgress({ stage: 'finalizing', note: `Quality rescue completed. Ready for ACE: ${quality.generationGate?.ready ? 'yes' : 'not yet'}.`, draft: rescueDraft })
      if (settings.lyricCookMode === 'unbounded') {
        const newScore = quality.score
        if (newScore > bestQualityScore + 4) {
          bestQualityScore = newScore
          stalledRepairRounds = 0
        } else {
          stalledRepairRounds += 1
          if (stalledRepairRounds >= 3) {
            emitWriterProgress({ stage: 'finalizing', note: 'Quality rescue stopped improving, so DoReMii is preserving the best clean draft and asking for manual help instead of wasting more time.' })
            break
          }
        }
      }
    } else {
      break
    }
  }
  if (!sanitizeLyrics(current).trim()) {
    throw new Error('The writer returned no usable lyrics. Try Reroll or a different writer model.')
  }
  return {
    brief: songBrief,
    plan: lyricPlan,
    hooks,
    sections: sectionDrafts,
    repairs,
    lyrics: sanitizeLyrics(current),
    draft: sanitizeLyrics(draft),
    drafts,
    critique,
    quality,
    model,
    createdAt: new Date().toISOString(),
  }
}
