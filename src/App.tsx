import React, { useEffect, useState } from 'react';

type IndexMeta = {
  generatedAt: string;
  timeZone: string;
  hourPath: string;
  counts: { gpActive: number; satcatOnOrbitPayloads: number; supgpSpacex: number };
  files: { gpActive: string; satcatOnOrbitPayloads: string; supgpSpacex: string };
};

export default function App() {
  const [meta, setMeta] = useState<IndexMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL}public/data/latest/index.json`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setMeta)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>crisis-watcher-satellite</h1>
      <p>最新スナップショットの概要を表示します。</p>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      {!meta && !error && <p>Loading...</p>}
      {meta && (
        <section>
          <p>
            generatedAt: <code>{meta.generatedAt}</code> / hourPath: <code>{meta.hourPath}</code>
          </p>
          <ul>
            <li>gp_active count: <strong>{meta.counts.gpActive}</strong></li>
            <li>satcat_onorbit_payloads lines: <strong>{meta.counts.satcatOnOrbitPayloads}</strong></li>
            <li>supgp_spacex count: <strong>{meta.counts.supgpSpacex}</strong></li>
          </ul>
          <p>Files (latest):</p>
          <ul>
            <li>
              <a href={`${import.meta.env.BASE_URL}public/data/latest/${meta.files.gpActive}`} target="_blank" rel="noreferrer">
                {meta.files.gpActive}
              </a>
            </li>
            <li>
              <a href={`${import.meta.env.BASE_URL}public/data/latest/${meta.files.satcatOnOrbitPayloads}`} target="_blank" rel="noreferrer">
                {meta.files.satcatOnOrbitPayloads}
              </a>
            </li>
            <li>
              <a href={`${import.meta.env.BASE_URL}public/data/latest/${meta.files.supgpSpacex}`} target="_blank" rel="noreferrer">
                {meta.files.supgpSpacex}
              </a>
            </li>
          </ul>
        </section>
      )}
    </main>
  );
}

