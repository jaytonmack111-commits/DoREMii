import { BrowserWindow } from 'electron'
import { spawn } from 'node:child_process'
import type { LyricsCraftResult, LyricsQualityReport, SongIntent } from '../shared/types.js'
import { getEngineSettings } from './modelSettings.js'

const OLLAMA_URL = 'http://127.0.0.1:11434'
/** Default writer follows the user's observed best local lyric behavior; 14B stays available for deep rewrite/critique. */
const WRITER_MODELS = ['qwen3:8b', 'qwen3:14b']
const ROOM_MODELS = ['qwen3:4b', 'qwen3:1.7b', 'llama3.2:3b', 'qwen3:8b', 'qwen3:14b']
const FINAL_MARKER = '###DOREMII_FINAL###'
const THINK_CTX = 16384
const CHAT_CTX = 8192
const MAX_OUTPUT_TOKENS = 2800

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
- You MAY use ACE performance tags on their own line inside sections: [Guitar Solo], [Instrumental], [Build], [Drop], [Breakdown], or a vocal hint joined to a section tag like [Chorus - anthemic]. Use at most 2-3 of these in the whole song, matching the musical style.
- Parentheses inside a sung line mean backing vocals: "We rise together (together)". Use sparingly.
- UPPERCASE words mean shouted/intense delivery: use only at true peaks.
- The chorus may repeat its hook; verses must never repeat lines verbatim; never repeat a whole section's text outside the chorus.
- Write ONLY the lyrics with their tags. No commentary, no titles, no markdown (** or #), no screenplay narration ("phone buzzes", "the crowd roars", "her voice cuts the heat") - every non-tag line is words the singer literally sings.`

const SCENE_SYSTEM = `You are a story developer for a hit songwriting team. Given a song idea, invent the CONCRETE story the song will tell. Answer briefly:
1. WHO is singing, and to whom? (invent a specific person/relationship)
2. WHERE and WHEN? (one specific location, time, season - with 3 sensory details)
3. THE OBJECT: one physical object that carries the song's emotion
4. THE TURN: what changes emotionally between verse 1 and the final chorus?
5. HOOKS: 3 candidate chorus hook lines built from the imagery above (no clichés, no "stars/dreams/heart")
Keep it under 200 words. This is a private worksheet, not lyrics.`

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
- rhyme or purposeful slant rhyme
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
  const finalMessages = qwenThinkingModel && !think
    ? messages.map((message, index) => ({
        ...message,
        content: index === 0
          ? `${message.content}\n\nFor this app, your usable answer MUST appear after this exact marker on its own line: ${FINAL_MARKER}. Put all chat replies, directives, or lyrics after that marker. Keep the final answer concise.\n/no_think`
          : `${message.content}\n\nEnd with ${FINAL_MARKER} on its own line, followed by only the usable answer.\n/no_think`,
      }))
    : messages
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
        think,
        keep_alive: '15m',
        options: {
          temperature,
          num_ctx: think ? THINK_CTX : CHAT_CTX,
          num_predict: MAX_OUTPUT_TOKENS,
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

  let text = streamedText.trim()
  let thinkBlock = streamedThinking.trim() || null
  if (!think && text.includes(FINAL_MARKER)) {
    const markerIndex = text.lastIndexOf(FINAL_MARKER)
    const beforeFinal = text.slice(0, markerIndex).trim()
    const afterFinal = text.slice(markerIndex + FINAL_MARKER.length).trim()
    thinkBlock = [thinkBlock, beforeFinal].filter(Boolean).join('\n\n') || null
    text = afterFinal
  }
  if (!think && qwenThinkingModel && !text.includes(FINAL_MARKER) && text.length > 500 && /(\bthe user wants\b|\blet me\b|\bbrainstorm|\bsteps:|\busable answer\b)/i.test(text)) {
    throw new Error(`Ollama ${signalLabel} returned reasoning instead of a usable answer`)
  }
  
  if (!text && thinkBlock && !think) {
    throw new Error(`Ollama ${signalLabel} only returned thinking text; retry with a smaller prompt or higher token budget`)
  }
  if (!text && !thinkBlock) throw new Error(`Ollama ${signalLabel} returned an empty response`)
  
  if (!thinkBlock) {
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/)
    if (thinkMatch) {
      thinkBlock = thinkMatch[1].trim()
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    }
  }

  return { text, thinkBlock }
}

export function emitWriterProgress(stage: string) {
  if (!BrowserWindow?.getAllWindows) return
  const wins = BrowserWindow.getAllWindows()
  if (wins.length > 0) {
    wins[0].webContents.send('writer:progress', stage)
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
  emitWriterProgress('rewrite')
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
  const rewritten = sanitizeLyrics(rewriteRes.text)
  emitWriterProgress('self-critique')
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
  emitWriterProgress('finalizing')
  return {
    lyrics: rewritten,
    draft: clean,
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

const ENHANCE_PROMPTS: Record<'style' | 'idea' | 'lyrics', string> = {
  style: `You polish sound-and-style descriptions for an AI music generator.
Rewrite the user's text into ONE vivid production description: genre, energy, vocal character, key instruments, drum feel, production texture, era. Keep every intention the user expressed. 2-4 sentences, no lyrics, no section tags, no preamble.`,
  idea: `You sharpen song concepts.
Rewrite the user's idea into a tighter concept: clear subject, emotional angle, and ONE core image or metaphor the song can hang on. Keep their topic and language exactly. 1-3 sentences, no lyrics, no preamble.`,
  lyrics: `You are a lyric editor. Improve the user's lyrics IN PLACE: keep their structure tags, story, and most of their words. Fix weak lines, rhythm, and rhyme; tighten syllables for singability (6-10 per line). Output ONLY the improved lyrics, nothing else.`,
}

/** Quick single-shot text improver for the Studio's Enhance buttons.
 *  Ollama-only: never touches the ACE engine, so it works while ACE warms. */
export async function enhanceText(input: { kind: 'style' | 'idea' | 'lyrics'; text: string; tags?: string[]; model?: string }): Promise<string> {
  const text = input.text.trim()
  if (!text) throw new Error('Write something first, then Enhance can improve it.')
  const model = await pickWriterModel(input.model)
  if (!model) {
    const why = (await isWriterAvailable()).reason
    throw new Error(`Enhance needs the local writer (Ollama): ${why}`)
  }
  const tagLine = input.tags?.length ? `\n\nSelected style tags to respect: ${input.tags.join(', ')}` : ''
  const { text: improved } = await chatRaw(model, [
    { role: 'system', content: ENHANCE_PROMPTS[input.kind] },
    { role: 'user', content: `${text}${tagLine}` },
  ], 0.7, false, `enhance-${input.kind}`)
  const cleaned = improved.trim().replace(/^["'“]|["'”]$/g, '')
  if (!cleaned) throw new Error('The writer returned nothing - try again.')
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
    const { text } = await chatRaw(model, [
      { role: 'system', content: 'You name songs. Read the lyrics and reply with ONE evocative title, 1-5 words, Title Case. No quotes, no punctuation at the end, no explanation - just the title.' },
      { role: 'user', content: `${input.idea ? `Song concept: ${input.idea}\n\n` : ''}Lyrics:\n${input.lyrics.slice(0, 2400)}` },
    ], 0.8, false, 'suggest-title')
    const title = text.trim().split(/\r?\n/)[0].replace(/^["'“]|["'”]$/g, '').replace(/[.!?]+$/, '').trim()
    if (title && title.length <= 60 && !/^(title|song)\b[:\s]/i.test(title)) return title
    return fallbackTitle(input.lyrics, input.idea)
  } catch {
    return fallbackTitle(input.lyrics, input.idea)
  }
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
    emitWriterProgress(`(${picked.demotedFrom} is starved for VRAM - using ${model} instead)`)
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
  emitWriterProgress('planning')
  const sceneRes = await chat(model, [
    { role: 'system', content: SCENE_SYSTEM },
    { role: 'user', content: brief },
  ], 0.85, true, 'scene')
  const scene = sceneRes.text || sceneRes.thinkBlock || brief

  // Pass 1 - draft, with deliberate thinking.
  emitWriterProgress('drafting')
  const draftRes = await chat(model, [
    { role: 'system', content: SONGWRITER_SYSTEM },
    { role: 'user', content: `${brief}\n\nYour story worksheet (use this material - it is the song's world):\n${scene}` },
  ], 0.9, true, 'draft')
  const draft = draftRes.text

  // Passes 2..n - critic loop: critique, rewrite, re-critique. Max 3 rewrites.
  let current = draft
  let critique: string
  let validationIssues = validateLyrics(current, input.intent, input.idea)
  for (let round = 0; round < 3; round += 1) {
    emitWriterProgress('self-critique')
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

    emitWriterProgress('rewrite')
    validationIssues = validateLyrics(current, input.intent, input.idea)
    const rewriteRes = await chat(model, [
      { role: 'system', content: SONGWRITER_SYSTEM },
      { role: 'user', content: `${brief}\n\nStory worksheet:\n${scene}` },
      { role: 'assistant', content: current },
      { role: 'user', content: `A professional critic and local validator reviewed your lyrics.\n\nCritic review:\n${critique}\n\nLocal validator rejects:\n${validationIssues.length ? validationIssues.map((issue) => `- ${issue}`).join('\n') : '- none'}\n\nRewrite from scratch if needed. Requirements:\n- Output ONLY sung lyrics with section tags.\n- ${plan.text.replace(/\n/g, '\n- ')}\n- Keep every verse and hook anchored to the topic lock in the song intent packet.\n- One core metaphor for the whole song; no adjective-stacking.\n- 6-10 syllables per line, consistent within each section.\n- No screenplay, no phone/camera/crowd descriptions - every non-tag line is sung.\n- Strong hook in the chorus; do not repeat verses verbatim.\n\nReturn only the revised lyrics.` },
    ], 0.85, true, `rewrite-${round + 1}`)
    current = sanitizeLyrics(rewriteRes.text)
    validationIssues = validateLyrics(current, input.intent, input.idea)
  }

  emitWriterProgress('finalizing')
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
  if (finalIssues.length) {
    throw new Error(`Lyrics failed quality gate: ${finalIssues.join(' ')}`)
  }
  if (finalAdherence?.verdict === 'fail') {
    throw new Error(`Lyrics failed prompt-adherence gate: ${finalAdherence.notes.join(' ')}`)
  }
  if (!/VERDICT:\s*PASS/i.test(critique)) {
    throw new Error(`Lyrics failed critic/rhyme gate: ${critique.replace(/\s+/g, ' ').slice(0, 700)}`)
  }
  return {
    lyrics: sanitizeLyrics(current),
    draft: sanitizeLyrics(draft),
    critique,
    quality,
    model,
    createdAt: new Date().toISOString(),
  }
}
