import React, { useEffect, useState } from 'react'

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
    </div>
  )
}
