import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap, GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection, Feature, Point } from 'geojson'
import { twoline2satrec, propagate, eciToGeodetic, degreesLat, degreesLong, gstime } from 'satellite.js'

type Tle = { name?: string; l1: string; l2: string }

const STYLE = 'https://demotiles.maplibre.org/style.json'

const buildGeoJson = (coords: Array<{ lon: number; lat: number; h?: number; id: string }>): FeatureCollection => ({
  type: 'FeatureCollection',
  features: coords.map((c) => ({
    type: 'Feature',
    id: c.id,
    properties: { id: c.id, h: c.h ?? 0 },
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] } as Point
  })) as Feature[]
})

export const MapLibreGlobe: React.FC<{ tles: Tle[] }> = ({ tles }) => {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)

  const satrecs = useMemo(() => {
    return tles.slice(0, 200).map((t) => {
      try {
        const rec = twoline2satrec(t.l1, t.l2)
        const id = t.name ?? (rec as any).satnum?.toString() ?? Math.random().toString(36).slice(2)
        return { id, rec }
      } catch {
        return null
      }
    }).filter(Boolean) as Array<{ id: string; rec: any }>
  }, [tles])

  useEffect(() => {
    if (!divRef.current) return
    const map = new maplibregl.Map({
      container: divRef.current,
      style: STYLE,
      center: [140, 35],
      zoom: 1.2,
      pitch: 0,
      bearing: 0,
      projection: 'globe' as any,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      setReady(true)
    })
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Add and update sat points
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const map = mapRef.current
    const srcId = 'sats'
    const layerId = 'sats-point'
    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: layerId, type: 'circle', source: srcId, paint: { 'circle-radius': 3, 'circle-color': '#ff3b3b', 'circle-opacity': 0.9 } })
    }
    let alive = true
    const tick = () => {
      const now = new Date()
      const gmst = gstime(now)
      const coords: Array<{ lon: number; lat: number; h?: number; id: string }>= []
      for (const s of satrecs) {
        const pv = propagate(s.rec, now)
        const pos = pv?.position
        if (!pos) continue
        const gd = eciToGeodetic(pos, gmst)
        coords.push({ id: s.id, lat: degreesLat(gd.latitude), lon: degreesLong(gd.longitude), h: gd.height })
      }
      const gj = buildGeoJson(coords)
      const src = map.getSource(srcId) as GeoJSONSource
      src.setData(gj)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [ready, satrecs])

  return <div ref={divRef} style={{ height: '75vh', borderRadius: 8, overflow: 'hidden' }} />
}
