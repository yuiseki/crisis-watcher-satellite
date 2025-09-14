import React, { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { SphereGeometry } from "@luma.gl/engine";
import {
  twoline2satrec,
  propagate,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  gstime,
} from "satellite.js";
// Render true spheres for satellites via SimpleMeshLayer + luma.gl SphereGeometry

type Tle = { name?: string; l1: string; l2: string };

const STYLE_RASTER_GLOBE: any = {
  version: 8,
  projection: { type: "globe" },
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
    },
  },
  layers: [{ id: "Satellite", type: "raster", source: "satellite" }],
  sky: {
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0],
  },
  light: {
    anchor: "map",
    position: [1.5, 90, 80],
  },
};

function pickColorByType(
  objectType: string,
  name: string,
  altKm: number
): [number, number, number, number] {
  // Category-first coloring: NAV=red, GEO=yellow, OTHER=orange
  const cat = pickCategory(objectType, name, altKm);
  switch (cat) {
    case "NAV":
      return [255, 80, 80, 255]; // red
    case "GEO":
      return [255, 220, 0, 255]; // yellow
    case "OTHER":
      return [255, 150, 50, 255]; // orange
    case "PAYLOAD":
    case "ROCKET":
    case "DEBRIS":
    default:
      return [255, 150, 50, 255]; // treat as orange by default
  }
}

function pickCategory(
  objectType: string,
  name: string,
  altKm: number
): "NAV" | "GEO" | "PAYLOAD" | "ROCKET" | "DEBRIS" | "OTHER" {
  const t = (objectType || "").toUpperCase();
  const isNav = /(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU|BDS|IRNSS|QZSS)/i.test(
    name
  );
  const isGEO = altKm > 30000;
  if (isNav) return "NAV";
  if (isGEO) return "GEO";
  if (t.includes("PAYLOAD")) return "PAYLOAD";
  if (t.includes("ROCKET")) return "ROCKET";
  if (t.includes("DEBRIS")) return "DEBRIS";
  return "OTHER";
}

export const MapLibreGlobe: React.FC<{
  tles: Tle[];
  typesBySatnum?: Record<number, string>;
}> = ({ tles, typesBySatnum = {} }) => {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [ready, setReady] = useState(false);

  // Unit sphere; scaled per-instance for a small visual size in meters
  const sphere = useMemo(
    () => new SphereGeometry({ radius: 2.5, nlat: 12, nlong: 24 }),
    []
  );

  const satrecs = useMemo(() => {
    return tles
      .slice(0, 300)
      .map((t) => {
        try {
          const rec = twoline2satrec(t.l1, t.l2);
          const satnum = (rec as any).satnum as number | undefined;
          const id =
            t.name ?? satnum?.toString() ?? Math.random().toString(36).slice(2);
          return { id, rec, satnum };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ id: string; rec: any; satnum?: number }>;
  }, [tles]);

  useEffect(() => {
    if (!divRef.current) return;
    const map = new maplibregl.Map({
      container: divRef.current,
      style: STYLE_RASTER_GLOBE,
      center: [140, 35],
      zoom: 1.6,
    });
    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
        visualizeRoll: true,
      }),
      "top-right"
    );
    map.once("load", () => {
      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: [],
      }) as any;
      map.addControl(overlay);
      overlayRef.current = overlay;
      try {
        overlayRef.current?.setProps({ clearCanvas: false });
      } catch {}
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !overlayRef.current) return;
    let alive = true;
    let summaryTick = 0;
    // Piecewise altitude scaling: place LEO/MEO/GEO at controllable shell fractions
    const ATMOSPHERE_TOP_M = 120_000; // ~120 km from surface
    const SHELL_THICKNESS_M = 300_000; // ~300 km visual shell
    // Physical anchors (m)
    const LEO_MAX_M = 2_000_000; // ~2,000 km
    const MEO_MAX_M = 20_200_000; // ~20,200 km (GNSS)
    const GEO_ALT_M = 35_786_000; // ~35,786 km (GEO)
    // Visual anchors (fraction of shell)
    const LEO_FRAC = 0.25; // 0..25% of shell for LEO
    const MEO_FRAC = 0.6; // up to 60% for MEO
    // Per-band gamma: <1 expands, >1 compresses
    const GAMMA_LEO = 0.7;
    const GAMMA_MEO = 0.9;
    const GAMMA_GEO = 1.2;
    const scaleAltitudeLog = (altM: number) => {
      const a = Math.max(0, Math.min(altM, GEO_ALT_M));
      let f = 0;
      if (a <= LEO_MAX_M) {
        const t = a / LEO_MAX_M;
        f = Math.pow(t, GAMMA_LEO) * LEO_FRAC;
      } else if (a <= MEO_MAX_M) {
        const t = (a - LEO_MAX_M) / (MEO_MAX_M - LEO_MAX_M);
        f = LEO_FRAC + Math.pow(t, GAMMA_MEO) * (MEO_FRAC - LEO_FRAC);
      } else {
        const t = (a - MEO_MAX_M) / (GEO_ALT_M - MEO_MAX_M);
        f = MEO_FRAC + Math.pow(t, GAMMA_GEO) * (1 - MEO_FRAC);
      }
      return ATMOSPHERE_TOP_M + f * SHELL_THICKNESS_M;
    };
    const tick = () => {
      const now = new Date();
      const gmst = gstime(now);
      const counts = {
        NAV: 0,
        GEO: 0,
        PAYLOAD: 0,
        ROCKET: 0,
        DEBRIS: 0,
        OTHER: 0,
      };
      const rawTypeCounts: Record<string, number> = {};
      const otherTypeCounts: Record<string, number> = {};
      let otherEmptyType = 0;
      const data = satrecs
        .map((s) => {
          const pv = propagate(s.rec, now);
          const pos = pv?.position;
          if (!pos) return null;
          const gd = eciToGeodetic(pos, gmst);
          const lat = degreesLat(gd.latitude);
          const lon = degreesLong(gd.longitude);
          const altM = Math.max(0, (gd.height ?? 0) * 1000);
          const altScaledM = scaleAltitudeLog(altM);
          const typ = (s.satnum && typesBySatnum[s.satnum]) || "";
          const normTyp = (typ || "").toString().trim().toUpperCase();
          if (normTyp)
            rawTypeCounts[normTyp] = (rawTypeCounts[normTyp] || 0) + 1;
          const cat = pickCategory(normTyp, s.id, gd.height ?? 0);
          counts[cat]++;
          if (cat === "OTHER") {
            if (normTyp)
              otherTypeCounts[normTyp] = (otherTypeCounts[normTyp] || 0) + 1;
            else otherEmptyType++;
          }
          const color = pickColorByType(typ, s.id, gd.height ?? 0);
          return { position: [lon, lat, altScaledM], color };
        })
        .filter(Boolean) as Array<{
        position: [number, number, number];
        color: [number, number, number, number];
      }>;

      // Debug: count + sample (kept lightweight)
      try {
        if ((data.length ?? 0) % 60 === 0) {
          // eslint-disable-next-line no-console
          console.debug(
            `[MapLibreGlobe] sats=`,
            data.length,
            `sample=`,
            data[0]?.position
          );
        }
      } catch {}

      // Category summary every 5 ticks + OTHER breakdown (top 6)
      try {
        summaryTick++;
        if (summaryTick % 5 === 0) {
          const total = Object.values(counts).reduce(
            (a, b) => a + (b as number),
            0
          );
          const parts = Object.entries(counts)
            .filter(([, v]) => (v as number) > 0)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
          const topOther = Object.entries(otherTypeCounts)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, 6)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
          const otherSuffix =
            topOther || otherEmptyType
              ? ` | OTHER breakdown: ${topOther}${
                  otherEmptyType ? ` EMPTY:${otherEmptyType}` : ""
                }`
              : "";
          // eslint-disable-next-line no-console
          console.debug(
            `[MapLibreGlobe] categories: ${parts} total:${total}${otherSuffix}`
          );
        }
      } catch {}

      // True sphere satellites via SimpleMeshLayer
      const layers: any[] = [
        new SimpleMeshLayer({
          id: "sats-mesh",
          data,
          mesh: sphere,
          coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
          getPosition: (d: any) => d.position, // [lng, lat, altitude(m)]
          getColor: (d: any) => d.color, // RGBA (0-255)
          getScale: () => [8000, 8000, 8000], // ~8km radius sphere
          pickable: true,
          parameters: { depthTest: true },
          material: { ambient: 0.2, diffuse: 0.8, shininess: 32 },
        }),
      ];
      overlayRef.current?.setProps({ layers, clearCanvas: false });
    };
    tick();
    const t = setInterval(() => alive && tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ready, satrecs, typesBySatnum, sphere]);

  return (
    <div
      ref={divRef}
      style={{ height: "75vh", borderRadius: 8, overflow: "hidden" }}
    />
  );
};
