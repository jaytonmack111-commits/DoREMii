import { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import type { LyricsCraftResult, LyricsDraftSnapshot, LyricsQualityReport, SongIntent, WriterProgressEvent } from '../shared/types.js'
import { getEngineSettings } from './modelSettings.js'

const OLLAMA_URL = 'http://127.0.0.1:11434'
/** Default writer follows the user's observed best local lyric behavior; 14B stays available for deep rewrite/critique. */
const WRITER_MODELS = ['qwen3:8b', 'qwen3:14b']
const ROOM_MODELS = ['qwen3:4b', 'qwen3:1.7b', 'llama3.2:3b', 'qwen3:8b', 'qwen3:14b']
const THINK_CTX = 16384
const CHAT_CTX = 8192
const MAX_OUTPUT_TOKENS = 2800

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
  if (/rewrite|draft/i.test(signalLabel)) return 1500
  return think ? 1500 : 900
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
- Write ONLY the lyrics with their tags. No commentary, no titles, no markdown (** or #), no screenplay narration ("phone buzzes", "the crowd roars", "her voice cuts the heat") - every non-tag line is words the singer literally sings.`

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

export type { ChatMessage }

export async function chatRaw(model: string, messages: ChatMessage[], temperature: number, think: boolean, signalLabel: string): Promise<{ text: string; thinkBlock: string | null }> {
  return chat(model, messages, temperature, think, signalLabel)
}

async function chat(model: string, messages: ChatMessage[], temperature: number, think: boolean, signalLabel: string): Promise<{ text: string; thinkBlock: string | null }> {
  const qwenThinkingModel = /^qwen3:/i.test(model)
  // RELIABILITY: qwen3 small models ignore /no_think and reason in plain
  // content (no <think> tags), which used to leak into output and get rejected.
  // Force the NATIVE thinking channel on for qwen3 so reasoning lands in
  // message.thinking and message.content is always the clean answer. The
  // requested `think` flag now only sizes the context window.
  const apiThink = qwenThinkingModel ? true : think
  const finalMessages = messages
  // Watchdog: if the model produces NO tokens for this long, it is starved
  // (e.g. ACE holds the VRAM and the model is paging) - abort instead of
  // hanging the whole pipeline for ten minutes.
  const STALL_TIMEOUT_MS = 120_000
  const controller = new AbortController()
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
          num_ctx: think ? THINK_CTX : CHAT_CTX,
          num_predict: Math.min(MAX_OUTPUT_TOKENS, tokenBudgetFor(signalLabel, think)),
        },
      }),
    })
  } catch (error) {
    clearTimeout(stallTimer)
    if (controller.signal.aborted) {
      throw new Error(`Ollama ${signalLabel} stalled (no tokens for ${STALL_TIMEOUT_MS / 1000}s) - model ${model} is likely starved for VRAM`, { cause: error })
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
        throw new Error(`Ollama ${signalLabel} stalled (no tokens for ${STALL_TIMEOUT_MS / 1000}s) - model ${model} is likely starved for VRAM`, { cause: error })
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

/** Clean model formatting tics so ACE gets pure [Tag] + sung-line lyrics. */
function sanitizeLyrics(text: string) {
  return text
    .replace(/\*\*/g, '')                          // markdown bold
    .replace(/^\s*\*\([^)]*\)\*\s*$/gm, '')        // *(stage directions)*
    .replace(/^\s*\*[^*\n]+\*\s*$/gm, '')          // *phone buzzes twice*
    .replace(/\([^)\n]*(?:sfx|sound|camera|singer|voice|crowd|phone|enters|begins)[^)\n]*\)/gi, '')
    .replace(/^\s*#+\s*/gm, '')                    // markdown headers
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const LYRIC_SECTION_RE = /^\s*\[(?:intro|verse(?:\s*\d+)?|pre-chorus|chorus|hook|bridge|final chorus|outro|drop|breakdown|instrumental|build)[^\]]*\]\s*$/i
const NON_LYRIC_LINE_RE = /^(?:okay|first,|but wait|now,|alternatively|maybe|for the outro|rhyme\/flow|adherence|score:|verdict:|notes:|critic|local validator|rewrite instruction|requirements?:|the user|looking at|let's|i need|i should|return only|these lines|that'?s|this means)\b/i

function extractLyricsOnly(raw: string) {
  const clean = sanitizeLyrics(stripLeakedReasoning(raw))
  const lines = clean.split(/\r?\n/)
  const start = lines.findIndex((line) => LYRIC_SECTION_RE.test(line))
  if (start === -1) return ''

  const kept: string[] = []
  for (const line of lines.slice(start)) {
    const trimmed = line.trim()
    if (trimmed && NON_LYRIC_LINE_RE.test(trimmed)) break
    if (/^\s*[-*]\s*(?:the|this|try|maybe|fix|replace|adjust)\b/i.test(trimmed)) break
    kept.push(line.replace(/\s+\([A-Z]\)\s*$/i, ''))
  }

  const extracted = sanitizeLyrics(kept.join('\n'))
  return sungLinesBySection(extracted).untagged?.length ? '' : extracted
}

function progressSummary(text: string, max = 260) {
  return sanitizeLyrics(stripLeakedReasoning(text))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function makeDraftSnapshot(label: string, lyrics: string, note: string, intent?: SongIntent, idea?: string): LyricsDraftSnapshot {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    label,
    lyrics,
    note,
    createdAt: new Date().toISOString(),
    quality: buildQualityReport(lyrics, null, intent, idea),
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
  const score = Math.max(0, Math.min(100, Number(text.match(/SCORE:\s*(\d+)/i)?.[1] ?? 0)))
  const verdictRaw = text.match(/VERDICT:\s*(PASS|NEEDS_WORK|FAIL)/i)?.[1]?.toLowerCase()
  const verdict = verdictRaw === 'pass' ? 'pass' : verdictRaw === 'needs_work' ? 'needs_work' : 'fail'
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
  const minLines = intent?.durationMode === 'sample' ? 2 : intent?.durationMode === 'loop' ? 6 : 16
  if (allLines.length < minLines) issues.push(`Too short for this ${intent?.durationMode ?? 'song'}; needs at least ${minLines} sung lines.`)

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
  return issues
}

function buildQualityReport(
  lyrics: string,
  modelCritique: string | null = null,
  intent?: SongIntent | null,
  fallbackIdea?: string,
  semanticAdherence?: LyricsQualityReport['semanticAdherence'] | null,
): LyricsQualityReport {
  const clean = sanitizeLyrics(lyrics)
  const sections = sungLinesBySection(clean)
  const sectionNames = Object.keys(sections)
  const allLines = Object.values(sections).flat()
  const issues = validateLyrics(clean, intent, fallbackIdea)
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
  score = Math.max(0, Math.min(100, score))
  const verdict: LyricsQualityReport['verdict'] = score >= 82 && issues.length === 0 ? 'pass' : score >= 55 ? 'needs_work' : 'fail'
  const localPromptMatch = topicLock.requiredTerms.length
    ? Math.round((topicLock.matchedTerms.length / Math.max(1, topicLock.requiredTerms.length)) * 100)
    : 100
  const promptMatch = semanticAdherence ? Math.min(localPromptMatch, semanticAdherence.score) : localPromptMatch
  const structureScore = Math.max(0, 100 - missingSections.length * 22)

  return {
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
    semanticAdherence: semanticAdherence ?? undefined,
    topicLock,
    modelCritique,
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
  const startingQuality = buildQualityReport(clean, null, input.intent, input.idea)
  emitWriterProgress({ stage: 'rewrite', note: 'Rebuilding the lyrics from the current quality issues and the song intent packet.' })
  const rewriteRes = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    {
      role: 'user',
      content: [
        buildIntentBrief(input.intent, input.idea),
        `Rewrite instruction: ${input.instruction}`,
        `Current quality issues:\n${startingQuality.issues.length ? startingQuality.issues.map((issue) => `- ${issue}`).join('\n') : '- none'}`,
        `Current lyrics:\n${clean}`,
        'Return only the fixed sung lyrics with section tags.',
      ].filter(Boolean).join('\n\n'),
    },
  ], 0.75, true, 'lyrics-rewrite')
  const rewritten = extractLyricsOnly(rewriteRes.text)
  if (!rewritten) {
    throw new Error('The rewrite returned critique notes instead of tagged lyrics. Try again or switch writer models.')
  }
  const draftSnapshot = makeDraftSnapshot('Rewrite draft', rewritten, 'Fresh rewrite from the requested fix.', input.intent, input.idea)
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
  const quality = buildQualityReport(rewritten, critique, input.intent, input.idea, adherence)
  emitWriterProgress({ stage: 'finalizing', note: 'Packaging the clean rewrite with its quality report.' })
  return {
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
  const userContent = !think && isQwen ? `${user}\n\n/no_think` : user

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        think,
        keep_alive: '10m',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        options: { temperature, num_ctx: think ? THINK_CTX : CHAT_CTX, num_predict: Math.min(MAX_OUTPUT_TOKENS, tokenBudgetFor('completion', think)) },
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
    clearTimeout(timer)
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

const RANDOM_GENRES = ['dream pop', 'drill', 'neo-soul', 'post-rock', 'synthwave', 'bluegrass', 'shoegaze', 'afrobeats', 'industrial techno', 'bedroom pop', 'cinematic orchestral', 'lo-fi hip-hop', 'flamenco', 'gospel house', 'darkwave', 'jazz fusion', 'hyperpop', 'alt-country', 'UK garage', 'progressive metal', 'bossa nova', 'future funk', 'ambient folk', 'punk rap']
const RANDOM_THEMES = [
  'a baker hiding apology notes inside fortune cookies',
  'a night-shift nurse singing to the hospital elevators',
  'two neighbors who only meet during power outages',
  'a kid building a cardboard spaceship in a laundromat',
  'an ex-racer fixing bicycles for strangers after midnight',
  'a retired magician losing tricks but keeping one impossible coin',
  'a desert motel clerk collecting postcards from guests who never arrive',
  'friends turning a flooded basement into a dance floor',
  'a beekeeper learning to forgive a storm',
  'a street painter racing the rain before the mural disappears',
  'a choir practicing in an empty roller rink',
  'a chef trying to recreate a song from a childhood radio',
  'a security guard befriending a museum statue during thunderstorms',
  'a diver finding a wedding ring tied to a coral branch',
  'a rooftop gardener throwing a sunrise party for one lonely tenant',
  'a mechanic making a lullaby from broken dashboard chimes',
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
const BANNED_CONCEPT_PHRASES = [
  'last train',
  'dying town',
  'find the one moment',
  'find the moment',
  'moment it turns',
  'build the whole story toward it',
  'recurring dream',
]
let recentConceptSeeds: string[] = []

function songIdeaFallback(pick: <T>(items: T[]) => T, remember: (seed: string) => void) {
  const availableThemes = RANDOM_THEMES.filter((theme) => !recentConceptSeeds.includes(theme))
  const theme = pick(availableThemes.length ? availableThemes : RANDOM_THEMES)
  const shape = pick(RANDOM_STRUCTURES)
  remember(theme)
  const cleanShape = shape.split(':').pop()?.trim() || 'verse tension, chorus release, bridge truth, outro resolve'
  return {
    title: '',
    idea: `A song about ${theme}, shaped around ${cleanShape}. Keep the lyric focus on one singable emotional angle, with verse images that develop the idea and a chorus built around one memorable hook phrase.`,
  }
}

export async function generateConceptIdea(input?: { think?: boolean; model?: string }): Promise<{ title: string; idea: string }> {
  const model = await pickWriterModel(input?.model)
  const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]
  const remember = (seed: string) => {
    recentConceptSeeds = [seed, ...recentConceptSeeds.filter((item) => item !== seed)].slice(0, 6)
  }
  if (!model) return songIdeaFallback(pick, remember)
  try {
    const availableThemes = RANDOM_THEMES.filter((theme) => !recentConceptSeeds.includes(theme))
    const seedTheme = pick(availableThemes.length ? availableThemes : RANDOM_THEMES)
    const seedStructure = pick(RANDOM_STRUCTURES)
    remember(seedTheme)
    const raw = await ollamaComplete(
      model,
      `You create SONG IDEAS, not movie plots. Reply as STRICT JSON only:
{"title":"2-5 word song title","idea":"2 sentences max. Sentence 1: the song premise and emotional angle. Sentence 2: the verse-to-chorus arc and hook target."}
Rules:
- Do not name random characters unless the user asks.
- Do not write action-scene plot twists, hidden maps, collapsed murals, screenplay beats, or image/video prompts.
- The idea must be easy to turn into lyrics with verses, chorus, bridge, and outro.
- Mention the hook angle, not every event.`,
      `Seed theme: ${seedTheme}
Song shape: ${seedStructure}
Recent seeds to avoid: ${recentConceptSeeds.join('; ') || 'none'}
Write one compact song idea now.`,
      { think: input?.think ?? true, temperature: 0.95 },
    )
    const match = stripLeakedReasoning(raw).match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { title?: string; idea?: string }
      const idea = (parsed.idea || '').trim()
      const combined = `${parsed.title ?? ''} ${idea}`.toLowerCase()
      const banned = BANNED_CONCEPT_PHRASES.some((phrase) => combined.includes(phrase))
      if (!banned && idea.length > 45 && idea.length < 420) return { title: (parsed.title || '').trim(), idea }
    }
    return songIdeaFallback(pick, remember)
  } catch {
    return songIdeaFallback(pick, remember)
  }
}

export async function generateStyleForIdea(input: { title?: string; idea: string; tags?: string[]; model?: string; think?: boolean }): Promise<string> {
  const model = await pickWriterModel(input.model)
  const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)]
  const genre = pick(RANDOM_GENRES)
  const tagLine = input.tags?.length ? `User tags to respect: ${input.tags.join(', ')}` : `Suggested genre flavor: ${genre}`
  const fallback = `${genre} production shaped around the song idea: clear lead vocal, hook-forward chorus, one signature instrument, tight drums, and a mix that grows from intimate verses into a wider final chorus.`
  if (!model) return fallback
  try {
    const text = await ollamaComplete(
      model,
      `You write SOUND & STYLE captions for an AI music generator. Base the production on the song idea. Reply with ONLY 2-3 vivid sentences. Include genre/subgenre, tempo feel, vocal character, key instruments, drum feel, and mix texture. Do not add lyrics. Do not change the song topic.`,
      `Title: ${input.title || 'untitled'}
Song idea: ${input.idea}
${tagLine}`,
      { think: input.think ?? true, temperature: 0.85 },
    )
    const cleaned = cleanQuotedText(stripLeakedReasoning(text))
    return cleaned && !looksLikeExplanation(cleaned) ? cleaned : fallback
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
      { tag: '[Outro]', lines: '2 lines' },
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
      { tag: '[Outro]', lines: '2 lines' },
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
      { tag: '[Outro]', lines: '2 lines' },
    ]
    minDuration = 210
  }
  const text = `STRUCTURE PLAN (target ~${Math.round(target)}s - follow exactly):\n${sections.map((s) => `${s.tag}  (${s.lines})`).join('\n')}`
  return { sections, minDuration, text }
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
  const chain = [first, ...['qwen3:8b', 'qwen3:4b'].filter((m) => m !== first && installed.some((n) => n === m || n.startsWith(m)))]
  for (const candidate of chain) {
    if (await modelIsResponsive(candidate)) {
      return { model: candidate, demotedFrom: candidate === first ? null : first }
    }
  }
  // Nothing answered the probe - return the preferred model and let the
  // per-call watchdog surface a clear error.
  return { model: first, demotedFrom: null }
}

/** Scene -> draft -> critique -> rewrite, looping while the critic rejects
 *  (max 2 rewrites). Thinking mode on for the creative passes. */
export async function craftLyrics(input: {
  idea: string
  tags: string[]
  language: string
  structure: string[]
  existingLyrics?: string
  model?: string
  intent?: SongIntent
}): Promise<LyricsCraftResult> {
  const picked = await pickResponsiveWriter(input.model)
  const model = picked.model
  if (picked.demotedFrom) {
    emitWriterProgress({ stage: 'planning', note: `${picked.demotedFrom} is starved for VRAM, so the writer is using ${model} instead.` })
  }

  const plan = structurePlanFor(input.intent)
  const engineExample = await fetchEngineExample()
  const brief = [
    buildIntentBrief(input.intent, input.idea),
    input.tags.length ? `Musical style: ${input.tags.join(', ')}` : '',
    plan.text,
    input.language && input.language !== 'en' ? `Write the lyrics in language code: ${input.language}` : 'Write the lyrics in English.',
    input.existingLyrics?.trim()
      ? `The user has a draft - mine it for anything good, then surpass it:\n${input.existingLyrics.trim()}`
      : '',
    'Every lyric line must clearly belong to the user idea. If the idea is camping, sing camping/outdoor images, not candy, ads, phones, or unrelated scenes.',
    engineExample
      ? `FORMAT REFERENCE - an example of well-formatted ACE lyrics (copy the FORM: tags, line lengths, spacing - NEVER the content or topic):\n${engineExample}`
      : '',
  ].filter(Boolean).join('\n\n')

  // Pass 0 - invent the concrete story so the draft can't be generic.
  const drafts: LyricsDraftSnapshot[] = []
  emitWriterProgress({ stage: 'planning', note: 'Building the song intent packet, topic lock, required structure, and production boundaries.' })
  const sceneRes = await chat(model, [
    { role: 'system', content: SCENE_SYSTEM },
    { role: 'user', content: brief },
  ], 0.85, true, 'scene')
  const scene = sceneRes.text || sceneRes.thinkBlock || brief
  emitWriterProgress({ stage: 'planning', note: `Song worksheet: ${progressSummary(scene)}` })

  // Pass 1 - draft, with deliberate thinking.
  emitWriterProgress({ stage: 'drafting', note: 'Writing Draft 1 as tagged, singable lyrics from the worksheet.' })
  const draftRes = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    { role: 'user', content: `${brief}\n\nYour story worksheet (use this material - it is the song's world):\n${scene}` },
  ], 0.9, true, 'draft')
  const draft = extractLyricsOnly(draftRes.text)
  if (!draft) {
    throw new Error('The writer returned planning or critique text instead of tagged lyrics. DoReMii blocked it so it does not become a bad blueprint.')
  }
  const draftOne = makeDraftSnapshot('Draft 1', draft, 'First complete lyric draft from the song worksheet.', input.intent, input.idea)
  drafts.push(draftOne)
  emitWriterProgress({ stage: 'drafting', note: 'Draft 1 is ready. The critic is checking topic match, rhyme, structure, and singability next.', draft: draftOne })

  // Passes 2..n - critic loop: critique, rewrite, re-critique. Keep this tight
  // for Blueprint UX; deeper "let it cook" passes belong behind a Pro control.
  let current = draft
  let critique: string
  let validationIssues = validateLyrics(current, input.intent, input.idea)
  const maxRewriteRounds = /qwen3:4b/i.test(model) ? 1 : 2
  for (let round = 0; round < maxRewriteRounds; round += 1) {
    emitWriterProgress({ stage: 'self-critique', note: `Critiquing ${drafts[drafts.length - 1]?.label ?? 'the current draft'} against the prompt, structure, and flow rules.` })
    const critiqueRes = await chat(model, [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: `The song brief was:\n${brief}\n\nLocal validator issues that are automatic rejects:\n${validationIssues.length ? validationIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nThe lyrics to critique:\n${current}` },
    ], 0.4, false, `critique-${round + 1}`)
    critique = critiqueRes.text

    const flowRes = await chat(model, [
      { role: 'system', content: RHYME_FLOW_SYSTEM },
      { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nCheck these lyrics for rhyme, flow, structure, and singability:\n${current}` },
    ], 0.25, false, `flow-${round + 1}`)
    const adherence = await runAdherenceCheck(model, current, input.intent, input.idea)
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
    const rewriteRes = await chat(model, [
      { role: 'system', content: SONGWRITER_SYSTEM },
      { role: 'user', content: `${brief}\n\nStory worksheet:\n${scene}` },
      { role: 'assistant', content: current },
      { role: 'user', content: `A professional critic and local validator reviewed your lyrics.\n\nCritic review:\n${critique}\n\nLocal validator rejects:\n${validationIssues.length ? validationIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nRewrite from scratch if needed. Requirements:\n- Output ONLY sung lyrics with section tags.\n- ${plan.text.replace(/\n/g, '\n- ')}\n- Keep every verse and hook anchored to the topic lock in the song intent packet.\n- One core metaphor for the whole song; no adjective-stacking.\n- 6-10 syllables per line, consistent within each section.\n- No screenplay, no phone/camera/crowd descriptions - every non-tag line is sung.\n- Strong hook in the chorus; do not repeat verses verbatim.\n\nReturn only the revised lyrics.` },
    ], 0.85, true, `rewrite-${round + 1}`)
    const rewritten = extractLyricsOnly(rewriteRes.text)
    if (!rewritten) {
      emitWriterProgress({ stage: 'rewrite', note: 'The rewrite returned notes instead of tagged lyrics, so DoReMii kept the previous draft and will not treat notes as lyrics.' })
      break
    }
    current = rewritten
    validationIssues = validateLyrics(current, input.intent, input.idea)
    const snapshot = makeDraftSnapshot(`Draft ${drafts.length + 1}`, current, `Rewrite round ${round + 1} after critic and flow checks.`, input.intent, input.idea)
    drafts.push(snapshot)
    emitWriterProgress({ stage: 'rewrite', note: `${snapshot.label} is ready. Comparing it against the previous draft and running a fresh quality gate.`, draft: snapshot })
  }

  emitWriterProgress({ stage: 'finalizing', note: 'Running the final critic, rhyme/flow check, prompt-adherence check, and quality score.' })
  const finalIssues = validateLyrics(current, input.intent, input.idea)
  const finalCritiqueRes = await chat(model, [
    { role: 'system', content: CRITIC_SYSTEM },
    { role: 'user', content: `Final quality gate. The song brief was:\n${brief}\n\nLocal validator issues:\n${finalIssues.length ? finalIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nFinal candidate lyrics:\n${current}` },
  ], 0.25, false, 'final-critique')
  const finalFlowRes = await chat(model, [
    { role: 'system', content: RHYME_FLOW_SYSTEM },
    { role: 'user', content: `${buildIntentBrief(input.intent, input.idea)}\n\nFinal rhyme/flow check:\n${current}` },
  ], 0.2, false, 'final-flow')
  const finalAdherence = await runAdherenceCheck(model, current, input.intent, input.idea)
  critique = [
    finalCritiqueRes.text,
    `RHYME/FLOW CHECK:\n${finalFlowRes.text}`,
    finalAdherence ? `ADHERENCE CHECK:\nSCORE: ${finalAdherence.score}\nVERDICT: ${finalAdherence.verdict}\nNOTES:\n${finalAdherence.notes.map((note) => `- ${note}`).join('\n')}` : null,
  ].filter(Boolean).join('\n\n')
  const quality = buildQualityReport(current, critique, input.intent, input.idea, finalAdherence)
  // The pipeline already drafted, critiqued, and rewrote up to 3 times. We NEVER
  // hard-block here: a small local model rarely emits a literal "VERDICT: PASS"
  // even for solid lyrics, and blocking left the user unable to generate at all.
  // Instead we always return the best attempt plus its quality report, and the
  // UI surfaces the score + one-click Fix Issues so the user is the final judge.
  // The only true failure is producing no usable lyric text at all.
  if (!sanitizeLyrics(current).trim()) {
    throw new Error('The writer returned no usable lyrics. Try Reroll or a different writer model.')
  }
  return {
    lyrics: sanitizeLyrics(current),
    draft: sanitizeLyrics(draft),
    drafts,
    critique,
    quality,
    model,
    createdAt: new Date().toISOString(),
  }
}
