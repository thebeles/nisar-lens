import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, useLanguage } from '../../i18n.jsx';
import {
  ArrowUpRight,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Grid,
  LayoutGrid,
  Loader2,
  Maximize2,
  RadioTower,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { DiamondCrosshair } from '../../components/NisarLensElements.jsx';
import { SME2_L3_DATASET } from './sme2Data.js';
import BackscatterHistogram from './BackscatterHistogram.jsx';
import { getBrowseUrl, getLocalBrowseUrl } from './demoBrowse.js';
import { getGranuleSignature } from './catalog.js';

function valueOrDash(value) {
  return value == null || value === '' ? 'Not provided' : String(value);
}

function formatCoord(val, isLat) {
  const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
  return `${Math.abs(val).toFixed(3)}° ${dir}`;
}

function centerOf(feature) {
  const points = feature?.geometry?.coordinates?.[0] ?? [];
  if (!points.length) return null;
  const validPoints = points.slice(0, -1).length > 0 ? points.slice(0, -1) : points;
  const totals = validPoints.reduce((sum, [lon, lat]) => [sum[0] + lon, sum[1] + lat], [0, 0]);
  const count = Math.max(validPoints.length, 1);
  const avgLon = totals[0] / count;
  const avgLat = totals[1] / count;
  return `${formatCoord(avgLat, true)}, ${formatCoord(avgLon, false)}`;
}

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num >= 1_073_741_824) return `${(num / 1_073_741_824).toFixed(2)} GB`;
  if (num >= 1_048_576) return `${(num / 1_048_576).toFixed(1)} MB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${num} B`;
}

function proxyAssetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  return `/api/earthdata-asset?url=${encodeURIComponent(rawUrl)}`;
}

function labelForBrowseUrl(url, index) {
  if (typeof url !== 'string') return `BROWSE ${index + 1}`;
  const match = /_NATIVE_([AB])_([HV]{4})/i.exec(url);
  if (match) {
    return `FREQ ${match[1].toUpperCase()} · ${match[2].toUpperCase()}`;
  }
  if (url.endsWith('_BROWSE_LATLON.png')) return 'LATLON · COMPOSITE';
  if (url.endsWith('_LATLON.png')) return 'LATLON · GEOCODED';
  if (url.endsWith('_BROWSE.png')) return 'SAR OVERVIEW';
  return `VIEW ${index + 1}`;
}

function parseQaCsv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) return [];
  const lines = csvText
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const parts = line.split(',');
    const tool = parts[0]?.trim() || 'QA';
    const checkDesc = parts[1]?.trim() || 'QA check';
    const result = parts[2]?.trim() || 'PASS';
    const threshold = parts[3]?.trim() || '';
    const actual = parts[4]?.trim() || '';
    const notes = parts.slice(5).join(',').trim() || '';
    const valueLabel = actual
      ? `${actual}%${threshold ? ` (limit ${threshold}%)` : ''}`
      : 'Verified';
    return {
      dataset: notes || tool,
      description: checkDesc,
      check: checkDesc,
      result,
      value: valueLabel,
    };
  });
}

export default function RecordDetails({
  feature,
  detailsImageRequest = 0,
  drapeRadarOnGlobe = true,
  onToggleDrapeRadar,
  onFlyToSme2,
  onPinWatchpoint,
  isPinned = false,
  pinning = false,
  watchpoints = [],
  onSelectWatchpoint,
  onDeleteWatchpoint,
  activeId,
  isStudySaved = false,
  comparePair = null,
  changeProduct = null,
  activeThresholdDb = -18.0,
  onThresholdChange,
  onExitCompare,
}) {
  const [language] = useLanguage();
  const [copied, setCopied] = useState(false);
  const [granuleCopied, setGranuleCopied] = useState(false);
  const [selectedBrowseIdx, setSelectedBrowseIdx] = useState(0);
  const [browseLoaded, setBrowseLoaded] = useState(false);
  const [browseError, setBrowseError] = useState(false);
  const [qaRows, setQaRows] = useState([]);
  const [qaStatus, setQaStatus] = useState('idle');
  const [activeTab, setActiveTab] = useState(detailsImageRequest ? 'imagery' : 'details');
  useEffect(() => {
    if (detailsImageRequest) setActiveTab('imagery');
  }, [detailsImageRequest]);
  const copyTimeoutRef = useRef(null);
  const granuleCopyTimeoutRef = useRef(null);

  const copyGranuleId = async () => {
    const gid = feature?.properties?.granuleName ?? feature?.properties?.granuleUr ?? feature?.id;
    if (!gid || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(gid);
      setGranuleCopied(true);
      if (granuleCopyTimeoutRef.current) window.clearTimeout(granuleCopyTimeoutRef.current);
      granuleCopyTimeoutRef.current = window.setTimeout(() => setGranuleCopied(false), 2000);
    } catch {
      setGranuleCopied(false);
    }
  };

  const p = feature?.properties ?? {};

  // Deduplicate browse URLs while preserving distinct polarization/projection views
  const browseItems = useMemo(() => {
    if (!Array.isArray(p.browse)) return [];
    const seenUrls = new Set();
    const seenLabels = new Set();
    const list = [];
    p.browse.forEach((u, idx) => {
      if (typeof u !== 'string' || !/^https:\/\//i.test(u)) return;
      if (seenUrls.has(u)) return;
      seenUrls.add(u);
      let label = labelForBrowseUrl(u, idx);
      if (seenLabels.has(label)) {
        label = `${label} (${idx + 1})`;
      }
      seenLabels.add(label);
      list.push({ url: u, label });
    });
    return list;
  }, [p.browse]);

  const additionalUrls = useMemo(() => {
    const raw = p.nisar?.additionalUrls;
    return Array.isArray(raw)
      ? raw.filter((u) => typeof u === 'string' && /^https:\/\//i.test(u))
      : [];
  }, [p.nisar]);

  const qaCsvUrl = useMemo(
    () => additionalUrls.find((u) => u.endsWith('_QA_SUMMARY.csv')) ?? null,
    [additionalUrls]
  );
  const qaPdfUrl = useMemo(
    () => additionalUrls.find((u) => u.endsWith('_QA_REPORT.pdf')) ?? null,
    [additionalUrls]
  );
  const runConfigUrl = useMemo(
    () => additionalUrls.find((u) => u.endsWith('.rc.yaml')) ?? null,
    [additionalUrls]
  );
  const isoXmlUrl = useMemo(
    () => additionalUrls.find((u) => u.endsWith('.iso.xml')) ?? null,
    [additionalUrls]
  );

  useEffect(() => {
    setCopied(false);
    setSelectedBrowseIdx(0);
    setBrowseLoaded(false);
    setBrowseError(false);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    };
  }, [feature?.id]);

  // Fetch authenticated NASA Earthdata QA Summary CSV when available
  useEffect(() => {
    if (!qaCsvUrl) {
      setQaRows([]);
      setQaStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setQaStatus('loading');
    fetch(proxyAssetUrl(qaCsvUrl))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const parsed = parseQaCsv(text);
        setQaRows(parsed);
        setQaStatus(parsed.length ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!cancelled) {
          setQaRows([]);
          setQaStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [qaCsvUrl]);

  // Handle Multi-Temporal Change Mode when two granules are being compared
  if (comparePair?.granuleA && comparePair?.granuleB) {
    const granuleA = comparePair.granuleA;
    const granuleB = comparePair.granuleB;
    const pA = granuleA.properties ?? granuleA;
    const pB = granuleB.properties ?? granuleB;

    const idA = granuleA.id ?? pA.id ?? pA.granuleName;
    const idB = granuleB.id ?? pB.id ?? pB.granuleName;
    const dateA = pA.acquisitionDate ?? (pA.startTime ? pA.startTime.slice(0, 10) : 'Date A');
    const dateB = pB.acquisitionDate ?? (pB.startTime ? pB.startTime.slice(0, 10) : 'Date B');
    const { track, frame } = getGranuleSignature(granuleA);

    const stats = changeProduct.stats;
    const pixelShare = (count) => stats.totalValidPx
      ? `${(100 * count / stats.totalValidPx).toFixed(1)}%`
      : '—';

    const handleDownloadReport = () => {
      if (!changeProduct) return;
      const reportData = {
        title: 'NISAR Lens Multi-Temporal SAR Change Analysis Report',
        timestamp: new Date().toISOString(),
        method: 'LATLON browse PNG luminance aligned using overlapping footprint bounds, with 5×5 smoothing and relative threshold classification',
        interpretation: 'Footprint bounds approximate image positioning. Pixel classes describe relative preview brightness and do not measure water area.',
        sourceImages: changeProduct.source,
        granuleA: {
          id: idA,
          name: pA.granuleName,
          date: dateA,
          track,
          frame,
          direction: pA.flightDirection,
          polarization: pA.polarization,
          beamMode: pA.beamMode,
        },
        granuleB: {
          id: idB,
          name: pB.granuleName,
          date: dateB,
          track,
          frame,
          direction: pB.flightDirection,
          polarization: pB.polarization,
          beamMode: pB.beamMode,
        },
        relativeThreshold: activeThresholdDb,
        otsuA: changeProduct.otsuA,
        otsuB: changeProduct.otsuB,
        browsePixelStatistics: {
          belowThresholdBoth: stats.permanentWaterPx,
          belowThresholdOnlyB: stats.newWaterPx,
          belowThresholdOnlyA: stats.waterLostPx,
          validPixels: stats.totalValidPx,
        },
        boundsWgs84: changeProduct.bounds,
      };
      const blob = new Blob([JSON.stringify(reportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `NISAR_SAR_Change_Report_${dateA}_vs_${dateB}.json`;
      link.click();
      URL.revokeObjectURL(url);
    };

    const handleDownloadMask = () => {
      const [header, data] = changeProduct.waterClassDataUrl.split(',');
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      const type = header.slice(5, header.indexOf(';'));
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `NISAR_Browse_Brightness_Classes_${dateA}_vs_${dateB}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handlePinChangeStudy = () => {
      if (!onPinWatchpoint || !changeProduct) return;
      const studyWatchpoint = {
        title: `NISAR comparison: ${dateA} vs ${dateB}`,
        pinned_granule_id: `${idA}__VS__${idB}`,
        granuleIds: [idA, idB],
        product_type: `${pA.processingLevel ?? 'GCOV'} Change Pair`,
        latitude: (changeProduct.bounds.south + changeProduct.bounds.north) / 2,
        longitude: (changeProduct.bounds.west + changeProduct.bounds.east) / 2,
        notes: `Track ${track}, frame ${frame}. Illustrative comparison from browse PNGs.`,
        status: 'SAVED IN THIS BROWSER',
      };
      onPinWatchpoint(studyWatchpoint);
    };

    return (
      <div className="x-compare-studio">
        <style>{`
          .x-compare-studio {
            margin-top: 10px;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
            align-items: stretch;
          }
          .x-compare-pair-grid {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
          }
          .x-compare-granule-card {
            background: rgba(12, 12, 18, 0.75);
            border: 1px solid rgba(244, 244, 246, 0.09);
            border-radius: 10px;
            padding: 11px 13px;
          }
          .x-compare-granule-card.is-card-a {
            border-color: rgba(139, 92, 246, 0.4);
          }
          .x-compare-granule-card.is-card-b {
            border-color: rgba(225, 29, 72, 0.4);
          }
          .x-granule-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 6px;
          }
          .x-date-pill {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            letter-spacing: 0.04em;
          }
          .x-date-pill.is-pill-a {
            background: rgba(255, 255, 255, 0.08);
            color: #F4F4F6;
            border: 1px solid rgba(255, 255, 255, 0.22);
          }
          .x-date-pill.is-pill-b {
            background: rgba(225, 29, 72, 0.22);
            color: #FB7185;
            border: 1px solid rgba(225, 29, 72, 0.45);
          }
          .x-granule-date {
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            font-weight: 600;
            color: #F4F4F6;
          }
          .x-granule-name-box {
            font-family: 'JetBrains Mono', monospace;
            font-size: 10.5px;
            color: rgba(244, 244, 246, 0.7);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 8px;
          }
          .x-granule-mini-fields {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
          }
          .x-granule-mini-fields span {
            color: rgba(244, 244, 246, 0.5);
          }
          .x-granule-mini-fields strong {
            color: #F4F4F6;
            margin-left: 4px;
          }
          .x-orbit-verify-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(16, 185, 129, 0.12);
            border: 1px solid rgba(16, 185, 129, 0.35);
            padding: 8px 12px;
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 10.5px;
            color: #6EE7B7;
            margin-bottom: 12px;
          }
          .x-telemetry-cards-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            margin-bottom: 12px;
          }
          .x-telemetry-card {
            background: rgba(12, 12, 18, 0.75);
            border: 1px solid rgba(244, 244, 246, 0.1);
            border-radius: 10px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 3px;
          }
          .x-telemetry-card.is-perm {
            border-color: rgba(56, 189, 248, 0.4);
            background: rgba(56, 189, 248, 0.12);
          }
          .x-telemetry-card.is-new {
            border-color: rgba(225, 29, 72, 0.6);
            background: rgba(225, 29, 72, 0.14);
          }
          .x-telemetry-card.is-lost {
            border-color: rgba(245, 158, 11, 0.4);
            background: rgba(245, 158, 11, 0.12);
          }
          .x-telemetry-card.is-net {
            border-color: rgba(244, 244, 246, 0.3);
            background: rgba(244, 244, 246, 0.06);
          }
          .x-card-label {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 10px;
            font-weight: 700;
            color: rgba(244, 244, 246, 0.65);
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }
          .x-card-val {
            font-family: 'JetBrains Mono', monospace;
            font-size: 16px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }
          .x-card-sub {
            font-family: 'JetBrains Mono', monospace;
            font-size: 9px;
            color: rgba(244, 244, 246, 0.5);
          }
          .x-threshold-slider-box {
            background: rgba(8, 8, 12, 0.85);
            border: 1px solid rgba(244, 244, 246, 0.1);
            border-radius: 10px;
            padding: 10px 14px;
            margin-bottom: 12px;
          }
          .x-slider-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
          }
          .x-slider-label {
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: rgba(244, 244, 246, 0.85);
          }
          .x-slider-presets {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 5px;
          }
          .x-preset-pill {
            background: rgba(244, 244, 246, 0.06);
            border: 1px solid rgba(244, 244, 246, 0.14);
            color: rgba(244, 244, 246, 0.75);
            font-family: 'JetBrains Mono', monospace;
            font-size: 9.5px;
            font-weight: 600;
            height: 24px;
            padding: 0 8px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
            white-space: nowrap;
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
          }
          .x-preset-pill:hover {
            background: rgba(244, 244, 246, 0.14);
            color: #FFFFFF;
          }
          .x-preset-pill.is-active {
            background: #E11D48;
            border-color: #FB7185;
            color: #FFFFFF;
          }
          .x-threshold-range {
            width: 100%;
            accent-color: #E11D48;
            cursor: pointer;
            margin: 0;
          }
          .x-insar-math-card {
            background: rgba(10, 10, 16, 0.85);
            border: 1px solid rgba(139, 92, 246, 0.25);
            border-radius: 10px;
            padding: 12px 14px;
            margin-top: 8px;
          }
          .x-insar-formula {
            font-family: 'JetBrains Mono', monospace;
            font-size: 11.5px;
            font-weight: 700;
            color: #C4B5FD;
            background: rgba(139, 92, 246, 0.15);
            padding: 6px 10px;
            border-radius: 6px;
            margin-bottom: 8px;
            border: 1px solid rgba(139, 92, 246, 0.3);
          }
          .x-insar-explanation {
            font-size: 11.5px;
            line-height: 1.55;
            color: rgba(244, 244, 246, 0.75);
            margin: 0;
          }
          .x-physics-box {
            margin-top: 14px;
            border-top: 1px solid rgba(244, 244, 246, 0.08);
            padding-top: 12px;
          }
          .x-physics-cards {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .x-physics-item {
            background: rgba(12, 12, 18, 0.6);
            border: 1px solid rgba(244, 244, 246, 0.08);
            border-radius: 8px;
            padding: 9px 12px;
          }
          .x-physics-item strong {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 11px;
            color: #F4F4F6;
            display: block;
            margin-bottom: 4px;
          }
          .x-physics-item p {
            font-size: 11px;
            line-height: 1.5;
            color: rgba(244, 244, 246, 0.68);
            margin: 0;
          }
          .x-compare-actions-deck {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 12px;
          }
          .x-compare-export-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .x-export-sub-btn {
            flex: 1 1 140px;
            min-width: 0;
            white-space: nowrap;
            justify-content: center;
          }
          @media (max-width: 1180px) {
            .x-compare-studio {
              grid-template-columns: 1fr;
            }
          }
          @media (max-width: 500px) {
            .x-telemetry-cards-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>

        {/* COLUMN 1: 04 // MULTI-TEMPORAL PAIR & EXPORT */}
        <section
          className="explorer-panel x-details"
          aria-labelledby="x-compare-pair-title"
        >
          <div className="x-panel-heading">
            <div>
              <span className="x-eyebrow">
                <DiamondCrosshair />
                <span>
                  {stats.isCrossLocation
                    ? 'DUAL-REGION COMPARATIVE SAR STUDY'
                    : 'MULTI-TEMPORAL PAIR & EXPORT'}
                </span>
              </span>
              <h2 id="x-compare-pair-title">
                {stats.isCrossLocation
                  ? 'Cross-Location Radar Analysis'
                  : (language === 'ru' ? 'Снимки двух дат' : 'Two images, two dates')}
              </h2>
            </div>
            <span className="x-product-badge">
              {stats.isCrossLocation
                ? `CROSS-LOC (${stats.separationKm} km)`
                : `${pA.processingLevel ?? 'GCOV'} PAIR`}
            </span>
          </div>

          <div className="x-compare-pair-grid">
            <div className="x-compare-granule-card is-card-a">
              <div className="x-granule-card-header">
                <span className="x-date-pill is-pill-a">
                  {stats.isCrossLocation ? 'LOCATION A (REFERENCE)' : 'DATE A (REFERENCE)'}
                </span>
                <span className="x-granule-date">{dateA}</span>
              </div>
              <div className="x-granule-name-box" title={pA.granuleName}>
                {pA.granuleName ?? idA}
              </div>
              <div className="x-granule-mini-fields">
                <div><span>Pass:</span> <strong>{pA.flightDirection ?? 'ASC'}</strong></div>
                <div><span>Track / Frame:</span> <strong>{track} / {frame}</strong></div>
                <div><span>Polarization:</span> <strong>{pA.polarization ?? 'Dual-Pol'}</strong></div>
                <div><span>Start:</span> <strong>{pA.startTime ? pA.startTime.slice(11, 19) + ' UTC' : '—'}</strong></div>
              </div>
            </div>

            <div className="x-compare-granule-card is-card-b">
              <div className="x-granule-card-header">
                <span className="x-date-pill is-pill-b">
                  {stats.isCrossLocation ? 'LOCATION B (SECONDARY)' : 'DATE B (SECONDARY)'}
                </span>
                <span className="x-granule-date">{dateB}</span>
              </div>
              <div className="x-granule-name-box" title={pB.granuleName}>
                {pB.granuleName ?? idB}
              </div>
              <div className="x-granule-mini-fields">
                <div><span>Pass:</span> <strong>{pB.flightDirection ?? 'ASC'}</strong></div>
                <div><span>Track / Frame:</span> <strong>{pB.track ?? pB.pathNumber ?? '—'} / {pB.frameNumber ?? '—'}</strong></div>
                <div><span>Polarization:</span> <strong>{pB.polarization ?? 'Dual-Pol'}</strong></div>
                <div><span>Start:</span> <strong>{pB.startTime ? pB.startTime.slice(11, 19) + ' UTC' : '—'}</strong></div>
              </div>
            </div>
          </div>

          <div className="x-orbit-verify-banner">
            <CheckCircle2 size={14} className="text-[#34D399] flex-shrink-0" />
            <span>
              {stats.isCrossLocation
                ? `Dual-Region Analysis Active · ${stats.separationKm} km Separation`
                : `Track ${track} · Frame ${frame} · ${pA.processingLevel ?? pA.productType}`}
            </span>
          </div>

          <div className="x-compare-actions-deck">
            <button
              type="button"
              className="x-link-button is-primary w-full"
              onClick={handlePinChangeStudy}
              disabled={pinning || isStudySaved}
            >
              <BookmarkPlus size={13} aria-hidden="true" />
              <span>{isStudySaved
                ? (language === 'ru' ? 'Пара сохранена в браузере' : 'Pair saved in this browser')
                : (language === 'ru' ? 'Сохранить пару' : 'Save comparison')}</span>
            </button>

            <div className="x-compare-export-row">
              <button
                type="button"
                className="x-link-button x-export-sub-btn"
                onClick={handleDownloadReport}
                title="Download formatted JSON report with all surface change statistics"
              >
                <Download size={13} aria-hidden="true" />
                <span>Export Report JSON</span>
              </button>

              <button
                type="button"
                className="x-link-button x-export-sub-btn"
                onClick={handleDownloadMask}
                title="Download illustrative water estimate PNG"
              >
                <Download size={13} aria-hidden="true" />
                <span>{language === 'ru' ? 'Скачать маску PNG' : 'Download mask PNG'}</span>
              </button>
            </div>

            <button
              type="button"
              className="x-link-button w-full opacity-80 hover:opacity-100"
              onClick={onExitCompare}
            >
              <span>Exit Multi-Temporal Compare</span>
            </button>
          </div>
        </section>

        {/* COLUMN 2: 05 // THRESHOLD SENSITIVITY & BIMODAL dB HISTOGRAM */}
        <section
          className="explorer-panel x-preview-panel"
          aria-labelledby="x-compare-telemetry-title"
        >
          <div className="x-panel-heading">
            <div>
              <span className="x-eyebrow">
                <DiamondCrosshair />
                <span>{language === 'ru' ? 'ДЕМОНСТРАЦИОННАЯ ОЦЕНКА' : 'ILLUSTRATIVE ESTIMATE'}</span>
              </span>
              <h2 id="x-compare-telemetry-title">
                {language === 'ru' ? 'Доля пикселей по порогу яркости' : 'Pixel shares by brightness threshold'}
              </h2>
            </div>
            <span className="x-product-badge">PNG</span>
          </div>
          <p className="x-comparison-notice">
            {language === 'ru'
              ? 'Проценты относятся к пикселям общей области обзорных снимков. Для измерения площади воды нужны научные данные GCOV и проверка классификации.'
              : 'Percentages refer to pixels in the overlapping browse images. Measuring water area requires GCOV science data and validation.'}
          </p>

          <div className="x-telemetry-cards-grid">
            <div className="x-telemetry-card is-perm">
              <span className="x-card-label">{language === 'ru' ? 'Ниже порога на A и B' : 'Below threshold in A and B'}</span>
              <strong className="x-card-val text-[#38BDF8]">{pixelShare(stats.permanentWaterPx)}</strong>
            </div>
            <div className="x-telemetry-card is-new">
              <span className="x-card-label">{language === 'ru' ? 'Ниже порога только на B' : 'Below threshold in B only'}</span>
              <strong className="x-card-val text-[#FB7185]">{pixelShare(stats.newWaterPx)}</strong>
            </div>
            <div className="x-telemetry-card is-lost">
              <span className="x-card-label">{language === 'ru' ? 'Ниже порога только на A' : 'Below threshold in A only'}</span>
              <strong className="x-card-val text-[#7DD3FC]">{pixelShare(stats.waterLostPx)}</strong>
            </div>
            <div className="x-telemetry-card is-net">
              <span className="x-card-label">{language === 'ru' ? 'Валидных пикселей' : 'Valid pixels'}</span>
              <strong className="x-card-val text-[#F4F4F6]">{stats.totalValidPx.toLocaleString(language)}</strong>
            </div>
          </div>

          <div className="x-threshold-slider-box">
            <div className="x-slider-header">
              <span className="x-slider-label">
                {language === 'ru' ? 'Условный порог' : 'Relative threshold'} · <strong>{activeThresholdDb.toFixed(1)}</strong>
              </span>
              <div className="x-slider-presets">
                <button
                  type="button"
                  className={`x-preset-pill${activeThresholdDb === -16.0 ? ' is-active' : ''}`}
                  onClick={() => onThresholdChange?.(-16.0)}
                >
                  -16
                </button>
                <button
                  type="button"
                  className={`x-preset-pill${activeThresholdDb === -18.0 ? ' is-active' : ''}`}
                  onClick={() => onThresholdChange?.(-18.0)}
                >
                  -18
                </button>
                <button
                  type="button"
                  className={`x-preset-pill${activeThresholdDb === -20.0 ? ' is-active' : ''}`}
                  onClick={() => onThresholdChange?.(-20.0)}
                >
                  -20
                </button>
                {changeProduct?.otsuA && (
                  <button
                    type="button"
                    className="x-preset-pill"
                    onClick={() => onThresholdChange?.(changeProduct.otsuA)}
                  >
                    Otsu Auto ({changeProduct.otsuA})
                  </button>
                )}
              </div>
            </div>
            <input
              type="range"
              min={changeProduct.histogram.minDb}
              max={changeProduct.histogram.maxDb}
              step="0.1"
              value={activeThresholdDb}
              aria-label={language === 'ru' ? 'Условный порог яркости' : 'Relative brightness threshold'}
              onChange={(e) => onThresholdChange?.(parseFloat(e.target.value))}
              className="x-threshold-range"
            />
          </div>

          {changeProduct?.histogram && (
            <BackscatterHistogram
              histogram={changeProduct.histogram}
              activeThresholdDb={activeThresholdDb}
              onThresholdChange={onThresholdChange}
              otsuA={changeProduct.otsuA}
              otsuB={changeProduct.otsuB}
              dateALabel={dateA}
              dateBLabel={dateB}
            />
          )}
        </section>

        <section className="explorer-panel x-qa-watchpoints-panel" aria-labelledby="x-compare-method-title">
          <h2 id="x-compare-method-title">{language === 'ru' ? 'Как читать результат' : 'How to read the result'}</h2>
          <p>{language === 'ru'
            ? 'Разделитель показывает два снимка. Расчётные слои сравнивают яркость пикселей. Цветовая обработка, рельеф и растительность тоже влияют на яркость.'
            : 'The divider shows both images. The derived layers compare pixel brightness. Color rendering, terrain and vegetation can also affect brightness.'}</p>
        </section>
      </div>
    );
  }

  if (!feature) {
    return (
      <div className="x-inspection-deck">
        <section className="explorer-panel x-details x-details-empty">
          <div className="x-empty">
            <span>Select an observation</span>
            <span>
              Choose a row in the timeline or a footprint on the 3D globe to
              inspect authenticated NASA Earthdata SAR browse imagery, QA
              telemetry, and HDF5 assets.
            </span>
          </div>
        </section>
      </div>
    );
  }

  const granule = p.granuleName ?? p.granuleUr ?? feature.id ?? 'Observation';
  const isSme2Record =
    (p.processingLevel ?? p.productType) === 'SME2' ||
    granule.includes('_SME2_');
  const catalogUrl =
    typeof p.url === 'string' && /^https:\/\//i.test(p.url) ? p.url : null;
  const downloadUrl =
    typeof p.downloadUrl === 'string' && /^https:\/\//i.test(p.downloadUrl)
      ? p.downloadUrl
      : null;
  const externalUrl = catalogUrl ?? downloadUrl;
  const sizeFormatted = formatBytes(p.bytes);

  const fields = [
    ['Processing level', p.processingType],
    ['Product type', p.processingLevel ?? p.productType],
    [
      'Acquired',
      p.startTime
        ? new Date(p.startTime)
            .toISOString()
            .replace('T', ' ')
            .replace('Z', ' UTC')
        : p.acquisitionDate,
    ],
    [
      'Stopped',
      p.stopTime
        ? new Date(p.stopTime)
            .toISOString()
            .replace('T', ' ')
            .replace('Z', ' UTC')
        : null,
    ],
    ['Platform', p.platform],
    ['Orbit direction', p.flightDirection],
    ['Beam mode', p.beamMode],
    ['Polarization', p.polarization],
    ['Track / frame', [p.pathNumber, p.frameNumber].filter(Boolean).join(' / ')],
    ['Granule size', sizeFormatted],
    ['Science DOI', p.nisar?.doi ?? (isSme2Record ? SME2_L3_DATASET.doi : null)],
    ['Footprint center', centerOf(feature)],
  ];

  const copyLink = async () => {
    if (!externalUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(externalUrl);
      setCopied(true);
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const activeBrowseItem =
    browseItems[selectedBrowseIdx] ?? browseItems[0] ?? null;
  const proxiedBrowseSrc = activeBrowseItem
    ? getBrowseUrl(activeBrowseItem.url)
    : null;

  return (
    <div className="x-inspection-deck-wrap">
      <style>{`
        .x-inspection-deck-wrap {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .x-deck-tabs-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          border-radius: 14px;
          background: rgba(12, 12, 18, 0.75);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.09);
        }
        .x-deck-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        .x-deck-title-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.85);
          white-space: nowrap;
        }
        .x-deck-granule-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          cursor: pointer;
          transition: all 0.2s ease;
          max-width: 440px;
          min-width: 0;
          text-align: left;
        }
        .x-deck-granule-chip:hover {
          background: rgba(255, 255, 255, 0.09);
          border-color: rgba(251, 113, 133, 0.5);
        }
        .x-deck-granule-id {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          color: rgba(244, 244, 246, 0.85);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .x-copied-badge {
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          color: #FB7185;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .x-record-id-wrap {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 10px 0;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(4, 4, 6, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.1);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .x-record-id-wrap:hover {
          border-color: rgba(251, 113, 133, 0.45);
          background: rgba(255, 255, 255, 0.04);
        }
        .x-record-id-wrap .x-record-id {
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          line-height: 1.45;
          color: rgba(255, 255, 255, 0.9);
          overflow-wrap: anywhere;
          margin: 0;
          padding: 0;
          background: transparent;
          border: none;
        }
        .x-record-id-action {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          color: #FB7185;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .x-deck-tabs {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .x-deck-tab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 32px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(4, 4, 6, 0.6);
          color: rgba(244, 244, 246, 0.7);
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-deck-tab:hover {
          border-color: rgba(255, 255, 255, 0.25);
          color: #FFFFFF;
          background: rgba(255, 255, 255, 0.06);
        }
        .x-deck-tab.is-active {
          border-color: rgba(251, 113, 133, 0.6);
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.25) 0%, rgba(190, 18, 60, 0.15) 100%);
          color: #FFFFFF;
          box-shadow: 0 0 12px rgba(225, 29, 72, 0.25);
        }
        .x-qa-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 999px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: rgba(255, 255, 255, 0.88);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-qa-pill.is-pass {
          background: rgba(16, 185, 129, 0.16);
          border: 1px solid rgba(52, 211, 153, 0.4);
          color: #6EE7B7;
        }
        .x-browse-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .x-pol-legend {
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.65);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .x-browse-stage {
          position: relative;
          flex: 1;
          min-height: 240px;
          max-height: 340px;
          border-radius: 14px;
          overflow: hidden;
          background: radial-gradient(circle at center, rgba(225, 29, 72, 0.08), #040406 75%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .x-browse-loading {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 24px;
          text-align: center;
          font-family: "JetBrains Mono", monospace;
          font-size: 10.5px;
          line-height: 1.5;
          color: rgba(244, 244, 246, 0.85);
          pointer-events: none;
        }
        .x-browse-loading span {
          max-width: 320px;
          display: block;
        }
        .x-deck-layout {
          display: grid;
          gap: 16px;
          align-items: stretch;
        }
        .x-deck-layout.is-overview {
          grid-template-columns: minmax(280px, 1fr) minmax(460px, 1.8fr) minmax(280px, 1fr);
        }
        .x-deck-layout.is-single {
          grid-template-columns: 1fr;
        }
        @media (max-width: 1180px) {
          .x-deck-layout.is-overview {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 820px) {
          .x-deck-tabs-header {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding: 10px 12px;
          }
          .x-deck-title-group {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            min-width: 0;
          }
          .x-deck-granule-chip {
            flex: 1 1 auto;
            min-width: 0;
            max-width: calc(100% - 150px);
          }
          .x-deck-granule-id {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .x-deck-tabs {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 6px;
          }
          .x-deck-tab {
            width: 100%;
            justify-content: center;
            padding: 0 8px;
            font-size: 9.5px;
            height: 32px;
          }
        }
        @media (max-width: 520px) {
          .x-deck-title-group {
            flex-direction: column;
            align-items: flex-start;
            gap: 6px;
          }
          .x-deck-granule-chip {
            width: 100%;
            max-width: 100%;
          }
          .x-deck-tabs {
            grid-template-columns: repeat(2, 1fr);
            gap: 5px;
          }
          .x-deck-tab {
            font-size: 9px;
            padding: 0 4px;
            height: 30px;
          }
        }
      `}</style>

      {/* Interactive Workbench Tab Switcher */}
      <div className="x-deck-tabs-header">
        <div className="x-deck-title-group">
          <span className="x-deck-title-tag">
            <DiamondCrosshair />
            <span>Inspection Workbench</span>
          </span>
          <button
            type="button"
            className="x-deck-granule-chip"
            onClick={copyGranuleId}
            title="Click to copy full NISAR Granule ID"
            aria-label="Copy full Granule ID"
          >
            <span className="x-deck-granule-id">{granule}</span>
            <Copy size={11} className="shrink-0 opacity-70" />
            {granuleCopied && <span className="x-copied-badge">Copied</span>}
          </button>
        </div>

        <div className="x-deck-tabs" role="tablist" aria-label="Inspection panels">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`x-deck-tab${activeTab === 'overview' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
            title="Display all 3 inspection panels side-by-side"
          >
            <LayoutGrid size={11} aria-hidden="true" />
            <span>Overview (3-Pane)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'details'}
            className={`x-deck-tab${activeTab === 'details' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('details')}
            title="Focus on technical metadata and download assets"
          >
            <span>Metadata</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'imagery'}
            className={`x-deck-tab${activeTab === 'imagery' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('imagery')}
            title="Focus on SAR browse imagery viewer"
          >
            <span>SAR Browse</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'telemetry'}
            className={`x-deck-tab${activeTab === 'telemetry' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('telemetry')}
            title="Focus on QA verification checks and database watchpoints"
          >
            <span>{language === 'ru' ? 'Контроль качества и сохранённое' : 'QA & Saved Items'}</span>
          </button>
        </div>
      </div>

      <div className={`x-deck-layout ${activeTab === 'overview' ? 'is-overview' : 'is-single'}`}>
        {/* PANEL 1: SELECTED RECORD METADATA & CLOUD ASSETS */}
        {(activeTab === 'overview' || activeTab === 'details') && (
          <section
            className="explorer-panel x-details"
            aria-labelledby="x-details-title"
          >
            <div className="x-panel-heading">
              <div>
                <span className="x-eyebrow">
                  <DiamondCrosshair />
                  <span>SELECTED OBSERVATION RECORD</span>
                </span>
                <h2 id="x-details-title">{t('Observation details', language)}</h2>
              </div>
              <span className="x-product-badge">
                {valueOrDash(p.processingLevel ?? p.productType)}
              </span>
            </div>

            <div
              className="x-record-id-wrap"
              onClick={copyGranuleId}
              title="Click to copy full NISAR Granule ID"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  copyGranuleId();
                }
              }}
            >
              <p className="x-record-id">{granule}</p>
              <span className="x-record-id-action">
                <Copy size={11} />
                <span>{granuleCopied ? 'Copied' : 'Copy'}</span>
              </span>
            </div>

            <dl className="x-metadata" style={activeTab === 'details' ? { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } : undefined}>
              {fields
                .filter(([, value]) => value != null && value !== '')
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{valueOrDash(value)}</dd>
                  </div>
                ))}
            </dl>

            {/* Primary Earthdata Cloud and ASF Actions */}
            <div className="x-record-actions">
              {externalUrl ? (
                <>
                  <a
                    className="x-link-button x-btn-primary"
                    href={proxyAssetUrl(externalUrl)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Download HDF5 granule via Earthdata token proxy"
                  >
                    <Download size={13} aria-hidden="true" />
                    <span>
                      Download HDF5 {sizeFormatted ? `(${sizeFormatted})` : ''}
                    </span>
                  </a>
                  <button
                    className="x-icon-button x-btn-secondary"
                    type="button"
                    onClick={copyLink}
                    aria-label="Copy ASF Cloud URL"
                    title="Copy ASF Cloud URL"
                  >
                    <Copy size={13} aria-hidden="true" />
                    <span>{copied ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </>
              ) : isSme2Record ? (
                <button
                  className="x-link-button x-btn-primary"
                  type="button"
                  onClick={onFlyToSme2}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  <span>Focus 561-Pixel L3 Grid on Globe</span>
                </button>
              ) : (
                <span className="x-disabled-link" aria-disabled="true">
                  <RadioTower size={13} aria-hidden="true" /> ASF URL unavailable for this record
                </span>
              )}
              {onPinWatchpoint && (
                <button
                  className="x-icon-button x-btn-ghost"
                  type="button"
                  disabled={pinning || isPinned}
                  onClick={() => onPinWatchpoint(feature)}
                  title="Persist this observation as a Mission Watchpoint in the database"
                >
                  <BookmarkPlus size={13} aria-hidden="true" />
                  <span>
                    {pinning
                      ? 'Saving…'
                      : isPinned
                        ? t('Watchpoint Pinned', language)
                        : t('Pin Watchpoint', language)}
                  </span>
                </button>
              )}
            </div>

            {/* Companion Cloud Assets (QA PDF, QA CSV, RunConfig YAML, ISO XML) */}
            {(qaPdfUrl || qaCsvUrl || runConfigUrl || isoXmlUrl) && (
              <div className="x-cloud-assets">
                <span className="x-sub-eyebrow">
                  AUTHENTICATED CLOUD ASSETS
                </span>
                <div className="x-asset-chips">
                  {qaPdfUrl && (
                    <a
                      href={proxyAssetUrl(qaPdfUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="x-asset-chip"
                    >
                      <FileText size={11} aria-hidden="true" />
                      <span>QA Report PDF</span>
                      <ArrowUpRight size={10} aria-hidden="true" />
                    </a>
                  )}
                  {qaCsvUrl && (
                    <a
                      href={proxyAssetUrl(qaCsvUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="x-asset-chip"
                    >
                      <FileSpreadsheet size={11} aria-hidden="true" />
                      <span>QA Summary CSV</span>
                      <ArrowUpRight size={10} aria-hidden="true" />
                    </a>
                  )}
                  {runConfigUrl && (
                    <a
                      href={proxyAssetUrl(runConfigUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="x-asset-chip"
                    >
                      <FileCode2 size={11} aria-hidden="true" />
                      <span>ISCE3 RunConfig YAML</span>
                      <ArrowUpRight size={10} aria-hidden="true" />
                    </a>
                  )}
                  {isoXmlUrl && (
                    <a
                      href={proxyAssetUrl(isoXmlUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="x-asset-chip"
                    >
                      <FileCode2 size={11} aria-hidden="true" />
                      <span>ISO 19115 XML</span>
                      <ArrowUpRight size={10} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* PANEL 2: AUTHENTICATED NISAR SAR IMAGERY (OR L3 SME2 / SYNTHETIC PREVIEW) */}
        {(activeTab === 'overview' || activeTab === 'imagery') && (
          browseItems.length > 0 ? (
            <section
              className="explorer-panel x-browse-panel"
              aria-label="Authenticated NISAR SAR browse imagery"
            >
              <div className="x-panel-heading">
                <div>
                  <span className="x-eyebrow">
                    <DiamondCrosshair />
                    <span>AUTHENTICATED SAR IMAGERY</span>
                  </span>
                  <h2>{language === 'ru' ? 'Радарный снимок NISAR' : 'NISAR radar image'}</h2>
                </div>
              </div>

              {browseItems.length > 1 && (
                <div className="x-browse-toolbar">
                  <div
                    className="x-browse-tabs"
                    role="tablist"
                    aria-label="SAR polarization and projection views"
                  >
                    {browseItems.map((item, idx) => (
                      <button
                        key={item.url}
                        type="button"
                        role="tab"
                        aria-selected={selectedBrowseIdx === idx}
                        className={`x-browse-tab${
                          selectedBrowseIdx === idx ? ' is-active' : ''
                        }`}
                        onClick={() => {
                          setSelectedBrowseIdx(idx);
                          setBrowseLoaded(false);
                          setBrowseError(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <div className="x-pol-legend" title="Radar Polarimetry: H = Horizontal, V = Vertical antenna transmission & reception">
                    <span>H = Horizontal · V = Vertical</span>
                  </div>
                </div>
              )}

              <div className="x-browse-stage" style={activeTab === 'imagery' ? { minHeight: '380px', maxHeight: '520px' } : undefined}>
                {!browseLoaded && !browseError && (
                  <div className="x-browse-loading">
                    <Loader2 size={20} className="animate-spin text-[#FB7185]" />
                    <span>
                      Streaming authenticated SAR browse PNG from NASA Earthdata &amp;
                      NASA Earthdata Cloud…
                    </span>
                  </div>
                )}
                {browseError ? (
                  <div className="x-browse-loading">
                    <span>
                      Browse preview failed to stream via proxy. Click below to open
                      directly on Earthdata Cloud.
                    </span>
                  </div>
                ) : (
                  <img
                    src={proxiedBrowseSrc}
                    alt={`NISAR ${p.processingLevel ?? 'SAR'} browse image for ${granule}`}
                    className={`x-browse-img${browseLoaded ? ' is-loaded' : ''}`}
                    onLoad={() => setBrowseLoaded(true)}
                    onError={() => setBrowseError(true)}
                    style={activeTab === 'imagery' ? { maxHeight: '500px' } : undefined}
                  />
                )}
              </div>

              <div className="x-browse-footer">
                <span>
                  NASA EARTHDATA · {activeBrowseItem?.label}
                  {getLocalBrowseUrl(activeBrowseItem?.url) && (language === 'ru' ? ' · КОПИЯ СОХРАНЕНА В ПРИЛОЖЕНИИ' : ' · COPY INCLUDED WITH THE APP')}
                </span>
                <a
                  href={browseError ? activeBrowseItem?.url : proxyAssetUrl(activeBrowseItem?.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="x-browse-open"
                >
                  <Eye size={12} aria-hidden="true" />
                  <span>Open Full PNG</span>
                </a>
              </div>
            </section>
          ) : isSme2Record ? (
            <section
              className="explorer-panel x-sme2-panel"
              aria-label="Parsed L3 Soil Moisture EASE-Grid 2.0 telemetry"
            >
              <div className="x-panel-heading">
                <div>
                  <span className="x-eyebrow">
                    <DiamondCrosshair />
                    <span>PARSED HDF5 L3 SOIL MOISTURE (SME2)</span>
                  </span>
                  <h2>{language === 'ru' ? 'Данные сетки EASE-Grid 2.0, 200 м' : '200m EASE-Grid 2.0 Telemetry'}</h2>
                </div>
                <span className="x-product-badge">561 PIXELS</span>
              </div>
              <p className="x-helper-text">
                Extracted directly from{' '}
                <code className="text-white/85">nisar_sme2.json</code> · Volumetric
                soil moisture (<code className="text-white/85">m³/m³</code>) across
                Svalbard Arctic permafrost (Track 141, Frame 045).
              </p>
              <div className="x-sme2-stats">
                <div>
                  <span>{t('Min Moisture', language)}</span>
                  <strong>{(SME2_L3_DATASET.stats.min * 100).toFixed(1)}%</strong>
                  <small>{SME2_L3_DATASET.stats.min.toFixed(3)} m³/m³</small>
                </div>
                <div>
                  <span>{t('Mean Moisture', language)}</span>
                  <strong className="text-[#FDA4AF]">
                    {(SME2_L3_DATASET.stats.mean * 100).toFixed(1)}%
                  </strong>
                  <small>{SME2_L3_DATASET.stats.mean.toFixed(3)} m³/m³</small>
                </div>
                <div>
                  <span>{t('Peak Moisture', language)}</span>
                  <strong className="text-[#FB7185]">
                    {(SME2_L3_DATASET.stats.max * 100).toFixed(1)}%
                  </strong>
                  <small>{SME2_L3_DATASET.stats.max.toFixed(3)} m³/m³</small>
                </div>
              </div>
              <div className="x-record-actions" style={{ marginTop: '16px' }}>
                <button
                  className="x-link-button x-btn-primary"
                  type="button"
                  onClick={onFlyToSme2}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  <span>Fly 3D Camera to Svalbard 561-Pixel Grid</span>
                </button>
              </div>
            </section>
          ) : (
            <section className="explorer-panel">
              <h2>{language === 'ru' ? 'Обзорный снимок недоступен' : 'Browse image unavailable'}</h2>
              <p>{language === 'ru' ? 'Выберите другое наблюдение или откройте метаданные этой записи.' : 'Choose another observation or view the metadata for this record.'}</p>
            </section>
          )
        )}

        {/* PANEL 3: TELEMETRY & DATABASE WATCHPOINTS */}
        {(activeTab === 'overview' || activeTab === 'telemetry') && (
          <section
            className="explorer-panel x-qa-watchpoints-panel"
            aria-label="Live NISAR QA telemetry and saved watchpoints"
          >
            <div className="x-panel-heading">
              <div>
                <span className="x-eyebrow">
                  <DiamondCrosshair />
                  <span>TELEMETRY &amp; DATABASE</span>
                </span>
                <h2>{t('QA checks & watchpoints', language)}</h2>
              </div>
              {qaStatus === 'ready' ? (
                <span className="x-qa-pill is-pass">
                  <CheckCircle2 size={10} /> {qaRows.length} QA checks
                </span>
              ) : (
                <span className="x-product-badge">
                  {watchpoints.length} SAVED
                </span>
              )}
            </div>

            <div style={activeTab === 'telemetry' ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' } : undefined}>
              {/* Live Authenticated QA Telemetry Table */}
              {qaCsvUrl ? (
                <div className="x-qa-box">
                  <div className="x-qa-header">
                    <span className="x-sub-eyebrow">
                      LIVE TELEMETRY · EARTHDATA CLOUD
                    </span>
                    {qaStatus === 'loading' && (
                      <span className="x-qa-pill">
                        <Loader2 size={10} className="animate-spin" /> Fetching CSV…
                      </span>
                    )}
                  </div>
                  {qaStatus === 'ready' && qaRows.length > 0 && (
                    <div className="x-qa-list" style={activeTab === 'telemetry' ? { maxHeight: '300px' } : undefined}>
                      {qaRows.map((row, idx) => (
                        <div key={`${row.check}-${idx}`} className="x-qa-row">
                          <div>
                            <strong>{row.description}</strong>
                            <span>
                              {row.dataset} · {row.value}
                            </span>
                          </div>
                          <span
                            className={`x-qa-badge ${
                              row.result.toUpperCase() === 'PASS'
                                ? 'is-pass'
                                : 'is-warn'
                            }`}
                          >
                            {row.result}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="x-qa-box">
                  <span className="x-sub-eyebrow">
                    QA TELEMETRY STATUS
                  </span>
                  <p className="x-helper-text" style={{ margin: 0 }}>
                    {isSme2Record
                      ? 'L3 Soil Moisture HDF5 quality flags verified: 561 valid land pixels extracted across Svalbard EASE-Grid 2.0.'
                      : 'Select any L1/L2 science product (GCOV, GUNW, GSLC, RSLC) to stream its live NASA Earthdata _QA_SUMMARY.csv verification checks.'}
                  </p>
                </div>
              )}

              {/* Saved Watchpoints List */}
              <div className="x-watchpoints-sub" style={activeTab === 'telemetry' ? { borderTop: 'none', paddingTop: 0 } : undefined}>
                <div className="x-qa-header">
                  <span className="x-sub-eyebrow">
                    MISSION WATCHPOINTS · THIS BROWSER
                  </span>
                  <span className="x-qa-pill">
                    {watchpoints.length} saved
                  </span>
                </div>
                <div className="x-wp-list" style={activeTab === 'telemetry' ? { maxHeight: '300px' } : undefined}>
                  {watchpoints.length === 0 ? (
                    <p className="text-white/40 text-xs font-mono py-4 text-center">
                      No watchpoints pinned yet. Click &quot;Pin Watchpoint&quot; on any record to save.
                    </p>
                  ) : (
                    watchpoints.map((wp) => {
                      const isActive =
                        activeId && wp.pinned_granule_id === activeId;
                      return (
                        <div
                          key={wp.id}
                          role="button"
                          tabIndex={0}
                          className={`x-wp-card${isActive ? ' is-active' : ''}`}
                          onClick={() => onSelectWatchpoint?.(wp)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelectWatchpoint?.(wp);
                            }
                          }}
                        >
                          <div className="x-wp-top">
                            <span className="x-wp-title">
                              <Bookmark
                                size={11}
                                className="inline mr-1.5 text-[#A78BFA]"
                              />
                              {wp.title}
                            </span>
                            {onDeleteWatchpoint && (
                              <button
                                type="button"
                                className="x-wp-del"
                                aria-label={`Remove ${wp.title} from database`}
                                title="Remove watchpoint from database"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteWatchpoint(wp.id);
                                }}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                          <span className="x-wp-meta">
                            {wp.product_type || 'SAR'} ·{' '}
                            {Number(wp.latitude).toFixed(2)}°N,{' '}
                            {Number(wp.longitude).toFixed(2)}°E · {wp.status}
                          </span>
                          {wp.notes && <p className="x-wp-notes">{wp.notes}</p>}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
