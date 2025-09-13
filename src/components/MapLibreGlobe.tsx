import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap, GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Feature, Point } from 'geojson'
import { twoline2satrec, propagate, eciToGeodetic, degreesLat, degreesLong, gstime } from 'satellite.js'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import { COORDINATE_SYSTEM } from '@deck.gl/core'

type Tle = { name?: string; l1: string; l2: string }

const STYLE_RASTER_GLOBE: any = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg'
      ],
      tileSize: 256,
      attribution: 'Imagery © EOX | s2cloudless-2020'
    }
  },
  layers: [
    { id: 'satellite', type: 'raster', source: 'satellite' }
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
  light: { anchor: 'map', position: [1.5, 90, 80] }
}

function pickColorByType(objectType: string, name: string, altKm: number) {
  const t = objectType.toUpperCase()
  // GNSS and nav constellations
  const isNav = /(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|BDS|IRNSS|QZSS)/i.test(name)
  // Orbit regime heuristics
  const isGEO = altKm > 30000
  // Palette
  const colors = {
    payload: [1.00, 0.82, 0.40], // #ffd166
    rocket: [0.97, 0.59, 0.12],  // #f8961e
    debris: [0.62, 0.62, 0.62],  // #9e9e9e
    nav: [0.18, 0.80, 0.44],     // #2ecc71
    geo: [0.66, 0.55, 0.98],     // #a78bfa
    other: [0.00, 0.83, 1.00]    // #00d4ff
  }
  if (isNav) return { r: colors.nav[0], g: colors.nav[1], b: colors.nav[2] }
  if (isGEO) return { r: colors.geo[0], g: colors.geo[1], b: colors.geo[2] }
  if (t.includes('PAYLOAD')) return { r: colors.payload[0], g: colors.payload[1], b: colors.payload[2] }
  if (t.includes('ROCKET')) return { r: colors.rocket[0], g: colors.rocket[1], b: colors.rocket[2] }
  if (t.includes('DEBRIS')) return { r: colors.debris[0], g: colors.debris[1], b: colors.debris[2] }
  return { r: colors.other[0], g: colors.other[1], b: colors.other[2] }
}

const buildGeoJson = (
  coords: Array<{ lon: number; lat: number; hKm?: number; id: string; name?: string }>
): FeatureCollection => ({
  type: 'FeatureCollection',
  features: coords.map((c) => ({
    type: 'Feature',
    id: c.id,
    properties: { id: c.id, name: c.name ?? c.id, alt_km: c.hKm ?? 0 },
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] } as Point
  })) as Feature[]
})

export const MapLibreGlobe: React.FC<{ tles: Tle[]; typesBySatnum?: Record<number, string> }> = ({ tles, typesBySatnum = {} }) => {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const overlayRef = useRef<MapboxOverlay | null>(null)

  const satrecs = useMemo(() => {
    return tles.slice(0, 200).map((t) => {
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
    const map = new maplibregl.Map({
      container: divRef.current,
      style: STYLE_RASTER_GLOBE,
      center: [140, 35],
      zoom: 1.2,
      pitch: 0,
      bearing: 0,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      // deck.gl overlay interleaved with globe
      const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
      map.addControl(overlay as any)
      overlayRef.current = overlay
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
      // Circle size and color reflect altitude (km)
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: srcId,
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'alt_km'],
            0, 2,
            400, 3,
            2000, 6
          ],
          'circle-color': [
            'interpolate', ['linear'], ['get', 'alt_km'],
            0, '#4ea1ff',
            400, '#00d084',
            2000, '#ff3b3b'
          ],
          'circle-opacity': 0.9
        }
      })
      // Optional labels: altitude in km (small)
      map.addLayer({
        id: 'sats-label',
        type: 'symbol',
        source: srcId,
        layout: {
          'text-field': ['concat', ['to-string', ['round', ['get', 'alt_km']]], ' km'],
          'text-size': 10,
          'text-offset': [0, 1.2]
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 0.8 }
      })
      // Hover popup with name + altitude
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
      const enter = (e: any) => {
        const f = e.features?.[0]
        if (!f) return
        const name = f.properties?.name ?? ''
        const alt = f.properties?.alt_km ?? 0
        popup.setLngLat(e.lngLat).setHTML(`<div style="font: 12px sans-serif;">${name}<br/>alt: ${Math.round(alt)} km</div>`).addTo(map)
        map.getCanvas().style.cursor = 'pointer'
      }
      const move = (e: any) => {
        if (!popup.isOpen()) return
        popup.setLngLat(e.lngLat)
      }
      const leave = () => {
        popup.remove()
        map.getCanvas().style.cursor = ''
      }
      map.on('mouseenter', layerId, enter)
      map.on('mousemove', layerId, move)
      map.on('mouseleave', layerId, leave)
    }
    let alive = true
    const tick = () => {
      const now = new Date()
      const gmst = gstime(now)
      const coords: Array<{ lon: number; lat: number; hKm?: number; id: string; name?: string }>= []
      for (const s of satrecs) {
        const pv = propagate(s.rec, now)
        const pos = pv?.position
        if (!pos) continue
        const gd = eciToGeodetic(pos, gmst)
        coords.push({ id: s.id, name: s.id, lat: degreesLat(gd.latitude), lon: degreesLong(gd.longitude), hKm: gd.height })
      }
      const gj = buildGeoJson(coords)
      const src = map.getSource(srcId) as GeoJSONSource
      src.setData(gj)
      // Build deck.gl scatter layer: position [lon,lat,alt(m)]
      const scatter = new ScatterplotLayer({
        id: 'sats-scatter',
        data: coords.map((c, idx) => {
          const sr = satrecs[idx]
          const typ = (sr?.satnum && typesBySatnum[sr.satnum]) || ''
          const name = c.name || ''
          const { r, g, b } = pickColorByType(typ, name, c.hKm ?? 0)
          return { position: [c.lon, c.lat, Math.max(0, (c.hKm ?? 0) * 1000)], color: [Math.round(r*255), Math.round(g*255), Math.round(b*255), 255] }
        }),
        coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => d.color,
        radiusUnits: 'meters',
        getRadius: 60000,
        parameters: { depthTest: true },
        pickable: false
      })
      overlayRef.current?.setProps({ layers: [scatter] })
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
