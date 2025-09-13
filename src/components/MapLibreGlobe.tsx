import React, { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { Map as MlMap, GeoJSONSource, MercatorCoordinate } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, Feature, Point } from 'geojson'
import { twoline2satrec, propagate, eciToGeodetic, degreesLat, degreesLong, gstime } from 'satellite.js'
import { createSatellitePointLayer } from '../lib/SatellitePointLayer'

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

export const MapLibreGlobe: React.FC<{ tles: Tle[] }> = ({ tles }) => {
  const divRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<MlMap | null>(null)
  const [ready, setReady] = useState(false)
  const satLayerRef = useRef<any | null>(null)

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
      style: STYLE_RASTER_GLOBE,
      center: [140, 35],
      zoom: 1.2,
      pitch: 0,
      bearing: 0,
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      // Add custom 3D point layer
      const satLayer = createSatellitePointLayer('sats-3d')
      map.addLayer(satLayer)
      satLayerRef.current = satLayer
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
      // Update 3D space points via custom layer (altitude in meters)
      const world = coords.map((c) => {
        const altM = (c.hKm ?? 0) * 1000
        const m = MercatorCoordinate.fromLngLat([c.lon, c.lat], altM)
        return { x: m.x, y: m.y, z: m.z }
      })
      if (satLayerRef.current && satLayerRef.current.setPositions) {
        satLayerRef.current.setPositions(world)
      }
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
