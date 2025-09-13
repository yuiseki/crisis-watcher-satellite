import React, { useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, NavigationControl, Source } from 'react-map-gl/maplibre'
import type { MapRef } from 'react-map-gl'
import type { FeatureCollection, Feature, Point } from 'geojson'
import type { Map as MlMap } from 'maplibre-gl'
import {
  json2satrec,
  propagate,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  gstime
} from 'satellite.js'

type Omm = Record<string, any>

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

export const MapGlobe: React.FC<{ omms: Omm[] }> = ({ omms }) => {
  const mapRef = useRef<MapRef | null>(null)
  const [mlMap, setMlMap] = useState<MlMap | null>(null)
  const [points, setPoints] = useState<FeatureCollection>({ type: 'FeatureCollection', features: [] })

  // Prepare satrecs for a subset to keep it light
  const satrecs = useMemo(() => {
    return omms.slice(0, 200).map((o) => {
      try {
        return { id: String(o.OBJECT_ID ?? o.OBJECT_NAME ?? Math.random()), rec: json2satrec(o) }
      } catch {
        return null
      }
    }).filter(Boolean) as Array<{ id: string; rec: any }>
  }, [omms])

  // Update current positions every second
  useEffect(() => {
    let alive = true
    const tick = () => {
      const now = new Date()
      const gmst = gstime(now)
      const coords: Array<{ lon: number; lat: number; h?: number; id: string }> = []
      for (const s of satrecs) {
        const pv = propagate(s.rec, now)
        const pos = pv?.position
        if (!pos) continue
        const gd = eciToGeodetic(pos, gmst)
        const lat = degreesLat(gd.latitude)
        const lon = degreesLong(gd.longitude)
        coords.push({ id: s.id, lat, lon, h: gd.height })
      }
      if (alive) setPoints(buildGeoJson(coords))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [satrecs])

  return (
    <div style={{ height: '75vh', borderRadius: 8, overflow: 'hidden' }}>
      <Map
        ref={(r) => (mapRef.current = r)}
        onLoad={(e) => setMlMap(e.target)}
        reuseMaps
        mapStyle={STYLE}
        // Globe projection (MapLibre 5+)
        projection={{ name: 'globe' as any }}
        initialViewState={{ longitude: 140, latitude: 35, zoom: 1.2 }}
        dragRotate
      >
        <NavigationControl visualizePitch position="top-right" />

        <Source id="sats" type="geojson" data={points}>
          <Layer
            id="sats-point"
            type="circle"
            paint={{ 'circle-radius': 3, 'circle-color': '#ff3b3b', 'circle-opacity': 0.9 }}
          />
        </Source>
      </Map>
    </div>
  )
}
