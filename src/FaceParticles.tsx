import { useRef, useEffect } from 'react'

// Prototype "wajah dari titik" — versi vector + volume.
// Wajah digambar sebagai path asli (kontur, alis, mata+iris, hidung, bibir,
// telinga) DITAMBAH lapisan glow radial untuk shading volume, di canvas
// tersembunyi, lalu di-sample jadi partikel. Ditambah lapisan "field"
// partikel swirl di sekitar wajah, murni prosedural. Semua bentuk dibuat
// dari nol lewat kode — bukan hasil ekstraksi dari foto/gambar manapun.

interface FaceParticle {
  x: number; y: number
  tx: number; ty: number
  size: number
  hue: number
  phase: number
  field: boolean
  bright: number
}

const SAMPLE_STEP = 3
const BRIGHTNESS_THRESHOLD = 34
const MAX_FACE_PARTICLES = 6000
const FIELD_PARTICLES = 2200
const ASSEMBLE_MS = 1800

function getLayout(w: number, h: number) {
  const mobile = w < 768
  const cx = mobile ? w * 0.5 : w * 0.64
  const cy = mobile ? h * 0.4 : h * 0.47
  const fw = Math.min(w, h) * (mobile ? 0.24 : 0.2)
  const fh = Math.min(w, h) * (mobile ? 0.32 : 0.27)
  return { cx, cy, fw, fh }
}

function drawFaceLineArt(octx: CanvasRenderingContext2D, w: number, h: number) {
  const { cx, cy, fw, fh } = getLayout(w, h)

  octx.fillStyle = '#000'
  octx.fillRect(0, 0, w, h)

  // --- lapisan volume (shading lembut mengikuti bentuk wajah) ---
  const grad = octx.createRadialGradient(cx, cy - fh * 0.1, fw * 0.05, cx, cy, fw * 1.25)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.8, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  octx.fillStyle = grad
  octx.beginPath()
  octx.ellipse(cx, cy, fw * 0.95, fh * 1.1, 0, 0, Math.PI * 2)
  octx.fill()

  // --- kontur & fitur (garis lebih terang di atas volume) ---
  octx.strokeStyle = '#fff'
  octx.fillStyle = '#fff'
  octx.lineCap = 'round'
  octx.lineJoin = 'round'

  // garis rahang / kontur wajah
  octx.lineWidth = fw * 0.032
  octx.beginPath()
  octx.moveTo(cx - fw * 0.78, cy - fh * 0.32)
  octx.bezierCurveTo(cx - fw * 0.98, cy - fh * 0.05, cx - fw * 0.92, cy + fh * 0.15, cx - fw * 0.82, cy + fh * 0.35)
  octx.bezierCurveTo(cx - fw * 0.65, cy + fh * 0.78, cx - fw * 0.32, cy + fh * 1.0, cx, cy + fh * 1.08)
  octx.bezierCurveTo(cx + fw * 0.32, cy + fh * 1.0, cx + fw * 0.65, cy + fh * 0.78, cx + fw * 0.82, cy + fh * 0.35)
  octx.bezierCurveTo(cx + fw * 0.92, cy + fh * 0.15, cx + fw * 0.98, cy - fh * 0.05, cx + fw * 0.78, cy - fh * 0.32)
  octx.bezierCurveTo(cx + fw * 0.55, cy - fh * 0.85, cx + fw * 0.22, cy - fh * 1.18, cx, cy - fh * 1.2)
  octx.bezierCurveTo(cx - fw * 0.22, cy - fh * 1.18, cx - fw * 0.55, cy - fh * 0.85, cx - fw * 0.78, cy - fh * 0.32)
  octx.stroke()

  // telinga
  octx.lineWidth = fw * 0.024
  ;[-1, 1].forEach(side => {
    octx.beginPath()
    octx.moveTo(cx + side * fw * 0.86, cy - fh * 0.05)
    octx.bezierCurveTo(
      cx + side * fw * 1.06, cy - fh * 0.02,
      cx + side * fw * 1.06, cy + fh * 0.28,
      cx + side * fw * 0.88, cy + fh * 0.32
    )
    octx.stroke()
  })

  // alis
  octx.lineWidth = fw * 0.034
  ;[-1, 1].forEach(side => {
    octx.beginPath()
    octx.moveTo(cx + side * fw * 0.52, cy - fh * 0.36)
    octx.quadraticCurveTo(cx + side * fw * 0.28, cy - fh * 0.46, cx + side * fw * 0.08, cy - fh * 0.37)
    octx.stroke()
  })

  // mata (kelopak + iris + pupil)
  const eyeW = fw * 0.26
  const eyeH = fh * 0.11
  ;[-1, 1].forEach(side => {
    const ex = cx + side * fw * 0.3
    const ey = cy - fh * 0.12
    octx.lineWidth = fw * 0.024
    octx.beginPath()
    octx.moveTo(ex - eyeW / 2, ey)
    octx.quadraticCurveTo(ex, ey - eyeH * 1.3, ex + eyeW / 2, ey)
    octx.quadraticCurveTo(ex, ey + eyeH * 0.7, ex - eyeW / 2, ey)
    octx.stroke()

    octx.lineWidth = fw * 0.02
    octx.beginPath()
    octx.arc(ex, ey + eyeH * 0.05, eyeH * 0.85, 0, Math.PI * 2)
    octx.stroke()

    octx.beginPath()
    octx.arc(ex, ey + eyeH * 0.05, eyeH * 0.34, 0, Math.PI * 2)
    octx.fill()
  })

  // jembatan hidung + cuping hidung
  octx.lineWidth = fw * 0.026
  octx.beginPath()
  octx.moveTo(cx - fw * 0.03, cy - fh * 0.05)
  octx.quadraticCurveTo(cx - fw * 0.09, cy + fh * 0.28, cx - fw * 0.11, cy + fh * 0.42)
  octx.stroke()
  octx.beginPath()
  octx.moveTo(cx - fw * 0.11, cy + fh * 0.42)
  octx.quadraticCurveTo(cx, cy + fh * 0.52, cx + fw * 0.11, cy + fh * 0.42)
  octx.stroke()

  // bibir
  const lipY = cy + fh * 0.72
  const lipW = fw * 0.44
  octx.lineWidth = fw * 0.028
  octx.beginPath()
  octx.moveTo(cx - lipW / 2, lipY)
  octx.quadraticCurveTo(cx - lipW * 0.15, lipY - fh * 0.06, cx, lipY - fh * 0.02)
  octx.quadraticCurveTo(cx + lipW * 0.15, lipY - fh * 0.06, cx + lipW / 2, lipY)
  octx.stroke()
  octx.beginPath()
  octx.moveTo(cx - lipW / 2, lipY)
  octx.quadraticCurveTo(cx, lipY + fh * 0.13, cx + lipW / 2, lipY)
  octx.stroke()
}

function sampleFaceParticles(img: ImageData, w: number, h: number) {
  const pts: { x: number; y: number; bright: number }[] = []
  const data = img.data
  for (let y = 0; y < h; y += SAMPLE_STEP) {
    for (let x = 0; x < w; x += SAMPLE_STEP) {
      const i = (y * w + x) * 4
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (brightness > BRIGHTNESS_THRESHOLD) {
        pts.push({
          x: x + (Math.random() - 0.5) * SAMPLE_STEP,
          y: y + (Math.random() - 0.5) * SAMPLE_STEP,
          bright: brightness / 255,
        })
      }
    }
  }
  if (pts.length > MAX_FACE_PARTICLES) {
    for (let i = pts.length - 1; i > MAX_FACE_PARTICLES; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      pts[i] = pts[j]
    }
    pts.length = MAX_FACE_PARTICLES
  }
  return pts
}

// swirl field di sekitar wajah, murni prosedural (bukan dari gambar)
function buildFieldParticles(cx: number, cy: number, faceR: number, w: number, h: number) {
  const pts: { x: number; y: number; bright: number }[] = []
  const maxR = Math.min(w, h) * 0.95
  for (let i = 0; i < FIELD_PARTICLES; i++) {
    const r = faceR * 0.95 + (maxR - faceR) * Math.pow(Math.random(), 1.7)
    let a = Math.random() * Math.PI * 2
    a += r * 0.0035 // twist swirl mengikuti jarak
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * 0.85
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue
    pts.push({ x, y, bright: Math.max(0.15, 1 - r / maxR) })
  }
  return pts
}

interface FaceParticlesProps {
  active?: boolean // sinkronkan dengan AIState kalau mau (mis. hanya render saat 'idle')
}

export default function FaceParticles({ active = true }: FaceParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<FaceParticle[]>([])
  const rafRef = useRef<number>(0)
  const startRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d')!

    const setup = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth || window.innerWidth
      const h = canvas.clientHeight || window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const off = document.createElement('canvas')
      off.width = w
      off.height = h
      const octx = off.getContext('2d')!
      drawFaceLineArt(octx, w, h)
      const img = octx.getImageData(0, 0, w, h)

      const { cx, cy, fw, fh } = getLayout(w, h)
      const facePts = sampleFaceParticles(img, w, h)
      const faceR = Math.max(fw, fh) * 1.1
      const fieldPts = buildFieldParticles(cx, cy, faceR, w, h)

      const all = facePts.map(p => ({ ...p, field: false })).concat(fieldPts.map(p => ({ ...p, field: true })))

      particlesRef.current = all.map(t => ({
        x: Math.random() * w,
        y: Math.random() * h,
        tx: t.x,
        ty: t.y,
        size: t.field ? 0.8 + Math.random() * 1.3 : 1.3 + t.bright * 1.8 + Math.random() * 0.6,
        hue: 205 + (t.tx / w) * 110, // biru -> magenta
        phase: Math.random() * Math.PI * 2,
        field: t.field,
        bright: t.bright,
      }))
      startRef.current = performance.now()
    }

    setup()
    window.addEventListener('resize', setup)

    const loop = (now: number) => {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      const t = now - startRef.current
      const assembleProgress = Math.min(1, t / ASSEMBLE_MS)
      const ease = 1 - Math.pow(1 - assembleProgress, 3)

      for (const p of particlesRef.current) {
        const jitterX = Math.sin(now * 0.0015 + p.phase) * (p.field ? 0.7 : 1.1)
        const jitterY = Math.cos(now * 0.0012 + p.phase) * (p.field ? 0.7 : 1.1)
        const goalX = p.tx + (assembleProgress >= 1 ? jitterX : 0)
        const goalY = p.ty + (assembleProgress >= 1 ? jitterY : 0)

        p.x += (goalX - p.x) * (0.035 + ease * 0.025)
        p.y += (goalY - p.y) * (0.035 + ease * 0.025)

        const twinkle = 0.75 + Math.sin(now * 0.002 + p.phase) * 0.25
        const baseAlpha = p.field ? 0.3 + p.bright * 0.5 : 0.55 + p.bright * 0.4
        const alpha = Math.min(1, baseAlpha * twinkle)

        ctx.beginPath()
        ctx.fillStyle = `hsla(${p.hue}, 90%, 68%, ${alpha})`
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', setup)
    }
  }, [active])

  return <canvas ref={canvasRef} className="w-full h-full block" style={{ background: 'transparent' }} />
}
