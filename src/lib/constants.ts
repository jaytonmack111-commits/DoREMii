import type { ModeType } from '../shared/types'

export const GENRES = [
  'Pop', 'Hip-Hop', 'R&B', 'Rock', 'EDM', 'House', 'Trap', 'Lo-Fi',
  'Cinematic', 'Jazz', 'Folk', 'Metal', 'Synthwave', 'Ambient', 'Funk', 'Country',
  'Punk', 'Pop Punk', 'Indie Rock', 'Alternative', 'Soul', 'Gospel', 'Blues',
  'Reggae', 'Dancehall', 'Afrobeats', 'K-Pop', 'J-Pop', 'Hyperpop', 'Dubstep',
  'Drum and Bass', 'Techno', 'Trance', 'Disco', 'Latin Pop', 'Reggaeton',
  'Flamenco Pop', 'Orchestral', 'Trailer Music', 'Sea Shanty', 'Bluegrass',
  'Industrial', 'Post-Rock', 'Emo', 'Ska', 'Phonk', 'Witch House',
]

export const VIBES = [
  'Energetic', 'Dreamy', 'Dark', 'Uplifting', 'Chill', 'Aggressive',
  'Romantic', 'Epic', 'Nostalgic', 'Playful', 'Moody', 'Euphoric',
  'Melancholic', 'Intimate', 'Triumphant', 'Haunting', 'Bittersweet',
  'Hopeful', 'Chaotic', 'Mystical', 'Tender', 'Defiant', 'Luxurious',
  'Hypnotic', 'Gritty', 'Warm', 'Cold', 'Cinematic Tension',
]

export const VOCALS = [
  'Male Lead', 'Female Lead', 'Duet', 'Choir', 'Soft', 'Powerful', 'Rap', 'Spoken',
  'Breathy', 'Whispered', 'Anthemic', 'Screaming', 'Falsetto', 'Auto-Tuned',
  'Call and Response', 'Layered Harmonies', 'Background Ad-Libs', 'Group Vocals',
]

export const INSTRUMENTS = [
  'Acoustic Guitar', 'Electric Guitar', 'Distorted Guitars', 'Piano', 'Rhodes',
  'Synth Pads', 'Lead Synth', 'Arpeggiated Synth', '808 Bass', 'Sub Bass',
  'Live Bass', 'Strings', 'Brass', 'Choir', 'Saxophone', 'Flute', 'Harp',
  'Banjo', 'Fiddle', 'Accordion', 'Taiko Drums', 'Orchestral Percussion',
  'Steel Drums', 'Organ', 'Glitch Textures',
]

export const DRUMS = [
  'Punchy Drums', 'Driving Rock Beat', 'Trap Hi-Hats', 'Boom Bap Drums',
  'Four-on-the-Floor', 'Breakbeats', 'Double Kick', 'Handclaps', 'Stomps',
  'Percussion Loop', 'Minimal Drums', 'Dusty Drums', 'Cinematic Hits',
]

export const PRODUCTION_TAGS = [
  'Polished Mix', 'Lo-Fi Texture', 'Vinyl Crackle', 'Live Recording',
  'Bedroom Pop', 'Wide Stereo', 'Heavy Reverb', 'Dry Vocals', 'Sidechain Pumping',
  'Tape Saturation', 'Crisp Highs', 'Tight Low-End', 'Muddy Avoidance',
  'Radio Ready', 'Club Mix', 'Orchestral Build', 'Glitch Edits',
]

export const ERA_TAGS = [
  '60s', '70s', '80s', '90s', '2000s', '2010s', 'Modern', 'Retro-Futuristic',
  'Y2K', 'Vaporwave', 'Medieval Fantasy', 'Cyberpunk', 'Anime Opening',
]

export const TAG_CATEGORIES = [
  { id: 'genres', label: 'Genres', items: GENRES },
  { id: 'vibes', label: 'Vibes', items: VIBES },
  { id: 'vocals', label: 'Vocals', items: VOCALS },
  { id: 'instruments', label: 'Instruments', items: INSTRUMENTS },
  { id: 'drums', label: 'Drums', items: DRUMS },
  { id: 'production', label: 'Production', items: PRODUCTION_TAGS },
  { id: 'eras', label: 'Era / Context', items: ERA_TAGS },
] as const

export const STRUCTURE = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Drop', 'Outro']

export const LANGUAGES: [string, string][] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['it', 'Italian'], ['pt', 'Portuguese'], ['auto', 'Auto'],
]

export const MODE_LIBRARY: { id: ModeType; label: string; needsSource?: boolean; desc: string }[] = [
  { id: 'simple', label: 'Simple', desc: 'Text-to-music from your prompt.' },
  { id: 'lyrics', label: 'Lyrics', desc: 'Sing your own written lyrics.' },
  { id: 'instrumental', label: 'Instrumental', desc: 'No vocals, pure music.' },
  { id: 'remix', label: 'Remix', needsSource: true, desc: 'Reimagine an existing track.' },
  { id: 'repaint', label: 'Repaint', needsSource: true, desc: 'Regenerate part of a song.' },
  { id: 'cover', label: 'Cover', needsSource: true, desc: 'New style over a source.' },
  { id: 'extend', label: 'Extend', needsSource: true, desc: 'Continue a track further.' },
  { id: 'complete', label: 'Complete', needsSource: true, desc: 'Fill in missing sections.' },
  { id: 'extract', label: 'Extract', needsSource: true, desc: 'Pull stems / codes out.' },
]

export const PRESET_PACKS: { name: string; genres: string[]; vibes: string[] }[] = [
  { name: 'Radio Pop', genres: ['Pop'], vibes: ['Uplifting', 'Energetic'] },
  { name: 'Trap', genres: ['Trap', 'Hip-Hop'], vibes: ['Dark', 'Aggressive'] },
  { name: 'Cinematic', genres: ['Cinematic'], vibes: ['Epic'] },
  { name: 'Sea Shanty', genres: ['Folk'], vibes: ['Playful', 'Nostalgic'] },
  { name: 'Synthwave', genres: ['Synthwave'], vibes: ['Nostalgic', 'Dreamy'] },
  { name: 'Metal', genres: ['Metal'], vibes: ['Aggressive'] },
  { name: 'Ambient', genres: ['Ambient'], vibes: ['Dreamy', 'Chill'] },
  { name: 'Lo-Fi', genres: ['Lo-Fi'], vibes: ['Chill', 'Nostalgic'] },
  { name: 'EDM', genres: ['EDM', 'House'], vibes: ['Energetic', 'Euphoric'] },
  { name: 'Folk', genres: ['Folk'], vibes: ['Nostalgic'] },
]

export const TEMPLATES: { name: string; idea: string; genres: string[]; vibes: string[] }[] = [
  { name: 'Anime Intro', idea: 'High-energy anime opening with soaring vocals and driving drums', genres: ['Pop', 'Rock'], vibes: ['Energetic', 'Epic'] },
  { name: 'Boss Fight Theme', idea: 'Intense orchestral boss battle with choir and heavy percussion', genres: ['Cinematic', 'Metal'], vibes: ['Epic', 'Aggressive'] },
  { name: 'Radio Pop Hook', idea: 'Catchy radio pop with a huge sing-along chorus', genres: ['Pop'], vibes: ['Uplifting'] },
  { name: 'Lo-Fi Study', idea: 'Relaxed lo-fi beat with warm keys and vinyl crackle', genres: ['Lo-Fi'], vibes: ['Chill'] },
  { name: 'Trailer Cue', idea: 'Epic movie-trailer build with braams and risers', genres: ['Cinematic'], vibes: ['Epic'] },
  { name: 'Sea Shanty', idea: 'Rowdy call-and-response sea shanty with stomps and claps', genres: ['Folk'], vibes: ['Playful'] },
]

export const WORKSHOP_TOOLS = ['Improve', 'Rhyme', 'Simplify', 'Translate', 'Singable']

export const LAB_FEATURES: { title: string; desc: string }[] = [
  { title: 'DAW-Style Timeline', desc: 'Arrange generated sections on a visual multi-track timeline.' },
  { title: 'Stem Separation / Mixing', desc: 'Split vocals, drums, bass and melody, then mix them independently.' },
  { title: 'Voice Style Profiles', desc: 'Keep a consistent vocal identity across many songs.' },
  { title: 'Library Training Helpers', desc: 'Analyze your favourite tracks for style references.' },
  { title: 'Auto Music Video', desc: 'Generate reactive visuals and a video from your song.' },
  { title: 'DAW Plugin Bridge', desc: 'VST-style bridge into FL Studio, Ableton and Reaper.' },
  { title: 'Live Prompt Morphing', desc: 'Change mood and instrumentation over time while generating.' },
  { title: 'Album Builder', desc: 'Generate a coherent album with a shared sonic identity.' },
  { title: 'Advanced Critic Mode', desc: 'Score hooks, mix clarity, language and structure automatically.' },
  { title: 'Multi-Engine Backend', desc: 'Run ACE-Step plus other local / open models under one app.' },
]

export const FEATURED = [
  { id: 'daily', label: 'Made For You', title: 'Daily Mix 1', hue: 268 },
  { id: 'neon', label: 'Discover', title: 'Neon Nights', hue: 308 },
  { id: 'chill', label: 'Your Top Mix', title: 'Chill Vibes', hue: 196 },
  { id: 'synth', label: 'New Releases', title: 'Synthwave 2024', hue: 286 },
  { id: 'focus', label: 'Deep Focus', title: 'Focus Mode', hue: 224 },
  { id: 'radio', label: 'Model Radio', title: 'Studio Radio', hue: 338 },
]
