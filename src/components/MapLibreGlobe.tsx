import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { PathLayer, ScatterplotLayer, IconLayer } from '@deck.gl/layers'
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { twoline2satrec, propagate, eciToGeodetic, degreesLat, degreesLong, gstime } from 'satellite.js'
// Globe-compatible sphere impostors via IconLayer

type Tle = { name?: string; l1: string; l2: string }

const STYLE_RASTER_GLOBE: any = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256
    }
  },
  layers: [
    { id: 'Satellite', type: 'raster', source: 'satellite' }
  ],
  sky: {
    'atmosphere-blend': [
      'interpolate',
      ['linear'],
      ['zoom'],
      0, 1,
      5, 1,
      7, 0
    ]
  },
  light: {
    anchor: 'map',
    position: [1.5, 90, 80]
  }
}

function pickColorByType(objectType: string, name: string, altKm: number): [number, number, number, number] {
  // Category-first coloring: NAV=red, GEO=yellow, OTHER=orange
  const cat = pickCategory(objectType, name, altKm)
  switch (cat) {
    case 'NAV':
      return [255, 80, 80, 255] // red
    case 'GEO':
      return [255, 220, 0, 255] // yellow
    case 'OTHER':
      return [255, 150, 50, 255] // orange
    case 'PAYLOAD':
    case 'ROCKET':
    case 'DEBRIS':
    default:
      return [255, 150, 50, 255] // treat as orange by default
  }
}

function pickCategory(objectType: string, name: string, altKm: number): 'NAV' | 'GEO' | 'PAYLOAD' | 'ROCKET' | 'DEBRIS' | 'OTHER' {
  const t = (objectType || '').toUpperCase()
  const isNav = /(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|BDS|IRNSS|QZSS)/i.test(name)
  const isGEO = altKm > 30000
  if (isNav) return 'NAV'
  if (isGEO) return 'GEO'
  if (t.includes('PAYLOAD')) return 'PAYLOAD'
  if (t.includes('ROCKET')) return 'ROCKET'
  if (t.includes('DEBRIS')) return 'DEBRIS'
  return 'OTHER'
}

export const MapLibreGlobe: React.FC<{ tles: Tle[]; typesBySatnum?: Record<number, string> }> = ({ tles, typesBySatnum = {} }) => {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)
  const [iconAtlasUrl, setIconAtlasUrl] = useState<string | null>(null)

  const satrecs = useMemo(() => {
    return tles.slice(0, 300).map((t) => {
      try {
        const rec = twoline2satrec(t.l1, t.l2)
        const satnum = (rec as any).satnum as number | undefined
        const id = t.name ?? (satnum?.toString() ?? Math.random().toString(36).slice(2))
        return { id, rec, satnum }
      } catch {
        return null
      }
    }).filter(Boolean) as Array<{ id: string; rec: any; satnum?: number }>
  }, [tles])

  useEffect(() => {
    if (!divRef.current) return
    const map = new maplibregl.Map({ container: divRef.current, style: STYLE_RASTER_GLOBE, center: [140, 35], zoom: 1.6 })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.once('load', () => {
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] }) as any
      map.addControl(overlay)
      overlayRef.current = overlay
      try { overlayRef.current?.setProps({ clearCanvas: false }) } catch {}
      // Build a small shaded icon atlas (grayscale lit sphere)
      try {
        const size = 128
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, size, size)
        const cx = size / 2, cy = size / 2, r = size * 0.48
        const len = Math.sqrt(0.6*0.6 + 0.4*0.4 + 1.0*1.0)
        const lx = 0.6/len, ly = 0.4/len, lz = 1.0/len
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = (x + 0.5 - cx) / r
            const dy = (y + 0.5 - cy) / r
            const rr = dx * dx + dy * dy
            if (rr > 1) continue
            const z = Math.sqrt(1 - rr)
            const ndotl = Math.max(0, dx * lx + dy * ly + z * lz)
            const ambient = 0.25
            const shade = ambient + (1 - ambient) * ndotl
            const v = Math.floor(255 * shade)
            ctx.fillStyle = `rgb(${v},${v},${v})`
            ctx.fillRect(x, y, 1, 1)
          }
        }
        const url = canvas.toDataURL()
        setIconAtlasUrl(url)
        try {
          // eslint-disable-next-line no-console
          console.debug('[MapLibreGlobe] icon atlas ready length=', url.length)
        } catch {}
      } catch {}
      setReady(true)
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!ready || !overlayRef.current) return
    let alive = true
    let pathTick = 0
    let summaryTick = 0
    // Logarithmic altitude scaling to “stick” satellites to just outside the atmosphere
    const ATMOSPHERE_TOP_M = 200_000 // raise minimum altitude slightly (~200 km)
    const SHELL_THICKNESS_M = 80_000 // visual shell thickness outside atmosphere
    const MAX_ALT_M = 100_000_000 // normalize up to ~100,000 km
    const scaleAltitudeLog = (altM: number) => {
      const a = Math.max(0, Math.min(altM, MAX_ALT_M))
      const t = Math.log1p(a) / Math.log1p(MAX_ALT_M)
      return ATMOSPHERE_TOP_M + t * SHELL_THICKNESS_M
    }
    // IconLayer expects 0-255 RGBA; keep as-is
    const tick = () => {
      const now = new Date()
      const gmst = gstime(now)
      const counts = { NAV: 0, GEO: 0, PAYLOAD: 0, ROCKET: 0, DEBRIS: 0, OTHER: 0 }
      const rawTypeCounts: Record<string, number> = {}
      const otherTypeCounts: Record<string, number> = {}
      let otherEmptyType = 0
      const data = satrecs.map((s) => {
        const pv = propagate(s.rec, now)
        const pos = pv?.position
        if (!pos) return null
        const gd = eciToGeodetic(pos, gmst)
        const lat = degreesLat(gd.latitude)
        const lon = degreesLong(gd.longitude)
        const altM = Math.max(0, (gd.height ?? 0) * 1000)
        const altScaledM = scaleAltitudeLog(altM)
        const typ = (s.satnum && typesBySatnum[s.satnum]) || ''
        const normTyp = (typ || '').toString().trim().toUpperCase()
        if (normTyp) rawTypeCounts[normTyp] = (rawTypeCounts[normTyp] || 0) + 1
        const cat = pickCategory(normTyp, s.id, gd.height ?? 0)
        counts[cat]++
        if (cat === 'OTHER') {
          if (normTyp) otherTypeCounts[normTyp] = (otherTypeCounts[normTyp] || 0) + 1
          else otherEmptyType++
        }
        const color = pickColorByType(typ, s.id, gd.height ?? 0)
        return { position: [lon, lat, altScaledM], color }
      }).filter(Boolean) as Array<{ position: [number, number, number]; color: [number, number, number, number] }>

  // Debug: count + sample (kept lightweight)
  try {
    if ((data.length ?? 0) % 60 === 0) {
      // eslint-disable-next-line no-console
      console.debug(`[MapLibreGlobe] sats=`, data.length, `sample=`, data[0]?.position)
    }
  } catch {}

      // Category summary every 5 ticks + OTHER breakdown (top 6)
      try {
        summaryTick++
        if (summaryTick % 5 === 0) {
          const total = Object.values(counts).reduce((a, b) => a + (b as number), 0)
          const parts = Object.entries(counts)
            .filter(([, v]) => (v as number) > 0)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')
          const topOther = Object.entries(otherTypeCounts)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, 6)
            .map(([k, v]) => `${k}:${v}`)
            .join(' ')
          const otherSuffix = topOther || otherEmptyType ? ` | OTHER breakdown: ${topOther}${otherEmptyType ? ` EMPTY:${otherEmptyType}` : ''}` : ''
          // eslint-disable-next-line no-console
          console.debug(`[MapLibreGlobe] categories: ${parts} total:${total}${otherSuffix}`)
        }
      } catch {}

      // Globe-friendly sphere impostor via IconLayer (billboard with shaded atlas)
      const iconMapping = {
        sphere: { x: 0, y: 0, width: 128, height: 128, mask: false, anchorX: 64, anchorY: 64 }
      } as any
      const sphereImpostors = iconAtlasUrl ? new IconLayer({
        id: 'sats-sphere-impostor',
        data,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: any) => d.position,
        getIcon: () => 'sphere',
        iconMapping,
        iconAtlas: iconAtlasUrl,
        sizeUnits: 'pixels',
        getSize: 24,
        sizeMinPixels: 12,
        sizeMaxPixels: 40,
        getColor: (d: any) => d.color,
        parameters: { depthTest: false, depthMask: false }
      }) : null

      // Simple orbit preview for first 3 satellites (next 90 min, 60s step)
      // Fallback points (deck.glのみ) — アイコン未準備時のみ使用
      const fallbackPoints = new ScatterplotLayer({
        id: 'sats-fallback',
        data,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        radiusUnits: 'meters',
        getRadius: 90000,
        radiusMinPixels: 2,
        radiusMaxPixels: 20,
        parameters: { depthTest: false, depthMask: false },
        pickable: false
      })

      const layers: any[] = []
      // まず円を入れて確実に見せる
      layers.push(fallbackPoints)
      // アイコンが準備できたら必ず最後に入れて前面へ
      if (sphereImpostors) layers.push(sphereImpostors)
      if (data.length >= 1) {
        if (pathTick % 10 === 0) {
          const paths = satrecs.slice(0, 3).map((s) => {
            const pts: [number, number, number][] = []
            for (let t = 0; t <= 90 * 60; t += 60) {
              const dt = new Date(now.getTime() + t * 1000)
              const gmstT = gstime(dt)
              const pvT = propagate(s.rec, dt)
              const posT = pvT?.position
              if (!posT) continue
              const gdT = eciToGeodetic(posT, gmstT)
              const latT = degreesLat(gdT.latitude)
              const lonT = degreesLong(gdT.longitude)
              const altMT = Math.max(0, (gdT.height ?? 0) * 1000)
              const altScaledMT = scaleAltitudeLog(altMT)
              pts.push([lonT, latT, altScaledMT])
            }
            return { path: pts }
          })
          const layerPath = new PathLayer({
            id: 'sats-path',
            data: paths,
            coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
            getPath: (d: any) => d.path,
            widthUnits: 'meters',
            getWidth: 20000,
            getColor: [255, 200, 120, 120],
            parameters: { depthTest: true, depthMask: false },
            wrapLongitude: true
          })
          layers.push(layerPath)
        }
        pathTick++
      }
      overlayRef.current?.setProps({ layers, clearCanvas: false })
    }
    tick()
    const t = setInterval(() => alive && tick(), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [ready, satrecs, typesBySatnum, iconAtlasUrl])

  return <div ref={divRef} style={{ height: '75vh', borderRadius: 8, overflow: 'hidden' }} />
}
