import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import type { CoverArtRequest, CoverArtResult } from '../shared/types.js'
import { getDoReMiPaths } from './paths.js'
import { updateSongCover } from './database.js'
import { getEngineSettings } from './modelSettings.js'
import { withCover } from './aiConductor.js'
import { generateFluxImage, startFluxBackend } from './fluxManager.js'

const jobs = new Map<string, CoverArtResult>()

function sanitizeName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'cover'
}

const COVER_COMPOSITIONS = [
  'cinematic close-up of one emotionally important object, dramatic light, shallow depth of field',
  'wide atmospheric scene with a clear foreground subject and distant background, album-cover framing',
  'graphic poster illustration with bold silhouette, clean negative space, textured print grain',
  'surreal still life built from objects mentioned in the lyrics, moody studio lighting',
  'intimate portrait-like composition without showing a celebrity, expressive posture, symbolic props',
  'abstract texture landscape where color, rhythm, and shape echo the song mood',
  'documentary-style slice of life, natural light, honest and human, not stock photography',
  'dreamlike collage with two or three symbolic elements, balanced square composition',
]

const COVER_PALETTES = [
  'deep emerald, warm amber, soft black, small electric cyan accents',
  'midnight navy, neon magenta, bruised violet, clean white highlights',
  'dusty rose, charcoal, faded gold, pale blue-grey',
  'burnt orange, dark teal, cream light, muted crimson',
  'rainy slate, sodium yellow, wet asphalt black, soft green',
  'sunset coral, indigo shadow, lime accent, smoky brown',
  'silver blue, moss green, bone white, black ink',
  'hot pink, cobalt, acid yellow, deep purple',
]

const VISUAL_STOPWORDS = new Set([
  'the', 'and', 'that', 'with', 'from', 'this', 'into', 'your', 'youre', 'they', 'have', 'will', 'just',
  'like', 'when', 'where', 'what', 'were', 'been', 'about', 'through', 'there', 'their', 'every',
  'verse', 'chorus', 'bridge', 'outro', 'final', 'intro', 'instrumental', 'music', 'song',
])

function hashText(text: string) {
  let hash = 2166136261
  for (const char of text) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

function pickByHash<T>(items: T[], hash: number, offset = 0) {
  return items[(hash + offset) % items.length]
}

function extractLyricImages(lyrics: string, caption: string, title: string) {
  const source = `${title}\n${caption}\n${lyrics}`
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .toLowerCase()
  const counts = new Map<string, number>()
  for (const raw of source.split(/\s+/)) {
    const word = raw.replace(/^'+|'+$/g, '')
    if (word.length < 4 || VISUAL_STOPWORDS.has(word)) continue
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 14)
    .map(([word]) => word)
}

function summarizeNarrative(request: CoverArtRequest, images: string[]) {
  const lyricLines = request.lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]$/.test(line))
    .slice(0, 10)
  const hook = lyricLines.find((line) => /chorus|hook/i.test(line)) || lyricLines.find((line) => line.length > 25) || ''
  const title = request.title && !/^new doremii song|pop$/i.test(request.title) ? request.title : 'untitled track'
  return [
    `The cover should feel made for the song "${title}", not a generic playlist tile.`,
    hook ? `Main emotional line to visualize indirectly: "${hook.slice(0, 160)}".` : '',
    images.length ? `Concrete lyric imagery and motifs: ${images.join(', ')}.` : '',
    request.caption ? `Production/mood clue: ${request.caption.slice(0, 420)}.` : '',
  ].filter(Boolean).join('\n')
}

function briefFromRequest(request: CoverArtRequest) {
  const hash = hashText(`${request.songId || ''}|${request.title}|${request.caption}|${request.lyrics}`)
  const images = extractLyricImages(request.lyrics || '', request.caption || '', request.title || '')
  const mood = request.tags.find((tag) => /dark|romantic|epic|dreamy|energetic|chill|uplifting|aggressive/i.test(tag)) || 'emotionally specific'
  const genre = request.tags.find((tag) => /pop|rock|rap|hip-hop|country|folk|metal|edm|synthwave|ambient|jazz/i.test(tag)) || 'modern music'
  const composition = getEngineSettings().coverStylePreset === 'auto'
    ? pickByHash(COVER_COMPOSITIONS, hash)
    : getEngineSettings().coverStylePreset.replace(/_/g, ' ')
  const palette = pickByHash(COVER_PALETTES, hash, 17)
  return [
    'Square album cover, high-quality finished artwork.',
    summarizeNarrative(request, images),
    `Genre and mood: ${genre}, ${mood}.`,
    `Composition: ${composition}.`,
    `Color palette: ${palette}.`,
    request.bpm ? `Tempo impression: ${request.bpm} BPM; visual rhythm should match the energy.` : '',
    request.keyscale ? `Musical color hint: key ${request.keyscale}.` : '',
    'Make each cover visually unique: choose specific subject matter from the lyrics, not the same wave/orb layout.',
    'No readable text, no logos, no UI, no watermark, no celebrity likeness, no stock-photo blandness, no duplicated generic album template.',
  ].filter(Boolean).join('\n')
}

function svgCover(request: CoverArtRequest, prompt: string) {
  const seed = hashText(`${request.title}${request.caption}${request.lyrics}${request.songId || ''}`)
  const hue = seed % 360
  const h2 = (hue + 72) % 360
  const h3 = (hue + 220) % 360
  const title = request.title.replace(/[<>&]/g, '')
  const subtitle = request.tags.slice(0, 3).join(' / ').replace(/[<>&]/g, '')
  const promptComment = prompt.replace(/--/g, '-').replace(/[<>&]/g, '')
  const shape = seed % 5
  const motif = extractLyricImages(request.lyrics || '', request.caption || '', request.title || '').slice(0, 3).join(' / ').replace(/[<>&]/g, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <!-- DoReMii procedural fallback. FLUX prompt: ${promptComment} -->
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 13%)"/>
      <stop offset="0.52" stop-color="hsl(${h2} 65% 18%)"/>
      <stop offset="1" stop-color="hsl(${h3} 75% 10%)"/>
    </linearGradient>
    <radialGradient id="sun" cx="45%" cy="34%" r="35%">
      <stop offset="0" stop-color="hsl(${(hue + 42) % 360} 100% 70%)"/>
      <stop offset="1" stop-color="hsl(${hue} 90% 48%)" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="360" cy="330" r="280" fill="url(#sun)" opacity="0.75"/>
  ${shape === 0 ? `<g opacity="0.72" stroke="hsl(${(hue + 145) % 360} 90% 62%)" stroke-width="7" fill="none" filter="url(#glow)">
    <path d="M80 710 C220 610 300 820 442 704 S704 566 944 684"/>
    <path d="M86 782 C232 682 322 876 494 764 S736 638 944 748" opacity="0.75"/>
    <path d="M114 590 C286 490 370 642 504 558 S760 426 928 546" opacity="0.55"/>
  </g>` : ''}
  ${shape === 1 ? `<g opacity="0.72" fill="none" stroke="hsl(${(hue + 145) % 360} 90% 62%)" stroke-width="9" filter="url(#glow)">
    <rect x="210" y="210" width="604" height="604" rx="44" transform="rotate(-8 512 512)"/>
    <path d="M238 640 L512 260 L784 642 Z"/>
    <circle cx="512" cy="512" r="86"/>
  </g>` : ''}
  ${shape === 2 ? `<g opacity="0.78" fill="hsl(${(hue + 145) % 360} 90% 62%)" filter="url(#glow)">
    <circle cx="272" cy="552" r="118"/><circle cx="566" cy="424" r="82"/><circle cx="720" cy="672" r="138"/>
    <rect x="180" y="742" width="650" height="28" rx="14"/>
  </g>` : ''}
  ${shape === 3 ? `<g opacity="0.76" stroke="hsl(${(hue + 145) % 360} 90% 62%)" stroke-width="12" fill="none" filter="url(#glow)">
    <path d="M170 792 C280 300 470 252 510 528 C550 800 746 644 850 248"/>
    <path d="M210 250 L814 814"/>
  </g>` : ''}
  ${shape === 4 ? `<g opacity="0.72" fill="none" stroke="hsl(${(hue + 145) % 360} 90% 62%)" stroke-width="8" filter="url(#glow)">
    <path d="M208 718 Q512 190 816 718"/>
    <path d="M206 718 Q512 510 816 718"/>
    <path d="M512 188 V820"/>
  </g>` : ''}
  <g opacity="0.35">
    <rect x="0" y="812" width="1024" height="212" fill="black"/>
    <path d="M0 812 L1024 760 L1024 1024 L0 1024Z" fill="hsl(${h3} 85% 8%)"/>
  </g>
  <g fill="hsl(${(hue + 55) % 360} 95% 64%)" opacity="0.85">
    <circle cx="824" cy="214" r="42"/><circle cx="878" cy="254" r="12"/><circle cx="760" cy="272" r="8"/>
  </g>
  <text x="72" y="884" fill="white" font-family="Arial, sans-serif" font-size="54" font-weight="800" opacity="0.92">${title}</text>
  <text x="76" y="938" fill="hsl(${(hue + 50) % 360} 90% 76%)" font-family="Arial, sans-serif" font-size="28" font-weight="600" opacity="0.82">${subtitle}</text>
  <text x="76" y="978" fill="white" font-family="Arial, sans-serif" font-size="20" font-weight="600" opacity="0.45">${motif}</text>
</svg>`
}

export async function generateCoverArt(request: CoverArtRequest): Promise<CoverArtResult> {
  const key = request.songId || request.title
  const pending: CoverArtResult = { songId: request.songId, status: 'generating', coverArtPath: null, prompt: briefFromRequest(request), backend: 'flux.1-schnell', error: null }
  jobs.set(key, pending)
  return withCover(async () => {
    const coversDir = getDoReMiPaths().covers
    fs.mkdirSync(coversDir, { recursive: true })
    const settings = getEngineSettings()
    const prompt = pending.prompt
    const filename = `${sanitizeName(request.title)}-${request.songId || Date.now()}.png`
    const dest = path.join(coversDir, filename)

    try {
      await startFluxBackend()
      const size = Number(settings.coverResolution || '768')
      const outputPath = await generateFluxImage({
        prompt,
        outputPath: dest,
        width: size,
        height: size,
        steps: 4,
        seed: request.songId ? [...request.songId].reduce((sum, char) => sum + char.charCodeAt(0), 0) : Date.now(),
      })
      const result: CoverArtResult = {
        songId: request.songId,
        status: 'ready',
        coverArtPath: outputPath,
        prompt,
        backend: 'flux.1-schnell',
        error: null,
      }
      jobs.set(key, result)
      if (request.songId) updateSongCover(request.songId, outputPath, result.status)
      return result
    } catch (error) {
      const fallbackPath = dest.replace(/\.png$/i, '.svg')
      fs.writeFileSync(fallbackPath, svgCover(request, prompt), 'utf8')
      const result: CoverArtResult = {
        songId: request.songId,
        status: 'failed',
        coverArtPath: fallbackPath,
        prompt,
        backend: 'flux.1-schnell',
        error: error instanceof Error ? error.message : String(error),
      }
      jobs.set(key, result)
      if (request.songId) updateSongCover(request.songId, fallbackPath, 'failed')
      return result
    }
  })
}

export function getCoverStatus(songId?: string): CoverArtResult | null {
  if (!songId) return [...jobs.values()].at(-1) ?? null
  return jobs.get(songId) ?? null
}

export function cancelCover(songId?: string) {
  if (songId) jobs.delete(songId)
}

export async function openCoverFolder() {
  const dir = getDoReMiPaths().covers
  fs.mkdirSync(dir, { recursive: true })
  await shell.openPath(dir)
}
