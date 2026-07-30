import { useRef, useEffect } from 'react'

// Prototype "wajah dari titik" — versi vector.
// Wajah digambar sebagai path asli (alis, mata+iris, hidung, bibir, garis
// rahang, telinga) di canvas tersembunyi, lalu di-sample jadi partikel.
// Ditambah lapisan "field" partikel swirl di sekitar wajah, murni prosedural.
// Semua bentuk dibuat dari nol lewat kode — bukan hasil ekstraksi dari
// foto/gambar berhak cipta manapun.

interface FaceParticle {
  x: number; y: number
  tx: number; ty: number
  size: number
  hue: number
  phase: number
  field: boolean
}

const SAMPLE_STEP = 3
const BRIGHTNESS_THRESHOLD = 60
const MAX_FACE_PARTICLES = 5200
const FIELD_PARTICLES = 2600
const ASSEMBLE_MS = 1800

function drawFaceLineArt(octx: CanvasRenderingContext2D, w: number, h: number) {
  const mobile = w < 768
  const cx = mobile ? w * 0.5 : w * 0.64
  const cy = mobile ? h * 0.4 : h * 0.47
  const fw = Math.min(w, h) * (mobile ? 0.24 : 0.2)
  const fh = Math.min(w, h) * (mobile ? 0.32 : 0.27)

  octx.fillStyle = '#000'
  octx.fillRect(0, 0, w, h)
  octx.strokeStyle = '#fff'
  octx.fillStyle = '#fff'
  octx.lineCap = 'round'
  octx.lineJoin = 'round'

  // garis rahang / kontur wajah
  octx.lineWidth = fw * 0.028
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
  octx.lineWidth = fw * 0.022
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
  octx.lineWidth = fw * 0.03
  ;[-1, 1].forEach(side => {
    octx.beginPath()
    octx.moveTo(cx + side * fw * 0.52, cy - fh * 0.36)
    octx.quadraticCurveTo(cx + side * fw * 0.28, cy - fh * 0.46, cx + side * fw * 0.08, cy - fh * 0.37)
    octx.stroke()
  })

  // mata (kelopak + iris + pupil)
  const eyeW = fw * 0.24
  const eyeH = fh * 0.1
  ;[-1, 1].forEach(side => {
    const ex = cx + side * fw * 0.3
    const ey = cy - fh * 0.12
    octx.lineWidth = fw * 0.02
    octx.beginPath()
    octx.moveTo(ex - eyeW / 2, ey)
    octx.quadraticCurveTo(ex, ey - eyeH * 1.3, ex + eyeW / 2, ey)
    octx.quadraticCurveTo(ex, ey + eyeH * 0.7, ex - eyeW / 2, ey)
    octx.stroke()

    octx.lineWidth = fw * 0.016
    octx.beginPath()
    octx.arc(ex, ey + eyeH * 0.05, eyeH * 0.85, 0, Math.PI * 2)
    octx.stroke()

    octx.beginPath()
    octx.arc(ex, ey + eyeH * 0.05, eyeH * 0.32, 0, Math.PI * 2)
    octx.fill()
  })

  // jembatan hidung + cuping hidung
  octx.lineWidth = fw * 0.022
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
  const lipW = fw * 0.42
  octx.lineWidth = fw * 0.024
  octx.beginPath()
  octx.moveTo(cx - lipW / 2, lipY)
  octx.quadraticCurveTo(cx - lipW * 0.15, lipY - fh * 0.06, cx, lipY - fh * 0.02)
  octx.quadraticCurveTo(cx + lipW * 0.15, lipY - fh * 0.06, cx + lipW / 2, lipY)
  octx.stroke()
  octx.beginPath()
  octx.moveTo(cx - lipW / 2, lipY)
  octx.quadraticCurveTo(cx, lipY + fh * 0.13, cx + lipW / 2, lipY)
  octx.stroke()

  return { cx, cy, fw, fh }
}

function sampleFaceParticles(img: ImageData, w: number, h: number) {
  const pts: { x: number; y: number }[] = []
  const data = img.data
  for (let y = 0; y < h; y += SAMPLE_STEP) {
    for (let x = 0; x < w; x += SAMPLE_STEP) {
      const i = (y * w + x) * 4
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (brightness > BRIGHTNESS_THRESHOLD) {
        pts.push({
          x: x + (Math.random() - 0.5) * SAMPLE_STEP,
          y: y + (Math.random() - 0.5) * SAMPLE_STEP,
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
  const pts: { x: number; y: number }[] = []
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
  for (let i = 0; i < FIELD_PARTICLES; i++) {
    const r = faceR * 0.95 + (maxR - faceR) * Math.pow(Math.random(), 2.1)
    let a = Math.random() * Math.PI * 2
    a += r * 0.0032 // twist swirl mengikuti jarak
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92 })
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
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const off = document.createElement('canvas')
      off.width = w
      off.height = h
      const octx = off.getContext('2d')!
      const { cx, cy, fw, fh } = drawFaceLineArt(octx, w, h)
      const img = octx.getImageData(0, 0, w, h)

      const facePts = sampleFaceParticles(img, w, h)
      const faceR = Math.max(fw, fh) * 1.05
      const fieldPts = buildFieldParticles(cx, cy, faceR, w, h)

      const all = facePts.map(p => ({ ...p, field: false })).concat(fieldPts.map(p => ({ ...p, field: true })))

      particlesRef.current = all.map(t => ({
        x: Math.random() * w,
        y: Math.random() * h,
        tx: t.x,
        ty: t.y,
        size: t.field ? 0.6 + Math.random() * 1.1 : 1 + Math.random() * 1.4,
        hue: 205 + (t.tx / w) * 110, // biru -> magenta
        phase: Math.random() * Math.PI * 2,
        field: t.field,
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
        const jitterX = Math.sin(now * 0.0015 + p.phase) * (p.field ? 0.6 : 1.1)
        const jitterY = Math.cos(now * 0.0012 + p.phase) * (p.field ? 0.6 : 1.1)
        const goalX = p.tx + (assembleProgress >= 1 ? jitterX : 0)
        const goalY = p.ty + (assembleProgress >= 1 ? jitterY : 0)

        p.x += (goalX - p.x) * (0.035 + ease * 0.02)
        p.y += (goalY - p.y) * (0.035 + ease * 0.02)

        const alpha = (p.field ? 0.35 : 0.55) + Math.sin(now * 0.002 + p.phase) * 0.2
        ctx.beginPath()
        ctx.fillStyle = `hsla(${p.hue}, 85%, 65%, ${Math.max(0, alpha)})`
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

  return <canvas ref={canvasRef} className="w-full h-full block" style={{ background: '#050508' }} />
}
