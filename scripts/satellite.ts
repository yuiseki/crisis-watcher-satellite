import fs from 'fs/promises';
import path from 'path';

type Json = any;

const CEL_BASE = 'https://celestrak.org';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJsonWithRetry(url: string, retries = 2, backoffMs = 1000): Promise<Json | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'crisis-watcher-satellite/0.1 (+https://github.com/yuiseki/crisis-watcher-satellite)',
          'Accept': 'application/json'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries) {
        console.warn(`fetch error (${url}):`, (e as Error).message);
        return null;
      }
      await sleep(backoffMs * Math.pow(2, i));
    }
  }
  return null;
}

function buildHourlyDirPathJST() {
  const nowUtc = new Date();
  const jst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = String(jst.getUTCFullYear());
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const hourPath = `${yyyy}/${mm}/${dd}/${hh}`;
  const dir = path.join(process.cwd(), 'public', 'data', yyyy, mm, dd, hh);
  const latestDir = path.join(process.cwd(), 'public', 'data', 'latest');
  return { dir, latestDir, hourPath, generatedAt: nowUtc.toISOString() };
}

async function writeJsonFile(filepath: string, data: any) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

async function run() {
  const { dir, latestDir, hourPath, generatedAt } = buildHourlyDirPathJST();

  const urls = {
    gpActive: `${CEL_BASE}/NORAD/elements/gp.php?GROUP=active&FORMAT=json`,
    gpActiveTle: `${CEL_BASE}/NORAD/elements/gp.php?GROUP=active&FORMAT=tle`,
    // SATCAT JSON can be finicky; CSV endpoint is reliable
    satcatOnOrbitPayloadsCsv: `${CEL_BASE}/satcat/records.php?ONORBIT=1&PAYLOADS=1&FORMAT=CSV`,
    supgpSpacex: `${CEL_BASE}/NORAD/supplemental/sup-gp.php?SOURCE=SpaceX-E&FORMAT=json`,
  } as const;

  console.log('Fetching CelesTrak datasets...');
  const [gpActive, gpActiveTle, satcatCsv, supgp] = await Promise.all([
    fetchJsonWithRetry(urls.gpActive, 2, 1000),
    (async () => {
      // fetch TLE as text
      const url = urls.gpActiveTle;
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'crisis-watcher-satellite/0.1' }});
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } catch (e) {
          if (i === 2) {
            console.warn(`fetch error (${url}):`, (e as Error).message);
            return null;
          }
          await sleep(1000 * (i + 1));
        }
      }
      return null;
    })(),
    (async () => {
      // fetch CSV as text with basic retry
      const url = urls.satcatOnOrbitPayloadsCsv;
      for (let i = 0; i < 3; i++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'crisis-watcher-satellite/0.1' }});
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } catch (e) {
          if (i === 2) {
            console.warn(`fetch error (${url}):`, (e as Error).message);
            return null;
          }
          await sleep(1000 * (i + 1));
        }
      }
      return null;
    })(),
    fetchJsonWithRetry(urls.supgpSpacex, 2, 1000),
  ]);

  // Persist raw datasets under the hour directory
  const gpPath = path.join(dir, 'gp_active.json');
  const gpTlePath = path.join(dir, 'gp_active.tle');
  const satcatPath = path.join(dir, 'satcat_onorbit_payloads.csv');
  const supgpPath = path.join(dir, 'supgp_spacex.json');
  if (gpActive) await writeJsonFile(gpPath, gpActive);
  if (gpActiveTle) await fs.writeFile(gpTlePath, gpActiveTle, 'utf-8');
  if (satcatCsv) await fs.writeFile(satcatPath, satcatCsv, 'utf-8');
  if (supgp) await writeJsonFile(supgpPath, supgp);

  // Write index.json with meta and file references
  const meta = {
    generatedAt,
    timeZone: 'Asia/Tokyo',
    hourPath,
    sources: urls,
    counts: {
      gpActive: Array.isArray(gpActive) ? gpActive.length : 0,
      gpActiveTleLines: typeof gpActiveTle === 'string' ? Math.max(0, gpActiveTle.split(/\r?\n/).filter(Boolean).length) : 0,
      satcatOnOrbitPayloads: typeof satcatCsv === 'string' ? Math.max(0, satcatCsv.split(/\r?\n/).filter(Boolean).length - 1) : 0,
      supgpSpacex: Array.isArray(supgp) ? supgp.length : 0,
    },
    files: {
      gpActive: 'gp_active.json',
      gpActiveTle: 'gp_active.tle',
      satcatOnOrbitPayloads: 'satcat_onorbit_payloads.csv',
      supgpSpacex: 'supgp_spacex.json',
    },
  };
  await writeJsonFile(path.join(dir, 'index.json'), meta);
  console.log(`wrote snapshot: ${dir}`);

  // Update latest mirror
  await fs.mkdir(latestDir, { recursive: true });
  await writeJsonFile(path.join(latestDir, 'index.json'), meta);
  if (gpActive) await writeJsonFile(path.join(latestDir, 'gp_active.json'), gpActive);
  if (gpActiveTle) await fs.writeFile(path.join(latestDir, 'gp_active.tle'), gpActiveTle, 'utf-8');
  if (satcatCsv) await fs.writeFile(path.join(latestDir, 'satcat_onorbit_payloads.csv'), satcatCsv, 'utf-8');
  if (supgp) await writeJsonFile(path.join(latestDir, 'supgp_spacex.json'), supgp);
  console.log(`updated latest: ${latestDir}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
