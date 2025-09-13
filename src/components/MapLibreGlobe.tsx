import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers'
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { twoline2satrec, propagate, eciToGeodetic, degreesLat, degreesLong, gstime } from 'satellite.js'

type Tle = { name?: string; l1: string; l2: string }

const STYLE_RASTER_GLOBE: any = {
  version: 8,
  projection: { type: 'globe' },
  sources: { osm: { type: 'raster', tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 } },
  layers: [{ id: 'base', type: 'raster', source: 'osm' }]
}

function pickColorByType(objectType: string, name: string, altKm: number): [number, number, number, number] {
  const t = (objectType || '').toUpperCase()
  const isNav = /(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|BDS|IRNSS|QZSS)/i.test(name)
  const isGEO = altKm > 30000
  if (isNav) return [46, 204, 113, 255]
  if (isGEO) return [167, 139, 250, 255]
  if (t.includes('PAYLOAD')) return [255, 209, 102, 255]
  if (t.includes('ROCKET')) return [248, 150, 30, 255]
  if (t.includes('DEBRIS')) return [158, 158, 158, 255]
  return [0, 212, 255, 255]
}

export const MapLibreGlobe: React.FC<{ tles: Tle[]; typesBySatnum?: Record<number, string> }> = ({ tles, typesBySatnum = {} }) => {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const overlayRef = useRef<MapboxOverlay | null>(null)
  const [ready, setReady] = useState(false)

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
      setReady(true)
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    if (!ready || !overlayRef.current) return
    let alive = true
    let pathTick = 0
    const tick = () => {
      const now = new Date()
      const gmst = gstime(now)
      const data = satrecs.map((s) => {
        const pv = propagate(s.rec, now)
        const pos = pv?.position
        if (!pos) return null
        const gd = eciToGeodetic(pos, gmst)
        const lat = degreesLat(gd.latitude)
        const lon = degreesLong(gd.longitude)
        const altM = Math.max(0, (gd.height ?? 0) * 1000)
        const typ = (s.satnum && typesBySatnum[s.satnum]) || ''
        const color = pickColorByType(typ, s.id, gd.height ?? 0)
        return { position: [lon, lat, altM], color }
      }).filter(Boolean) as Array<{ position: [number, number, number]; color: [number, number, number, number] }>

      const fallback = [{ position: [0, 0, 160_000], color: [255, 0, 0, 255] as [number, number, number, number] }]
      const layerPoints = new ScatterplotLayer({
        id: 'sats-3d',
        data: data.length ? data : fallback,
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        radiusUnits: 'meters',
        getRadius: 60000,
        parameters: { depthTest: true, depthMask: true },
        pickable: false
      })

      // Simple orbit preview for first 3 satellites (next 90 min, 60s step)
      const layers: any[] = [layerPoints]
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
              pts.push([lonT, latT, altMT])
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
            getColor: [255, 255, 255, 80],
            parameters: { depthTest: true, depthMask: false },
            wrapLongitude: true
          })
          layers.push(layerPath)
        }
        pathTick++
      }
      overlayRef.current?.setProps({ layers })
    }
    tick()
    const t = setInterval(() => alive && tick(), 1000)
    return () => { alive = false; clearInterval(t) }
  }, [ready, satrecs, typesBySatnum])

  return <div ref={divRef} style={{ height: '75vh', borderRadius: 8, overflow: 'hidden' }} />
}
