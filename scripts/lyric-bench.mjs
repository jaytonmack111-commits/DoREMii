const prompts = [
  'energetic song about camping',
  'sweet victory song about vibe code and DoReMii',
  'sea shanty about fighting through a storm',
  'breakup pop song about leaving the porch light on',
  'country rap song about working late and driving home',
  'funny novelty song about losing one sock',
  'dark cinematic ballad about a last train',
  'dance song about feeling brave for one night',
  'short vocal sample about a midnight text',
  '4-minute full song about starting over after graduation',
]

const requiredSections = ['verse 1', 'chorus', 'verse 2', 'bridge', 'outro']
const forbiddenLeakage = [
  'verdict:',
  'score:',
  'rhyme/flow',
  'prompt adherence',
  'local validator',
  'the user wants',
  'return only',
  'json',
]

function sections(lyrics) {
  return [...lyrics.matchAll(/^\s*\[([^\]]+)\]/gim)].map((match) => match[1].toLowerCase())
}

function sungLines(lyrics) {
  return lyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\[[^\]]+\]$/.test(line))
}

function evaluateLyrics(prompt, lyrics) {
  const lower = lyrics.toLowerCase()
  const foundSections = sections(lyrics)
  const promptTerms = prompt.toLowerCase().split(/\W+/).filter((term) => term.length > 3)
  const matchedTerms = promptTerms.filter((term) => lower.includes(term))
  const missingSections = requiredSections.filter((section) => !foundSections.some((found) => found.includes(section)))
  const leakage = forbiddenLeakage.filter((term) => lower.includes(term))
  const lines = sungLines(lyrics)
  return {
    prompt,
    ready: missingSections.length === 0 && leakage.length === 0 && matchedTerms.length >= Math.min(2, promptTerms.length) && lines.length >= 18,
    matchedTerms,
    missingSections,
    leakage,
    sungLineCount: lines.length,
  }
}

if (process.argv.includes('--fixtures')) {
  console.log(JSON.stringify({ prompts, requiredSections, forbiddenLeakage }, null, 2))
  process.exit(0)
}

console.log('DoReMii lyric bench fixtures')
console.log('Use these prompts in the app, then paste/export lyrics into this script later for automated scoring.')
for (const [index, prompt] of prompts.entries()) {
  console.log(`${index + 1}. ${prompt}`)
}

export { evaluateLyrics, prompts }
