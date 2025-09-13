import React, { useEffect, useState } from 'react'
import { MapLibreGlobe } from './components/MapLibreGlobe'

type SatIndex = {
  generatedAt: string
  timeZone: string
  hourPath: string
  counts: { gpActive: number; satcatOnOrbitPayloads: number; supgpSpacex: number }
  files: { gpActive: string; satcatOnOrbitPayloads: string; supgpSpacex: string }
}

export default function App() {
  const [data, setData] = useState<SatIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Follow sibling repos: fetch relative to site root (public/ is auto-served)
  const url = `data/latest/index.json`

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as SatIndex
        if (!alive) return
        setData(json)
      } catch (e: any) {
        if (!alive) return
        setError(e?.message ?? String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [url])

  if (loading) return <div>Loading…</div>
  if (error) return <div>Error: {error}</div>
  if (!data) return <div>No data</div>

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>人工衛星 軌道要素スナップショット（最新）</h1>
      <p>
        生成: <code>{data.generatedAt}</code> / 時間帯: <code>{data.hourPath}</code>
      </p>
      <ul>
        <li>gp_active 件数: <b>{data.counts.gpActive}</b></li>
        <li>satcat_onorbit_payloads 行数: <b>{data.counts.satcatOnOrbitPayloads}</b></li>
        <li>supgp_spacex 件数: <b>{data.counts.supgpSpacex}</b></li>
      </ul>
      <p>最新ファイル:</p>
      <ul>
        <li>
          <a href={`data/latest/${data.files.gpActive}`} target="_blank" rel="noreferrer">
            {data.files.gpActive}
          </a>
        </li>
        <li>
          <a href={`data/latest/${data.files.satcatOnOrbitPayloads}`} target="_blank" rel="noreferrer">
            {data.files.satcatOnOrbitPayloads}
          </a>
        </li>
        <li>
          <a href={`data/latest/${data.files.supgpSpacex}`} target="_blank" rel="noreferrer">
            {data.files.supgpSpacex}
          </a>
        </li>
      </ul>

      {/* Globe visualization using a subset of OMM objects */}
      <section style={{ marginTop: 16 }}>
        <h2>Globe</h2>
        <LoadTleAndRender />
      </section>
    </div>
  )
}

const LoadTleAndRender: React.FC = () => {
  const [tles, setTles] = useState<Array<{ name?: string; l1: string; l2: string }> | null>(null)
  const [typesBySatnum, setTypesBySatnum] = useState<Record<number, string>>({})
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      try {
        const [tleRes, gpRes] = await Promise.all([
          fetch('data/latest/gp_active.tle'),
          fetch('data/latest/gp_active.json')
        ])
        if (!tleRes.ok) throw new Error(`HTTP ${tleRes.status}`)
        const text = await tleRes.text()
        const lines = text.split(/\r?\n/)
        const out: Array<{ name?: string; l1: string; l2: string }> = []
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          if (line.startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
            const name = i > 0 && !lines[i - 1].startsWith('1 ') && !lines[i - 1].startsWith('2 ') ? lines[i - 1].trim() : undefined
            out.push({ name, l1: line, l2: lines[i + 1].trim() })
            i++
          }
        }
        setTles(out)
        if (gpRes.ok) {
          const gp = await gpRes.json()
          const map: Record<number, string> = {}
          for (const o of gp as any[]) {
            const satnum = Number(o.NORAD_CAT_ID)
            const typ = String(o.OBJECT_TYPE || '')
            if (!Number.isNaN(satnum)) map[satnum] = typ
          }
          setTypesBySatnum(map)
        }
      } catch (e: any) {
        setErr(e?.message ?? String(e))
      }
    })()
  }, [])
  if (err) return <div>Error loading TLE: {err}</div>
  if (!tles) return <div>Loading TLE…</div>
  return <MapLibreGlobe tles={tles} typesBySatnum={typesBySatnum} />
}
