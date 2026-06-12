import crypto from 'node:crypto'
import type { WebContents } from 'electron'
import type { RoomAgent, RoomMessage, RoomState, SongIntent } from '../shared/types.js'
import { chatRaw, pickRoomModel, pickWriterModel, type ChatMessage } from './ollamaService.js'
import { createBlueprint } from './generationService.js'

/** The Writers' Room: a Producer agent coordinates the session, spawns
 *  specialist agents on demand, searches the web while thinking, and always
 *  hands the floor back to the user at the end of a round. */

const MAX_AGENT_MESSAGES_PER_ROUND = 6
const MAX_AGENTS = 5

const PRODUCER_PROTOCOL = `
== ROOM PROTOCOL (follow exactly) ==
You can use these directives, each on its own line:
[SPAWN] {"name":"Country Veteran","emoji":"🤠","specialty":"country songwriting","briefing":"30 years writing Nashville hits. Knows classic and modern country structure, imagery, instrumentation."}
  -> Creates a specialist who joins the chat. Spawn one only when their expertise is genuinely needed. Max ${MAX_AGENTS} in the room.
[SEARCH] your search query
  -> Looks the query up on the web; results come back to you before anyone else speaks.
[FINAL]
  -> Put this alone on a line, followed by the complete final lyrics with [Verse]/[Chorus] section tags, when the room agrees lyrics are done. Plain text, no markdown.

Rules:
- Speak in chat style: short, punchy, conversational. No essays.
- You chair the room: give specialists concrete assignments, synthesize their ideas, keep momentum.
- When you need the user's input or approval, ASK them a direct question and stop.
- Never fake expertise - spawn a specialist or search instead.`

const SPECIALIST_PROTOCOL = `
== ROOM PROTOCOL ==
- You are one voice in a songwriting room chat. Speak as yourself, short and conversational - pitch lines, react to others, improve what's on the table.
- You may use, on its own line: [SEARCH] query  -> to look something up on the web before finishing your thought.
- Suggest concrete lyric lines, not vague advice. Quote and fix other people's lines.
- Never pretend to be the Producer or the user.`

interface RoomSession {
  id: string
  model: string
  agents: RoomAgent[]
  messages: RoomMessage[]
  context: string
  intent: SongIntent | null
  tags: string[]
  lyrics: string
  caption: string
  busy: boolean
}

let session: RoomSession | null = null

function pushMessage(sender: WebContents, msg: Omit<RoomMessage, 'id' | 'at'>) {
  const full: RoomMessage = { ...msg, id: crypto.randomUUID(), at: new Date().toISOString() }
  session?.messages.push(full)
  try { sender.send('room:message', full) } catch { /* window gone */ }
  return full
}

async function webSearch(query: string): Promise<string> {
  try {
    const response = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 DoReMii-WritersRoom' },
    })
    const html = await response.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, 1500) || 'No results.'
  } catch (error) {
    return `Search failed: ${error instanceof Error ? error.message : String(error)}`
  }
}

function transcriptFor(): string {
  return (session?.messages ?? [])
    .filter((m) => m.kind === 'chat' || m.kind === 'final')
    .slice(-40)
    .map((m) => `${m.name}: ${m.content}`)
    .join('\n')
}

function agentSystem(agent: RoomAgent): string {
  const protocol = agent.id === 'producer' ? PRODUCER_PROTOCOL : SPECIALIST_PROTOCOL
  return `${agent.persona}\n\nSong context:\n${session?.context ?? ''}\n\nRules for this specific song:
- The user's idea is the creative anchor. Do not drift into unrelated topics.
- Complete vocal lyrics need [Verse 1], [Chorus], [Verse 2], [Chorus], [Bridge], [Final Chorus], and [Outro].
- Give sung lyric lines, not screenplay, stage directions, camera notes, or sound-effect descriptions.
\n${protocol}`
}

async function speak(sender: WebContents, agent: RoomAgent): Promise<{ text: string; waitUser: boolean; final: string | null; thinkBlock: string | null }> {
  if (!session) throw new Error('No active room')
  try { sender.send('room:typing', agent) } catch { /* window gone */ }
  if (agent.id === 'ace-engine') {
    try {
      const blueprint = await createBlueprint({
        query: `${session.context}\n\nRoom transcript:\n${transcriptFor()}`,
        instrumental: false,
        vocalLanguage: 'en',
        tags: session.tags,
      })
      const text = [
        'ACE engine pass:',
        blueprint.caption ? `Style/caption: ${blueprint.caption}` : '',
        blueprint.lyrics ? `Lyric idea:\n${blueprint.lyrics}` : '',
        blueprint.bpm ? `BPM: ${blueprint.bpm}` : '',
        blueprint.keyscale ? `Key: ${blueprint.keyscale}` : '',
      ].filter(Boolean).join('\n')
      try { sender.send('room:typing', null) } catch { /* window gone */ }
      return { text, waitUser: false, final: null, thinkBlock: 'Used ACE /v1/create_sample as a local music-engine perspective.' }
    } catch (error) {
      try { sender.send('room:typing', null) } catch { /* window gone */ }
      return {
        text: `ACE engine could not chime in yet: ${error instanceof Error ? error.message : String(error)}`,
        waitUser: false,
        final: null,
        thinkBlock: null,
      }
    }
  }
  let messages: ChatMessage[] = [
    { role: 'system', content: agentSystem(agent) },
    { role: 'user', content: `Chat so far:\n${transcriptFor()}\n\nIt is your turn, ${agent.name}. Reply as yourself (do not prefix your name).` },
  ]
  const model = agent.model || session.model
  let res: { text: string; thinkBlock: string | null }
  try {
    res = await chatRaw(model, messages, agent.id === 'producer' ? 0.7 : 0.9, false, `room-${agent.id}`)
  } catch (error) {
    const fallback = await pickWriterModel()
    if (!fallback || fallback === model) throw error
    const fallbackRes = await chatRaw(fallback, messages, agent.id === 'producer' ? 0.7 : 0.9, false, `room-${agent.id}-fallback`)
    fallbackRes.thinkBlock = [
      `Primary room model ${model} failed: ${error instanceof Error ? error.message : String(error)}`,
      `Retried with ${fallback}.`,
      fallbackRes.thinkBlock,
    ].filter(Boolean).join('\n\n')
    res = fallbackRes
  }
  let text = res.text
  let thinkBlock = res.thinkBlock

  // Resolve one search round if requested.
  const searchMatch = text.match(/^\[SEARCH\]\s*(.+)$/m)
  if (searchMatch) {
    pushMessage(sender, { agentId: agent.id, name: agent.name, emoji: agent.emoji, kind: 'status', content: `🔎 searching: ${searchMatch[1].trim()}` })
    const results = await webSearch(searchMatch[1].trim())
    messages = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: `Web search results for "${searchMatch[1].trim()}":\n${results}\n\nNow give your final reply to the room (no [SEARCH] this time).` },
    ]
    res = await chatRaw(model, messages, 0.8, false, `room-${agent.id}-after-search`)
    text = res.text
    if (res.thinkBlock) {
      thinkBlock = (thinkBlock ? thinkBlock + '\n\n' : '') + res.thinkBlock
    }
  }

  // Extract directives.
  let final: string | null = null
  const finalIdx = text.indexOf('[FINAL]')
  if (finalIdx >= 0 && agent.id === 'producer') {
    final = text.slice(finalIdx + 7).trim()
    text = text.slice(0, finalIdx).trim()
  }

  const spawnRegex = /^\[SPAWN\]\s*(\{.*\})\s*$/gm
  let spawnMatch: RegExpExecArray | null
  while ((spawnMatch = spawnRegex.exec(text)) !== null && agent.id === 'producer') {
    if ((session.agents.length) >= MAX_AGENTS + 1) break
    try {
      const spec = JSON.parse(spawnMatch[1]) as { name?: string; emoji?: string; specialty?: string; briefing?: string }
      if (!spec.name) continue
      const newAgent: RoomAgent = {
        id: `agent-${crypto.randomUUID().slice(0, 8)}`,
        name: spec.name,
        emoji: spec.emoji || '🎵',
        specialty: spec.specialty || 'songwriting',
        persona: `You are ${spec.name}, a specialist in ${spec.specialty || 'songwriting'}. ${spec.briefing || ''} You speak with the confidence of deep experience and concrete craft knowledge.`,
        model: session.model,
        role: 'specialist',
      }
      session.agents.push(newAgent)
      pushMessage(sender, { agentId: 'room', name: 'Room', emoji: '✨', kind: 'status', content: `${newAgent.emoji} ${newAgent.name} joined the room — ${newAgent.specialty}` })
      try { sender.send('room:agents', session.agents) } catch { /* ignore */ }
    } catch { /* malformed spawn json - skip */ }
  }
  text = text.replace(/^\[SPAWN\][^\n]*$/gm, '').replace(/^\[SEARCH\][^\n]*$/gm, '').trim()

  const waitUser = /\?\s*$/.test(text) || /what do you think|your call|let me know|sound good/i.test(text.slice(-160))
  try { sender.send('room:typing', null) } catch { /* window gone */ }
  return { text, waitUser, final, thinkBlock }
}

export function startRoom(input: { idea: string; tags: string[]; lyrics: string; caption: string; model?: string; intent?: SongIntent }): Promise<RoomState> {
  return (async () => {
    const model = await pickRoomModel(input.model)
    if (!model) throw new Error('No Ollama model available - the Writers Room needs a local chat model')
    const producer: RoomAgent = {
      id: 'producer',
      name: 'The Producer',
      emoji: 'Mixer',
      specialty: 'running the room',
      persona: 'You are The Producer - a sharp, warm, experienced music producer chairing a songwriting session. You serve the user (the artist): their taste wins. You push for concrete, vivid, original lyrics and hate cliches.',
      model,
      role: 'coordinator',
    }
    const aceAgent: RoomAgent = {
      id: 'ace-engine',
      name: 'ACE Lyric Engine',
      emoji: 'ACE',
      specialty: 'local blueprint, lyric, BPM, key and caption ideas',
      persona: 'You are the local ACE-Step music engine perspective. You contribute engine-native captions, rough lyric material, BPM, key, and arrangement hints.',
      model: 'ACE-Step /v1/create_sample',
      role: 'engine',
    }
    const topicGuard: RoomAgent = {
      id: 'topic-guard',
      name: 'Topic Guard',
      emoji: '🎯',
      specialty: 'prompt adherence and off-topic drift',
      persona: 'You are Topic Guard. Your job is to keep every lyric tied to the user idea and reject unrelated imagery. Be direct, brief, and concrete.',
      model,
      role: 'specialist',
    }
    const structureEditor: RoomAgent = {
      id: 'structure-editor',
      name: 'Structure Editor',
      emoji: '🧱',
      specialty: 'song sections, outro, and singable shape',
      persona: 'You are Structure Editor. You check verse/chorus/bridge/outro shape and pitch concise fixes that make the song complete.',
      model,
      role: 'specialist',
    }
    const hookWriter: RoomAgent = {
      id: 'hook-writer',
      name: 'Hook Writer',
      emoji: '🪝',
      specialty: 'chorus hooks and memorable phrasing',
      persona: 'You are Hook Writer. You pitch short, singable hook lines that are specific to the user idea and avoid generic uplift.',
      model,
      role: 'specialist',
    }
    session = {
      id: crypto.randomUUID(),
      model,
      agents: [producer, topicGuard, structureEditor, hookWriter, aceAgent],
      messages: [],
      tags: input.tags,
      lyrics: input.lyrics,
      caption: input.caption,
      intent: input.intent ?? null,
      context: [
        input.intent?.songTitle && `Title: ${input.intent.songTitle}`,
        input.idea && `Idea: ${input.idea}`,
        input.intent?.rawIdea && input.intent.rawIdea !== input.idea ? `Raw user idea: ${input.intent.rawIdea}` : '',
        input.intent?.styleCaption && `Production style only: ${input.intent.styleCaption}`,
        input.tags.length ? `Style tags: ${input.tags.join(', ')}` : '',
        input.caption && `Engine caption: ${input.caption}`,
        input.intent && `Target: ${input.intent.vocalMode}, ${input.intent.language}, ${input.intent.durationMode} ${input.intent.durationMin}-${input.intent.durationMax}s`,
        input.intent?.structure?.length ? `Required structure: ${input.intent.structure.join(' -> ')} plus complete vocal-song sections and outro.` : '',
        input.lyrics && `Current working lyrics:\n${input.lyrics}`,
      ].filter(Boolean).join('\n'),
      busy: false,
    }
    return { id: session.id, model, agents: session.agents, messages: session.messages }
  })()
}

export async function sendToRoom(sender: WebContents, userText: string): Promise<RoomState> {
  if (!session) throw new Error('No active room - open the Writers’ Room first')
  if (session.busy) throw new Error('The room is still talking - wait for them to finish')
  session.busy = true
  try {
    pushMessage(sender, { agentId: 'user', name: 'You', emoji: '🎤', kind: 'chat', content: userText })

    if (/\b(?:yes|yeah|yep|use|apply)\b.*\b(?:lyrics|those|that|it)\b/i.test(userText)) {
      const latestLyrics = [...session.messages]
        .reverse()
        .find((m) => m.agentId !== 'user' && /\[(?:Verse|Chorus|Bridge|Outro|Final Chorus|Pre-Chorus|Intro)[^\]]*\]/i.test(m.content))
      if (latestLyrics) {
        pushMessage(sender, {
          agentId: 'producer',
          name: 'The Producer',
          emoji: '🎛️',
          kind: 'final',
          content: latestLyrics.content,
          thinking: 'The user asked to use the latest lyric block, so the room promoted it to an applyable final.',
        })
        return { id: session.id, model: session.model, agents: session.agents, messages: session.messages }
      }
    }

    let spoken = 0
    let final: string | null = null
    // Producer always reacts first; then specialists riff until someone hands
    // the floor back to the user or the round budget runs out.
    let queue = [session.agents[0], ...session.agents.slice(1)]
    for (const agent of queue) {
      if (spoken >= MAX_AGENT_MESSAGES_PER_ROUND) break
      const result = await speak(sender, agent)
      if (result.text) {
        pushMessage(sender, { agentId: agent.id, name: agent.name, emoji: agent.emoji, kind: 'chat', content: result.text, thinking: result.thinkBlock })
        spoken += 1
      }
      if (result.final) { final = result.final; break }
      if (agent.id === 'producer' && result.waitUser && session.agents.length === 1) break
      // Refresh queue if the producer spawned agents this round.
      if (agent.id === 'producer') queue = [agent, ...session.agents.slice(1)]
    }

    if (final) {
      pushMessage(sender, { agentId: 'producer', name: 'The Producer', emoji: '🎛️', kind: 'final', content: final })
    }
    return { id: session.id, model: session.model, agents: session.agents, messages: session.messages }
  } finally {
    session.busy = false
  }
}

export function endRoom(): void {
  session = null
}

