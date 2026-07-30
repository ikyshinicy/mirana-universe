import { useRef, useEffect } from 'react'

// Prototype "wajah dari titik" (image-to-particle mapping) — Opsi A.
// Saat ini sumbernya masih placeholder buatan (bentuk wajah digambar pakai
// primitif canvas), BUKAN foto/gambar asli, supaya bebas hak cipta.
// Untuk hasil sedekat referensi (wajah nyata), ganti fungsi
// `buildFaceBrightnessMap` di bawah supaya menggambar sebuah <img> foto/
// AI-generated milikmu sendiri ke canvas tersembunyi, lalu logika sampling
// di bawah akan otomatis bekerja dengan sumber itu.

interface FaceParticle {
  x: number; y: number
  tx: number; ty: number
  size: number
  hue: number
  phase: number
}

const SAMPLE_STEP = 4
const BRIGHTNESS_THRESHOLD = 40
const MAX_PARTICLES = 3200
const ASSEMBLE_MS = 1600

function buildFaceBrightnessMap(w: number, h: number): ImageData {
  const off = document.createElement('canvas')
  off.width = w
  off.height = h
  const ctx = off.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  const cx = w * 0.5
  const cy = h * 0.48
  const faceW = Math.min(w, h) * 0.22
  const faceH = Math.min(w, h) * 0.3

  // TODO(opsional): ganti blok di bawah ini dengan
  //   ctx.drawImage(myImageElement, cx - faceW, cy - faceH, faceW * 2, faceH * 2)
  // kalau sudah punya foto/gambar sumber sendiri.

  const grad = ctx.createRadialGradient(cx, cy - faceH * 0.1, faceW * 0.1, cx, cy, faceW * 1.15)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(cx, cy, faceW, faceH, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  ctx.beginPath()
  ctx.ellipse(cx, cy - faceH * 0.55, faceW * 0.6, faceH * 0.2, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(0,0,0,0.65)'
  ;[-1, 1].forEach(side => {
    ctx.beginPath()
    ctx.ellipse(cx + side * faceW * 0.38, cy - faceH * 0.08, faceW * 0.17, faceH * 0.095, 0, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ;[-1, 1].forEach(side => {
    ctx.beginPath()
    ctx.ellipse(cx + side * faceW * 0.38, cy - faceH * 0.06, faceW * 0.075, faceH * 0.05, 0, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = faceW * 0.05
  ctx.beginPath()
  ctx.moveTo(cx, cy - faceH * 0.02)
  ctx.lineTo(cx - faceW * 0.03, cy + faceH * 0.28)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = faceH * 0.055
  ctx.beginPath()
  ctx.moveTo(cx - faceW * 0.3, cy + faceH * 0.5)
  ctx.quadraticCurveTo(cx, cy + faceH * 0.6, cx + faceW * 0.3, cy + faceH * 0.5)
  ctx.stroke()

  return ctx.getImageData(0, 0, w, h)
}

function sampleParticles(img: ImageData, w: number, h: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const data = img.data
  for (let y = 0; y < h; y += SAMPLE_STEP) {
    for (let x = 0; x < w; x += SAMPLE_STEP) {
      const i = (y * w + x) * 4
      const brightness = ((data[i] + data[i + 1] + data[i + 2]) / 3) * (data[i + 3] / 255)
      if (brightness > BRIGHTNESS_THRESHOLD) {
        pts.push({
          x: x + (Math.random() - 0.5) * SAMPLE_STEP,
          y: y + (Math.random() - 0.5) * SAMPLE_STEP,
        })
      }
    }
  }
  if (pts.length > MAX_PARTICLES) {
    for (let i = pts.length - 1; i > MAX_PARTICLES; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      pts[i] = pts[j]
    }
    pts.length = MAX_PARTICLES
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

      const map = buildFaceBrightnessMap(w, h)
      const targets = sampleParticles(map, w, h)

      particlesRef.current = targets.map(t => ({
        x: Math.random() * w,
        y: Math.random() * h,
        tx: t.x,
        ty: t.y,
        size: 1 + Math.random() * 1.6,
        hue: 210 + (t.x / w) * 90, // biru -> magenta
        phase: Math.random() * Math.PI * 2,
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
        const jitterX = Math.sin(now * 0.0016 + p.phase) * 1.2
        const jitterY = Math.cos(now * 0.0013 + p.phase) * 1.2
        const goalX = p.tx + (assembleProgress >= 1 ? jitterX : 0)
        const goalY = p.ty + (assembleProgress >= 1 ? jitterY : 0)

        p.x += (goalX - p.x) * (0.04 + ease * 0.02)
        p.y += (goalY - p.y) * (0.04 + ease * 0.02)

        const alpha = 0.5 + Math.sin(now * 0.002 + p.phase) * 0.2
        ctx.beginPath()
        ctx.fillStyle = `hsla(${p.hue}, 85%, 65%, ${alpha})`
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

  return <canvas ref={canvasRef} className="w-full h-full block" style={{ background: '#05050a' }} />
}
