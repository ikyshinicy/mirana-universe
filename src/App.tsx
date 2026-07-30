import { useRef, useEffect, useState, useCallback } from 'react'

type AIState = 'idle' | 'speaking' | 'listening' | 'thinking'

// TODO: ganti dengan URL Edge Function kamu (dari tab Settings function di Supabase)
const MIRANA_CHAT_URL = 'https://cavouyzyasnuygkuwizy.supabase.co/functions/v1/mirana-chat'
// TODO: ganti dengan anon/publishable key project Supabase kamu (Settings > API)
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const N = 320

// group sizes: head, eyes, neck, lshoulder, rshoulder, larm, rarm, chest, waist, energy
const GROUPS = [56, 10, 9, 18, 18, 28, 28, 44, 21, 88]

interface Particle {
  x: number; y: number
  vx: number; vy: number
  tx: number; ty: number
  size: number; alpha: number; phase: number
  group: number; hue: number
}

function ss(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

function bodyPos(g: number, cx: number, cy: number, s: number): [number, number] {
  const rn = () => (Math.random() - 0.5) * 2
  switch (g) {
    case 0: {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random())
      return [cx + Math.cos(a) * r * s * 0.22, cy - s * 1.22 + Math.sin(a) * r * s * 0.27]
    }
    case 1: {
      const w = Math.random()
      if (w < 0.38) return [cx - s * 0.1 + rn() * s * 0.02, cy - s * 1.26 + rn() * s * 0.014]
      if (w < 0.76) return [cx + s * 0.1 + rn() * s * 0.02, cy - s * 1.26 + rn() * s * 0.014]
      return [cx + rn() * s * 0.045, cy - s * 1.09 + rn() * s * 0.014]
    }
    case 2: return [cx + rn() * s * 0.055, cy - s * 0.95 + rn() * s * 0.08]
    case 3: { const u = Math.random(); return [cx - s * 0.22 - u * s * 0.44, cy - s * 0.8 + rn() * s * 0.04] }
    case 4: { const u = Math.random(); return [cx + s * 0.22 + u * s * 0.44, cy - s * 0.8 + rn() * s * 0.04] }
    case 5: { const u = Math.random(); return [cx - s * 0.6 - u * s * 0.14, cy - s * 0.78 + u * s * 0.85 + rn() * s * 0.038] }
    case 6: { const u = Math.random(); return [cx + s * 0.6 + u * s * 0.14, cy - s * 0.78 + u * s * 0.85 + rn() * s * 0.038] }
    case 7: { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); return [cx + Math.cos(a) * r * s * 0.24, cy - s * 0.5 + Math.sin(a) * r * s * 0.2] }
    case 8: return [cx + rn() * s * 0.17, cy - s * 0.13 + rn() * s * 0.1]
    default: { const a = Math.random() * Math.PI * 2, d = 0.85 + Math.random() * 1.0; return [cx + Math.cos(a) * s * d * 0.46, cy - s * 0.55 + Math.sin(a) * s * d * 0.52] }
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const sizeRef = useRef({ W: 0, H: 0 })
  const stateRef = useRef<AIState>('idle')
  const micRef = useRef(false)
  const thinkTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const idleTimer = useRef(0)

  const [aiState, setAiState] = useState<AIState>('idle')
  const [input, setInput] = useState('')
  const [micActive, setMicActive] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)

  const getCenter = useCallback(() => {
    const { W, H } = sizeRef.current
    const mobile = W < 768
    return {
      cx: mobile ? W * 0.5 : W * 0.64,
      cy: mobile ? H * 0.4 : H * 0.52,
      s: Math.min(W, H) * (mobile ? 0.27 : 0.28),
    }
  }, [])

  const assignIdleTargets = useCallback(() => {
    const { cx, cy, s } = getCenter()
    particlesRef.current.forEach(p => {
      const a = p.phase + Math.random() * 1.4
      const d = s * (0.15 + Math.random() * 1.2)
      p.tx = cx + Math.cos(a) * d * 0.74
      p.ty = cy - s * 0.52 + Math.sin(a) * d * 0.95
    })
  }, [getCenter])

  const assignBodyTargets = useCallback(() => {
    const { cx, cy, s } = getCenter()
    particlesRef.current.forEach(p => {
      const [tx, ty] = bodyPos(p.group, cx, cy, s)
      p.tx = tx; p.ty = ty
    })
  }, [getCenter])

  const assignListeningTargets = useCallback(() => {
    const { cx, cy, s } = getCenter()
    particlesRef.current.forEach(p => {
      if (p.group <= 2) {
        const [tx, ty] = bodyPos(p.group, cx, cy, s)
        p.tx = tx; p.ty = ty
      } else {
        const a = Math.random() * Math.PI * 2, d = Math.random() * s * 0.85
        p.tx = cx + Math.cos(a) * d
        p.ty = cy - s * 1.12 + Math.sin(a) * d * 0.65
      }
    })
  }, [getCenter])

  const assignScatterTargets = useCallback(() => {
    const { cx, cy } = getCenter()
    const { W, H } = sizeRef.current
    particlesRef.current.forEach(p => {
      const a = Math.random() * Math.PI * 2
      const d = Math.max(W, H) * (0.4 + Math.random() * 0.7)
      p.tx = cx + Math.cos(a) * d
      p.ty = cy + Math.sin(a) * d
    })
  }, [getCenter])

  const changeAIState = useCallback((newState: AIState) => {
    thinkTimers.current.forEach(clearTimeout)
    thinkTimers.current = []
    stateRef.current = newState
    setAiState(newState)

    if (newState === 'idle') {
      assignIdleTargets()
    } else if (newState === 'speaking') {
      assignBodyTargets()
    } else if (newState === 'listening') {
      assignListeningTargets()
    } else if (newState === 'thinking') {
      const t1 = setTimeout(() => assignScatterTargets(), 80)
      const t2 = setTimeout(() => assignBodyTargets(), 1500)
      const t3 = setTimeout(() => {
        stateRef.current = 'speaking'
        setAiState('speaking')
      }, 3000)
      thinkTimers.current = [t1, t2, t3]
    }
  }, [assignIdleTargets, assignBodyTargets, assignListeningTargets, assignScatterTargets])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isSending) return

    const userMsg: ChatMessage = { role: 'user', content: text.trim() }
    const nextHistory = [...messages, userMsg]
    setMessages(nextHistory)
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
      setTimeout(() => {
        stateRef.current = 'idle'
        setAiState('idle')
        assignIdleTargets()
      }, 2600)
    } catch (err) {
      console.error('sendMessage error:', err)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Maaf, terjadi kesalahan menghubungi server. Coba lagi.' }])
      changeAIState('idle')
    } finally {
      setIsSending(false)
    }
  }, [messages, isSending, changeAIState, assignIdleTargets])

  useEffect(() => { micRef.current = micActive }, [micActive])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function initParticles(W: number, H: number) {
      const ps: Particle[] = []
      let gi = 0, gc = 0
      for (let i = 0; i < N; i++) {
        while (gc >= GROUPS[gi] && gi < GROUPS.length - 1) { gi++; gc = 0 }
        gc++
        const hue = gi === 1 ? 196 : gi === 9 ? 264 : 182 + Math.random() * 20
        ps.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
          tx: W / 2, ty: H / 2,
          size: 1.2 + Math.random() * 1.8,
          alpha: 0.5 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
          group: gi, hue,
        })
      }
      particlesRef.current = ps
    }

    function resize() {
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      const dpr = window.devicePixelRatio || 1
      canvas.width = W * dpr
      canvas.height = H * dpr
      ctx.scale(dpr, dpr)
      sizeRef.current = { W, H }
      initParticles(W, H)
      assignIdleTargets()
    }

    let raf = 0
    let lastT = 0

    function loop(ts: number) {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(ts - lastT, 50)
      lastT = ts
      const t = ts * 0.001

      const { W, H } = sizeRef.current
      if (!W || !H) return

      const st = stateRef.current
      const mobile = W < 768
      const cx = mobile ? W * 0.5 : W * 0.64
      const cy = mobile ? H * 0.4 : H * 0.52
      const s = Math.min(W, H) * (mobile ? 0.27 : 0.28)

      ctx.clearRect(0, 0, W, H)

      // Central volumetric glow
      const glowA = st === 'idle' ? 0.09 : st === 'thinking' ? 0.07 + Math.sin(t * 3.2) * 0.04 : 0.15
      const glowR = s * (st === 'idle' ? 1.7 : 2.4)
      const grd = ctx.createRadialGradient(cx, cy - s * 0.55, 0, cx, cy - s * 0.55, glowR)
      grd.addColorStop(0, `rgba(0,175,255,${glowA})`)
      grd.addColorStop(0.35, `rgba(30,70,220,${glowA * 0.4})`)
      grd.addColorStop(0.7, `rgba(90,20,170,${glowA * 0.12})`)
      grd.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, W, H)

      // Subtle floor light when speaking
      if (st === 'speaking') {
        const fa = 0.06 + Math.sin(t * 1.1) * 0.02
        const fGrd = ctx.createRadialGradient(cx, cy + s * 0.3, 0, cx, cy + s * 0.3, s * 1.5)
        fGrd.addColorStop(0, `rgba(0,212,255,${fa})`)
        fGrd.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = fGrd
        ctx.fillRect(0, 0, W, H)
      }

      const ps = particlesRef.current

      // Refresh idle targets gradually
      if (st === 'idle') {
        idleTimer.current += dt
        if (idleTimer.current > 1800) {
          idleTimer.current = 0
          const n = Math.floor(N * 0.12)
          for (let i = 0; i < n; i++) {
            const p = ps[Math.floor(Math.random() * N)]
            const a = p.phase + t * 0.06 + Math.random() * 1.0
            const d = s * (0.18 + Math.random() * 1.15)
            p.tx = cx + Math.cos(a) * d * 0.74
            p.ty = cy - s * 0.52 + Math.sin(a) * d * 0.95
          }
        }
      } else {
        idleTimer.current = 0
      }

      const lerpF = st === 'idle' ? 0.006 : st === 'thinking' ? 0.016 : 0.028

      // Update particles
      ps.forEach(p => {
        // Listening: magnetic wave toward head
        if (st === 'listening') {
          const headY = cy - s * 1.2
          const dx = cx - p.x, dy = headY - p.y
          const dist = Math.sqrt(dx * dx + dy * dy) + 1
          const wave = Math.sin(t * 4.0 - dist * 0.03) * 0.2
          p.vx += (dx / dist) * wave * 0.18
          p.vy += (dy / dist) * wave * 0.18
        }

        // Speaking: subtle chest breath
        if (st === 'speaking' && p.group === 7) {
          p.vy += Math.sin(t * 1.15 + p.phase) * 0.012
        }

        p.vx += (p.tx - p.x) * lerpF
        p.vy += (p.ty - p.y) * lerpF
        p.vx *= 0.908
        p.vy *= 0.908
        p.x += p.vx
        p.y += p.vy
      })

      // Draw connection lines (single batched stroke for performance)
      const lineHue = st === 'thinking' ? 258 : st === 'listening' ? 200 : 191
      const thresh = s * 0.52
      const threshSq = thresh * thresh

      ctx.strokeStyle = `hsla(${lineHue},100%,65%,0.2)`
      ctx.lineWidth = 0.55
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        const pi = ps[i]
        for (let j = i + 1; j < N; j++) {
          const pj = ps[j]
          const dx = pi.x - pj.x
          if (Math.abs(dx) >= thresh) continue
          const dy = pi.y - pj.y
          if (Math.abs(dy) >= thresh) continue
          if (dx * dx + dy * dy < threshSq) {
            ctx.moveTo(pi.x, pi.y)
            ctx.lineTo(pj.x, pj.y)
          }
        }
      }
      ctx.stroke()

      // Draw particles
      ps.forEach(p => {
        const pulse = Math.sin(t * 1.75 + p.phase) * 0.5 + 0.5
        const alpha = p.alpha * (0.58 + pulse * 0.42)
        const size = p.size * (0.82 + pulse * 0.32)

        // Eye bloom when speaking
        if (p.group === 1 && st === 'speaking') {
          const eyeA = alpha * (0.75 + Math.sin(t * 2.5 + p.phase) * 0.25)
          const bloom = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 7)
          bloom.addColorStop(0, `hsla(${p.hue},100%,92%,${eyeA})`)
          bloom.addColorStop(0.4, `hsla(${p.hue},100%,72%,${eyeA * 0.35})`)
          bloom.addColorStop(1, 'transparent')
          ctx.fillStyle = bloom
          ctx.beginPath()
          ctx.arc(p.x, p.y, size * 7, 0, Math.PI * 2)
          ctx.fill()
        }

        // Thinking: purple scatter glow
        if (st === 'thinking') {
          const tGlow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3.5)
          tGlow.addColorStop(0, `hsla(${p.hue + 55},100%,78%,${alpha * 0.55})`)
          tGlow.addColorStop(1, 'transparent')
          ctx.fillStyle = tGlow
          ctx.beginPath()
          ctx.arc(p.x, p.y, size * 3.5, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.fillStyle = `hsla(${p.hue},100%,70%,${alpha})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
        ctx.fill()
      })

      // Listening: concentric sound wave rings at head
      if (st === 'listening') {
        const headY = cy - s * 1.22
        const numWaves = micRef.current ? 5 : 3
        for (let w = 0; w < numWaves; w++) {
          const progress = ((t * 0.68 + w / numWaves) % 1)
          const r = progress * s * 1.85
          const wa = (1 - progress) * 0.42
          ctx.strokeStyle = `rgba(0,215,255,${wa})`
          ctx.lineWidth = 1 + (1 - progress) * 0.8
          ctx.beginPath()
          ctx.arc(cx, headY, r, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // Speaking: flowing energy particles down the body
      if (st === 'speaking') {
        for (let f = 0; f < 4; f++) {
          const flowT = ((t * 0.52 + f * 0.25) % 1)
          const flowY = cy - s * 1.3 + flowT * s * 1.55
          const flowX = cx + Math.sin(flowT * Math.PI * 3.5 + f * 1.9) * s * 0.14
          const fa = ss(Math.min(flowT * 3, 1)) * ss(Math.min((1 - flowT) * 3, 1)) * 0.6
          const fGrd = ctx.createRadialGradient(flowX, flowY, 0, flowX, flowY, s * 0.075)
          fGrd.addColorStop(0, `rgba(0,230,255,${fa})`)
          fGrd.addColorStop(1, 'transparent')
          ctx.fillStyle = fGrd
          ctx.beginPath()
          ctx.arc(flowX, flowY, s * 0.075, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // Thinking: scattered node flashes
      if (st === 'thinking') {
        for (let f = 0; f < 6; f++) {
          const flashT = ((t * 1.1 + f * 0.167) % 1)
          if (flashT > 0.35) continue
          const idx = Math.floor((f * 53 + Math.floor(t * 2)) % N)
          const p = ps[idx]
          const fa = (1 - flashT / 0.35) * 0.7
          const fGrd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 0.12)
          fGrd.addColorStop(0, `rgba(160,80,255,${fa})`)
          fGrd.addColorStop(1, 'transparent')
          ctx.fillStyle = fGrd
          ctx.beginPath()
          ctx.arc(p.x, p.y, s * 0.12, 0, Math.PI * 2)
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
  }, [assignIdleTargets, assignBodyTargets, assignListeningTargets, assignScatterTargets])

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
                  onClick={() => {
                    const next = !micActive
                    setMicActive(next)
                    micRef.current = next
                    changeAIState(next ? 'listening' : input ? 'speaking' : 'idle')
                  }}
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
