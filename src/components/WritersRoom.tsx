import { useEffect, useRef, useState } from 'react'
import { Check, Minus, Send, Users, X } from 'lucide-react'
import { useRoomStore } from '../stores/roomStore'

const QUICK_COMMANDS = [
  { label: 'Rhyme/Flow', prompt: 'Run a strict rhyme and flow check on the current lyrics. Quote weak lines and give fixes.' },
  { label: 'Hook', prompt: 'Rewrite the chorus with a stronger hook. Keep it singable and remove cheesy lines.' },
  { label: 'Clean', prompt: 'Remove all screenplay, stage direction, camera, phone, crowd, and narration lines. Return only sung lyrics.' },
  { label: 'Singable', prompt: 'Make these lyrics more singable: smoother meter, cleaner phrasing, and stronger section structure.' },
]

export function WritersRoom() {
  const { open, minimized, busy, agents, messages, error, send, applyFinal, closeRoom, minimizeRoom, restoreRoom, receiveMessage, receiveAgents, activeAgent, receiveTyping } = useRoomStore()
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offMessage = window.doReMi.onRoomMessage(receiveMessage)
    const offAgents = window.doReMi.onRoomAgents(receiveAgents)
    const offTyping = window.doReMi.onRoomTyping(receiveTyping)
    return () => { offMessage(); offAgents(); offTyping() }
  }, [receiveMessage, receiveAgents, receiveTyping])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, busy])

  if (!open) return null
  if (minimized) {
    return (
      <button className={`room-minimized ${busy ? 'busy' : ''}`} onClick={restoreRoom}>
        <Users size={16} />
        <span>{busy && activeAgent ? `${activeAgent.name} thinking` : 'Writers Room'}</span>
        <small>{agents.length} voices</small>
      </button>
    )
  }

  function handleSend() {
    const text = input.trim()
    if (!text) return
    setInput('')
    void send(text)
  }

  function sendQuick(prompt: string) {
    setInput('')
    void send(prompt)
  }

  function looksLikeLyrics(text: string) {
    return /\[(?:Verse|Chorus|Bridge|Outro|Final Chorus|Pre-Chorus|Intro)[^\]]*\]/i.test(text)
  }

  return (
    <>
      <aside className="writers-room" role="dialog" aria-label="The Writers' Room">
        <header className="room-head">
          <div className="room-title">
            <Users size={18} />
            <div>
              <strong>The Writers&rsquo; Room</strong>
              <small>Co-write with a producer and the specialists they bring in</small>
            </div>
          </div>
          <div className="room-roster">
            {agents.map((agent) => (
              <span className="roster-chip" key={agent.id} title={`${agent.specialty}\n\nPersona: ${agent.persona}`}>{agent.emoji} {agent.name}</span>
            ))}
          </div>
          <button className="ghost-btn close" onClick={minimizeRoom} title="Minimize and keep the room thinking"><Minus size={16} /> Minimize</button>
          <button className="ghost-btn close" onClick={() => void closeRoom()} title="End session and return to the Studio"><X size={16} /> End Session</button>
        </header>

        <div className="room-scroll" ref={scrollRef}>
          {messages.map((msg) => msg.kind === 'status' ? (
            <div className="room-status" key={msg.id}>{msg.content}</div>
          ) : msg.kind === 'final' ? (
            <div className="room-final" key={msg.id}>
              <div className="room-final-head">🏁 Final lyrics from the room</div>
              <pre>{msg.content}</pre>
              <button className="generate-cta compact" onClick={() => applyFinal(msg.content)}><Check size={14} /> Use These Lyrics</button>
            </div>
          ) : (
            <div className={`room-msg ${msg.agentId === 'user' ? 'mine' : ''}`} key={msg.id}>
              <span className="room-msg-author">{msg.emoji} {msg.name}</span>
              {msg.thinking && (
                <details className="room-msg-thinking" style={{ fontSize: '0.8em', opacity: 0.8, marginBottom: '0.5rem', cursor: 'pointer' }}>
                  <summary>View thought process</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', marginTop: '0.5rem' }}>{msg.thinking}</pre>
                </details>
              )}
              <p>{msg.content}</p>
              {msg.agentId !== 'user' && looksLikeLyrics(msg.content) && (
                <div className="room-message-actions">
                  <button className="mini-action good" onClick={() => applyFinal(msg.content)}><Check size={14} /> Use As Full Lyrics</button>
                  <button className="mini-action" onClick={() => send(`Use this as the chorus seed, then write the full song with Verse 1, Chorus, Verse 2, Chorus, Bridge, Final Chorus, and Outro:\n\n${msg.content}`)}>Use As Chorus</button>
                  <button className="mini-action" onClick={() => send(`Critique these lyrics strictly for prompt match, rhyme, flow, structure, and missing outro:\n\n${msg.content}`)}>Send To Critic</button>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="room-status typing"><span className="eq-bars"><i /><i /><i /></span> {activeAgent ? `${activeAgent.name} is thinking…` : 'the room is talking…'}</div>
          )}
          {error && <div className="room-status error">{error}</div>}
        </div>

        <footer className="room-input-row">
          <div className="room-compose">
            <div className="room-quick-actions">
              {QUICK_COMMANDS.map((command) => (
                <button key={command.label} className="chip" onClick={() => sendQuick(command.prompt)} disabled={busy}>
                  {command.label}
                </button>
              ))}
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder={busy ? 'The room is talking - you can type while you wait...' : 'Talk to the room... (Enter to send, Shift+Enter for a new line)'}
            />
          </div>
          <button className="generate-cta compact" onClick={handleSend} disabled={busy || !input.trim()}>
            <Send size={15} /> Send
          </button>
        </footer>
      </aside>
    </>
  )
}
