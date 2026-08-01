import { useRef, useEffect, useState, useCallback } from 'react'
import faceImg from './assets/mirana-face.jpg'

type AIState = 'idle' | 'speaking' | 'listening' | 'thinking'

// TODO: ganti dengan URL Edge Function kamu (dari tab Settings function di Supabase)
const MIRANA_CHAT_URL = 'https://cavouyzyasnuygkuwizy.supabase.co/functions/v1/mirana-chat'
// TODO: ganti dengan anon/publishable key project Supabase kamu (Settings > API)
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Particle {
  x: number; y: number       // posisi saat ini (dianimasikan)
  tx: number; ty: number     // posisi target dari hasil sampling gambar wajah
  r: number; g: number; b: number
  size: number; phase: number
  jitterAmp: number; jitterSpeed: number
  dirX: number; dirY: number // arah dari centroid wajah (untuk efek breathing)
  isMouth: boolean; isEye: boolean
}

// Zona wajah dikalibrasi manual terhadap src/assets/mirana-face.jpg
// (ubah nilai ini kalau ganti gambar sumber dengan proporsi wajah berbeda)
const MOUTH_Y: [number, number] = [0.655, 0.735]
const MOUTH_X: [number, number] = [0.36, 0.64]
const EYES_Y: [number, number] = [0.42, 0.51]
const EYES_X: [number, number] = [0.20, 0.80]
const BRIGHTNESS_THRESHOLD = 30

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const sizeRef = useRef({ W: 0, H: 0 })
  const stateRef = useRef<AIState>('idle')
  const micRef = useRef(false)
  const thinkTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const speakPulseRef = useRef(0) // 0-1, decays each frame; spikes on each spoken word ("mimik")
  const recognitionRef = useRef<any>(null)
  const centroidRef = useRef({ x: 0, y: 0 })

  const [aiState, setAiState] = useState<AIState>('idle')
  const [input, setInput] = useState('')
  const [micActive, setMicActive] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)

  const changeAIState = useCallback((newState: AIState) => {
    thinkTimers.current.forEach(clearTimeout)
    thinkTimers.current = []
    stateRef.current = newState
    setAiState(newState)

    // Auto-transisi demo: kalau dibiarkan di 'thinking' (mis. klik tombol demo),
    // otomatis lanjut ke 'speaking' setelah 3 detik.
    if (newState === 'thinking') {
      const t = setTimeout(() => { stateRef.current = 'speaking'; setAiState('speaking') }, 3000)
      thinkTimers.current = [t]
    }
  }, [])

  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { resolve(); return }

      window.speechSynthesis.cancel() // stop any previous utterance
      const utter = new SpeechSynthesisUtterance(text)

      const voices = window.speechSynthesis.getVoices()
      const idVoice = voices.find(v => v.lang?.toLowerCase().startsWith('id'))
      if (idVoice) utter.voice = idVoice
      utter.lang = idVoice ? idVoice.lang : 'id-ID'
      utter.rate = 1.02
      utter.pitch = 1.05

      // "Mimik": tiap batas kata, picu pulse yang dibaca canvas loop untuk gerak mulut/mata
      utter.onboundary = () => { speakPulseRef.current = 1 }
      utter.onend = () => { speakPulseRef.current = 0; resolve() }
      utter.onerror = () => { speakPulseRef.current = 0; resolve() }

      window.speechSynthesis.speak(utter)
    })
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isSending) return

    const userMsg: ChatMessage = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsSending(true)
    changeAIState('thinking')

    try {
      const res = await fetch(MIRANA_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          message: userMsg.content,
          history: messages, // history sebelum pesan baru ini
        }),
      })

      if (!res.ok) throw new Error(`Request failed: ${res.status}`)

      const data = await res.json()
      const reply: string = data.reply ?? 'Maaf, aku tidak bisa menjawab sekarang.'

      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      changeAIState('speaking')

      await speakText(reply) // menunggu sampai Mirana selesai bicara

      stateRef.current = 'idle'
      setAiState('idle')
    } catch (err) {
      console.error('sendMessage error:', err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, terjadi kesalahan menghubungi server. Coba lagi.' }])
      changeAIState('idle')
    } finally {
      setIsSending(false)
    }
  }, [messages, isSending, changeAIState, speakText])

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Browser ini belum mendukung input suara. Coba pakai Chrome atau Edge.')
      return
    }

    const recognition = new SR()
    recognition.lang = 'id-ID'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition

    setMicActive(true)
    micRef.current = true
    changeAIState('listening')

    recognition.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript
      if (transcript) sendMessage(transcript)
    }
    recognition.onerror = () => {
      setMicActive(false)
      micRef.current = false
      changeAIState('idle')
    }
    recognition.onend = () => {
      setMicActive(false)
      micRef.current = false
    }

    recognition.start()
  }, [changeAIState, sendMessage])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
    setMicActive(false)
    micRef.current = false
    changeAIState('idle')
  }, [changeAIState])

  useEffect(() => { micRef.current = micActive }, [micActive])

  // ---- Canvas: wajah partikel dari gambar, reaktif ke aiState + suara ----
  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const canvas = canvasEl as HTMLCanvasElement

    const ctxRaw = canvas.getContext('2d')
    if (!ctxRaw) return
    const ctx = ctxRaw as CanvasRenderingContext2D

    const img = new Image()
    let imgLoaded = false

    function buildParticles(W: number, H: number) {
      if (!imgLoaded || !W || !H) return
      const mobile = W < 768
      const targetH = Math.floor(Math.min(H * 0.86, 780))
      const scale = targetH / img.naturalHeight
      const targetW = Math.floor(img.naturalWidth * scale)

      const off = document.createElement('canvas')
      off.width = targetW
      off.height = targetH
      const octx = off.getContext('2d')
      if (!octx) return
      octx.drawImage(img, 0, 0, targetW, targetH)

      let data: Uint8ClampedArray
      try { data = octx.getImageData(0, 0, targetW, targetH).data }
      catch { return }

      const offsetX = Math.floor(mobile ? (W - targetW) / 2 : W * 0.62 - targetW / 2)
      const offsetY = Math.floor(H * (mobile ? 0.4 : 0.5) - targetH / 2)
      const step = mobile ? 6 : 4

      const ps: Particle[] = []
      let sumX = 0, sumY = 0

      for (let y = 0; y < targetH; y += step) {
        for (let x = 0; x < targetW; x += step) {
          const idx = (y * targetW + x) * 4
          const r = data[idx], g = data[idx + 1], b = data[idx + 2]
          if (r === undefined) continue
          const brightness = (r + g + b) / 3
          if (brightness < BRIGHTNESS_THRESHOLD) continue

          const ry = y / targetH, rx = x / targetW
          const isMouth = ry >= MOUTH_Y[0] && ry <= MOUTH_Y[1] && rx >= MOUTH_X[0] && rx <= MOUTH_X[1]
          const isEye = ry >= EYES_Y[0] && ry <= EYES_Y[1] && rx >= EYES_X[0] && rx <= EYES_X[1]

          const tx = offsetX + x, ty = offsetY + y
          sumX += tx; sumY += ty

          ps.push({
            x: Math.random() * W, y: Math.random() * H,
            tx, ty, r, g, b,
            size: 1.1 * (0.6 + (brightness / 255) * 0.8),
            phase: Math.random() * Math.PI * 2,
            jitterAmp: 0.9 + Math.random() * 1.6,
            jitterSpeed: 0.8 + Math.random() * 0.9,
            dirX: 0, dirY: 0,
            isMouth, isEye,
          })
        }
      }

      const cx = sumX / (ps.length || 1), cy = sumY / (ps.length || 1)
      ps.forEach(p => {
        const dx = p.tx - cx, dy = p.ty - cy
        const len = Math.hypot(dx, dy) || 1
        p.dirX = dx / len
        p.dirY = dy / len
      })
      centroidRef.current = { x: cx, y: cy }
      particlesRef.current = ps
    }

    function resize() {
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      const dpr = window.devicePixelRatio || 1
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)
      sizeRef.current = { W, H }
      buildParticles(W, H)
    }

    img.onload = () => { imgLoaded = true; resize() }
    img.src = faceImg

    let raf = 0
    let t = 0

    function loop() {
      raf = requestAnimationFrame(loop)
      t += 0.016

      const { W, H } = sizeRef.current
      const ps = particlesRef.current
      if (!W || !H) return

      ctx.clearRect(0, 0, W, H)
      if (!ps.length) return

      const st = stateRef.current
      const { x: cx, y: cy } = centroidRef.current

      // Central glow, warna berubah sesuai state
      const glowColor = st === 'thinking' ? '140,80,255' : st === 'listening' ? '0,210,255' : '0,175,255'
      const glowA = st === 'idle' ? 0.08 : st === 'thinking' ? 0.10 + Math.sin(t * 3.2) * 0.03 : 0.14
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.55)
      grd.addColorStop(0, `rgba(${glowColor},${glowA})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, W, H)

      // Decay pulse "mimik" dari speech word boundary
      speakPulseRef.current *= 0.9
      const rhythmicMouth = st === 'speaking' ? (Math.sin(t * 9) * 0.5 + 0.5) * 0.7 : 0
      const mouthDrive = Math.max(speakPulseRef.current, rhythmicMouth)
      const eyeDrive = st === 'speaking'
        ? Math.max(speakPulseRef.current, 0.25 + Math.sin(t * 3) * 0.15)
        : speakPulseRef.current

      // Thinking: partikel bergetar lebih cepat (kesan "memproses")
      const thinkBoost = st === 'thinking' ? 1.7 : 1
      const breathe = Math.sin(t * 0.55) * 1.4

      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.x += (p.tx - p.x) * 0.08
        p.y += (p.ty - p.y) * 0.08

        let jx = Math.sin(t * p.jitterSpeed * thinkBoost + p.phase) * p.jitterAmp + p.dirX * breathe
        let jy = Math.cos(t * p.jitterSpeed * 0.9 * thinkBoost + p.phase) * p.jitterAmp + p.dirY * breathe
        let size = p.size
        let alpha = 0.9

        if (p.isMouth) {
          jy += mouthDrive * Math.sin(t * 14 + p.phase) * 5
          size *= 1 + mouthDrive * 0.6
          alpha = Math.min(1, alpha + mouthDrive * 0.3)
        }
        if (p.isEye) {
          size *= 1 + eyeDrive * 0.7
          alpha = Math.min(1, alpha + eyeDrive * 0.4)
        }
        if (st === 'listening') {
          alpha = Math.min(1, alpha + 0.08 + Math.sin(t * 2 + p.phase) * 0.05)
        }

        ctx.beginPath()
        ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`
        ctx.arc(p.x + jx, p.y + jy, size, 0, Math.PI * 2)
        ctx.fill()

        if (p.isEye && eyeDrive > 0.1) {
          const bloom = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 6)
          bloom.addColorStop(0, `rgba(${p.r},${p.g},${p.b},${eyeDrive * 0.5})`)
          bloom.addColorStop(1, 'transparent')
          ctx.fillStyle = bloom
          ctx.beginPath()
          ctx.arc(p.x, p.y, size * 6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalCompositeOperation = 'source-over'

      // Listening: cincin gelombang suara menyebar dari wajah
      if (st === 'listening') {
        const numWaves = micRef.current ? 5 : 3
        for (let w = 0; w < numWaves; w++) {
          const progress = ((t * 0.68 + w / numWaves) % 1)
          const r = progress * Math.max(W, H) * 0.42
          const wa = (1 - progress) * 0.35
          ctx.strokeStyle = `rgba(0,215,255,${wa})`
          ctx.lineWidth = 1 + (1 - progress) * 0.8
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Thinking: kilatan ungu acak di antara partikel wajah
      if (st === 'thinking') {
        for (let f = 0; f < 6; f++) {
          const flashT = ((t * 1.1 + f * 0.167) % 1)
          if (flashT > 0.35) continue
          const idx = Math.floor((f * 53 + Math.floor(t * 2)) % ps.length)
          const p = ps[idx]
          const fa = (1 - flashT / 0.35) * 0.7
          const fGrd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14)
          fGrd.addColorStop(0, `rgba(160,80,255,${fa})`)
          fGrd.addColorStop(1, 'transparent')
          ctx.fillStyle = fGrd
          ctx.beginPath()
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      thinkTimers.current.forEach(clearTimeout)
    }
  }, [])


  const navLinks = ['Home', 'Features', 'Pricing', 'Documentation', 'About']

  const features = [
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
        </svg>
      ),
      title: 'Real-time Reasoning',
      desc: 'Processes complex multi-step queries in under 100ms with advanced neural architecture and distributed inference engines.',
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
      title: 'Natural Conversation',
      desc: "Understands context, nuance, and intent with human-like depth. Remembers everything you've discussed across sessions.",
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
      ),
      title: 'Emotional Intelligence',
      desc: 'Adapts tone, pace, and communication style to your mood. Every interaction feels personal, never robotic.',
    },
    {
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      title: 'Always Available',
      desc: '24/7 intelligent assistance with zero downtime. Mirana is always present, always responsive, always ready to help.',
    },
  ]

  const stats = [
    { value: '99.9%', label: 'Uptime SLA' },
    { value: '<80ms', label: 'Response Time' },
    { value: '40+', label: 'Languages' },
    { value: '2M+', label: 'Active Users' },
  ]

  return (
    <div style={{ fontFamily: '"Inter", system-ui, sans-serif' }} className="min-h-screen bg-[#020408] text-white overflow-x-hidden">

      {/* ── NAV ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-4"
        style={{
          backdropFilter: 'blur(24px)',
          background: 'rgba(2,4,8,0.78)',
          borderBottom: '1px solid rgba(0,210,255,0.07)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg,#00D4FF,#7B61FF)', boxShadow: '0 0 20px rgba(0,212,255,0.4)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3.5" fill="white"/>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="white" strokeWidth="1.2" fill="none" opacity="0.45"/>
              <path d="M12 5v1.5M12 17.5V19M5 12H3.5M20.5 12H19M7.4 7.4L6.34 6.34M17.66 17.66l-1.06-1.06M7.4 16.6l-1.06 1.06M17.66 6.34l-1.06 1.06" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ fontFamily: '"Exo 2",sans-serif' }} className="font-bold text-lg tracking-tight">
            Mirana <span style={{ color: '#00D4FF' }}>AI</span>
          </span>
        </div>

        <div className="hidden md:flex items-center gap-8">
          {navLinks.map(item => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-sm font-medium transition-colors duration-200"
              style={{ color: '#7A96AA' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#7A96AA' }}
            >
              {item}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <button
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors duration-200"
            style={{ color: '#7A96AA' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#7A96AA' }}
          >
            Sign In
          </button>
          <button
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg,#00D4FF,#00AACC)',
              color: '#020408',
              boxShadow: '0 0 22px rgba(0,212,255,0.28)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 36px rgba(0,212,255,0.55)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 22px rgba(0,212,255,0.28)' }}
          >
            Get Started
          </button>
        </div>

        <button className="md:hidden p-1" onClick={() => setNavOpen(o => !o)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {navOpen
              ? <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>
              : <><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></>}
          </svg>
        </button>
      </nav>

      {navOpen && (
        <div
          className="fixed top-[65px] left-0 right-0 z-40 px-6 py-5 flex flex-col gap-5"
          style={{ background: 'rgba(2,4,10,0.97)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,210,255,0.08)' }}
        >
          {navLinks.map(item => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-white text-base font-medium"
              onClick={() => setNavOpen(false)}
            >
              {item}
            </a>
          ))}
          <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'rgba(0,210,255,0.1)' }}>
            <button className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#7A96AA' }}>Sign In</button>
            <button className="flex-1 py-2.5 rounded-lg text-sm font-semibold" style={{ background: 'linear-gradient(135deg,#00D4FF,#00AACC)', color: '#020408' }}>Get Started</button>
          </div>
        </div>
      )}

      {/* ── HERO ── */}
      <section id="home" className="relative min-h-screen flex flex-col overflow-hidden">

        {/* Subtle grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,190,255,0.022) 1px, transparent 1px), linear-gradient(90deg, rgba(0,190,255,0.022) 1px, transparent 1px)',
            backgroundSize: '65px 65px',
          }}
        />

        {/* Edge vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, transparent 35%, rgba(2,4,8,0.7) 100%)' }}
        />

        {/* Canvas hologram */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

        {/* Bottom fade */}
        <div
          className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #020408)' }}
        />

        {/* Content layer */}
        <div className="relative z-10 flex-1 flex flex-col pt-20">
          <div className="flex-1 flex items-center">

            {/* Text panel — left on desktop, centered on mobile */}
            <div className="px-6 md:px-16 lg:px-24 w-full md:max-w-[48%]">

              {/* Badge */}
              <div
                className="inline-flex items-center gap-2.5 mb-7 px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-[0.15em] uppercase"
                style={{ border: '1px solid rgba(0,212,255,0.32)', background: 'rgba(0,212,255,0.055)', color: '#00D4FF' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
                  style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
                />
                Next-Generation Intelligence
              </div>

              {/* Headline */}
              <h1
                style={{ fontFamily: '"Exo 2",sans-serif' }}
                className="font-bold leading-none tracking-tight mb-5"
              >
                <span className="block text-5xl md:text-[4.2rem] lg:text-[5rem] text-white mb-1">Mirana AI</span>
                <span
                  className="block text-3xl md:text-4xl lg:text-[2.8rem] font-light leading-tight"
                  style={{ color: 'transparent', backgroundImage: 'linear-gradient(90deg,#00D4FF,#7B61FF)', WebkitBackgroundClip: 'text', backgroundClip: 'text' }}
                >
                  Your Intelligent
                </span>
                <span className="block text-3xl md:text-4xl lg:text-[2.8rem] font-semibold text-white leading-tight">
                  Digital Partner
                </span>
              </h1>

              {/* Subhead */}
              <p className="text-base md:text-lg font-light leading-relaxed mb-8" style={{ color: '#6E8EA4' }}>
                Natural conversations.<br/>
                Real-time reasoning.<br/>
                Always ready to help.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={() => changeAIState('speaking')}
                  className="px-7 py-3.5 rounded-xl text-sm font-semibold transition-all duration-200"
                  style={{ background: 'linear-gradient(135deg,#00D4FF,#00AACC)', color: '#020408', boxShadow: '0 0 32px rgba(0,212,255,0.32)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 52px rgba(0,212,255,0.6)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(0,212,255,0.32)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
                >
                  Start Chatting
                </button>
                <button
                  onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                  className="px-7 py-3.5 rounded-xl text-sm font-medium transition-all duration-200"
                  style={{ border: '1px solid rgba(0,212,255,0.25)', color: '#00D4FF', background: 'rgba(0,212,255,0.04)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,212,255,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,255,0.5)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,212,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,255,0.25)' }}
                >
                  Explore Features
                </button>
              </div>
            </div>
          </div>

          {/* AI state switcher */}
          <div className="flex items-center justify-center gap-2 py-3">
            {(['idle', 'speaking', 'listening', 'thinking'] as AIState[]).map(s => (
              <button
                key={s}
                onClick={() => changeAIState(s)}
                className="px-3.5 py-1 rounded-full text-xs capitalize font-medium transition-all duration-200"
                style={{
                  border: aiState === s ? '1px solid rgba(0,212,255,0.5)' : '1px solid rgba(255,255,255,0.08)',
                  background: aiState === s ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.02)',
                  color: aiState === s ? '#00D4FF' : 'rgba(255,255,255,0.28)',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* ── CHAT TRANSCRIPT ── */}
          {messages.length > 0 && (
            <div className="px-6 md:px-16 pb-4">
              <div className="max-w-2xl mx-auto max-h-72 overflow-y-auto flex flex-col gap-3 py-2">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className="px-4 py-2.5 rounded-xl text-sm leading-relaxed max-w-[85%]"
                    style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      background: m.role === 'user' ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.04)',
                      border: m.role === 'user' ? '1px solid rgba(0,212,255,0.25)' : '1px solid rgba(255,255,255,0.06)',
                      color: m.role === 'user' ? '#E6FBFF' : '#B8CDD8',
                    }}
                  >
                    {m.content}
                  </div>
                ))}
                {isSending && (
                  <div
                    className="px-4 py-2.5 rounded-xl text-sm"
                    style={{ alignSelf: 'flex-start', color: '#5A7A8E' }}
                  >
                    Mirana sedang mengetik…
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CHAT INPUT ── */}
          <div className="px-6 md:px-16 pb-10">
            <div className="max-w-2xl mx-auto">
              <div
                className="flex items-center gap-3 px-5 py-3.5 rounded-2xl transition-all duration-300"
                style={{
                  border: `1px solid ${input || micActive ? 'rgba(0,212,255,0.3)' : 'rgba(0,212,255,0.14)'}`,
                  background: 'rgba(2,4,10,0.88)',
                  backdropFilter: 'blur(28px)',
                  boxShadow: input || micActive ? '0 0 48px rgba(0,212,255,0.13), inset 0 0 24px rgba(0,212,255,0.03)' : '0 4px 24px rgba(0,0,0,0.5)',
                }}
              >
                {/* State dot */}
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0 transition-all duration-500"
                  style={{
                    background: aiState === 'idle' ? '#2A3C4A' : aiState === 'thinking' ? '#7B61FF' : '#00D4FF',
                    boxShadow: aiState !== 'idle' ? `0 0 8px ${aiState === 'thinking' ? '#7B61FF' : '#00D4FF'}` : 'none',
                    animation: aiState !== 'idle' ? 'pulse-glow 1.5s ease-in-out infinite' : 'none',
                  }}
                />

                <input
                  type="text"
                  value={input}
                  onChange={e => {
                    setInput(e.target.value)
                    changeAIState(e.target.value ? 'speaking' : micActive ? 'listening' : 'idle')
                  }}
                  onFocus={() => changeAIState(input ? 'speaking' : 'listening')}
                  onBlur={() => { if (!input && !micActive) changeAIState('idle') }}
                  onKeyDown={e => { if (e.key === 'Enter' && input.trim()) sendMessage(input) }}
                  placeholder="Ask Mirana anything..."
                  className="flex-1 bg-transparent outline-none text-sm text-white"
                  disabled={isSending}
                />

                {/* Mic */}
                <button
                  onClick={() => { micActive ? stopListening() : startListening() }}
                  disabled={isSending}
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 relative transition-all duration-200"
                  style={{
                    background: micActive ? 'rgba(0,212,255,0.15)' : 'transparent',
                    color: micActive ? '#00D4FF' : '#3A5060',
                    border: micActive ? '1px solid rgba(0,212,255,0.38)' : '1px solid transparent',
                  }}
                >
                  {micActive && (
                    <span
                      className="absolute inset-0 rounded-full border border-[#00D4FF]"
                      style={{ animation: 'ping-slow 1.4s ease-out infinite', opacity: 0.4 }}
                    />
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </button>

                {/* Send */}
                <button
                  onClick={() => { if (input.trim()) sendMessage(input) }}
                  disabled={isSending}
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200"
                  style={{
                    background: input ? 'linear-gradient(135deg,#00D4FF,#00AACC)' : 'rgba(255,255,255,0.05)',
                    color: input ? '#020408' : '#3A5060',
                    boxShadow: input ? '0 0 14px rgba(0,212,255,0.35)' : 'none',
                    opacity: isSending ? 0.5 : 1,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>

              <p className="text-center text-xs mt-2.5" style={{ color: '#1E2E3A' }}>
                Mirana AI · Real-time intelligence at your fingertips
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="relative py-24 px-6 md:px-16">
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg,transparent,rgba(0,212,255,0.35),transparent)' }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.04) 0%, transparent 70%)', transform: 'translate(-50%, -40%)' }}
        />

        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div
              className="inline-flex items-center gap-2 mb-5 px-3.5 py-1 rounded-full text-xs font-semibold tracking-[0.15em] uppercase"
              style={{ border: '1px solid rgba(0,212,255,0.2)', color: '#00D4FF', background: 'rgba(0,212,255,0.04)' }}
            >
              Capabilities
            </div>
            <h2
              style={{ fontFamily: '"Exo 2",sans-serif' }}
              className="text-3xl md:text-4xl lg:text-[2.8rem] font-bold text-white mb-4 tracking-tight"
            >
              Intelligence, Redefined
            </h2>
            <p className="text-base max-w-md mx-auto font-light leading-relaxed" style={{ color: '#5A7A8E' }}>
              Mirana combines cutting-edge language models with real-time processing to deliver an unparalleled conversational experience.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl transition-all duration-300 cursor-default"
                style={{ border: '1px solid rgba(0,212,255,0.09)', background: 'rgba(0,212,255,0.018)' }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'rgba(0,212,255,0.28)'
                  el.style.background = 'rgba(0,212,255,0.05)'
                  el.style.boxShadow = '0 0 32px rgba(0,212,255,0.08), 0 0 0 0 transparent'
                  el.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement
                  el.style.borderColor = 'rgba(0,212,255,0.09)'
                  el.style.background = 'rgba(0,212,255,0.018)'
                  el.style.boxShadow = 'none'
                  el.style.transform = 'translateY(0)'
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.14)', color: '#00D4FF' }}
                >
                  {f.icon}
                </div>
                <h3 style={{ fontFamily: '"Exo 2",sans-serif' }} className="text-sm font-semibold text-white mb-2 tracking-wide">
                  {f.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#4E6A7C' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="py-16 px-6 md:px-16 relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(0,212,255,0.018), transparent)' }}
        />
        <div className="max-w-4xl mx-auto relative">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={i} className="text-center">
                <div
                  style={{ fontFamily: '"Exo 2",sans-serif', color: '#00D4FF' }}
                  className="text-3xl md:text-4xl font-bold mb-1.5 tracking-tight"
                >
                  {stat.value}
                </div>
                <div className="text-xs font-light tracking-widest uppercase" style={{ color: '#3A5465' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section id="pricing" className="py-28 px-6 md:px-16 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at center, rgba(0,212,255,0.055) 0%, transparent 68%)' }}
        />
        {/* Decorative rings */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ border: '1px solid rgba(0,212,255,0.06)' }}
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none"
          style={{ border: '1px solid rgba(0,212,255,0.08)' }}
        />

        <div className="max-w-2xl mx-auto text-center relative">
          <div
            className="inline-flex items-center gap-2 mb-6 px-3.5 py-1 rounded-full text-xs font-semibold tracking-[0.15em] uppercase"
            style={{ border: '1px solid rgba(0,212,255,0.2)', color: '#00D4FF', background: 'rgba(0,212,255,0.04)' }}
          >
            Get Started
          </div>
          <h2
            style={{ fontFamily: '"Exo 2",sans-serif' }}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-5 tracking-tight"
          >
            Meet Mirana Today
          </h2>
          <p className="text-base font-light mb-10 leading-relaxed" style={{ color: '#5A7A8E' }}>
            Experience the next generation of AI assistance.<br/>
            No credit card required.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => changeAIState('speaking')}
              className="px-8 py-4 rounded-xl text-base font-semibold transition-all duration-200"
              style={{ background: 'linear-gradient(135deg,#00D4FF,#00AACC)', color: '#020408', boxShadow: '0 0 44px rgba(0,212,255,0.38)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 70px rgba(0,212,255,0.65)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 44px rgba(0,212,255,0.38)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(0)' }}
            >
              Start Chatting — Free
            </button>
            <button
              className="px-8 py-4 rounded-xl text-base font-medium transition-all duration-200"
              style={{ border: '1px solid rgba(0,212,255,0.22)', color: '#00D4FF', background: 'rgba(0,212,255,0.04)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,212,255,0.09)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,255,0.45)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,212,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,212,255,0.22)' }}
            >
              View Pricing
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer
        id="about"
        className="py-10 px-6 md:px-16"
        style={{ borderTop: '1px solid rgba(0,212,255,0.06)' }}
      >
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2.5">
            <div
              className="w-5 h-5 rounded flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#00D4FF,#7B61FF)' }}
            >
              <div className="w-2 h-2 rounded-full bg-white" />
            </div>
            <span style={{ fontFamily: '"Exo 2",sans-serif', color: '#3A5465' }} className="text-sm font-semibold">
              Mirana AI
            </span>
          </div>

          <p className="text-xs order-last md:order-none" style={{ color: '#1E2E3A' }}>
            © 2025 Mirana AI. All rights reserved.
          </p>

          <div className="flex items-center gap-6">
            {['Privacy', 'Terms', 'Contact', 'Documentation'].map(l => (
              <a
                key={l}
                href="#"
                className="text-xs transition-colors duration-200"
                style={{ color: '#1E2E3A' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00D4FF' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#1E2E3A' }}
              >
                {l}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  )
}
