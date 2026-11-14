import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass,
  Globe,
  Loader2,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import {
  DotGridMark,
  DiamondCrosshair,
} from '../../components/NisarLensElements.jsx';
import { canCompareGranules, filterCatalog, getMapBrowseUrl, normalizeCatalog, getPartnerGranules } from './catalog.js';
import { DEMO_DATES, getBrowseUrl, getLocalBrowseUrl } from './demoBrowse.js';
import CatalogFilters from './CatalogFilters.jsx';
import CatalogTimeline from './CatalogTimeline.jsx';
import GlobeViewer from './GlobeViewer.jsx';
import ComparePairBar from './ComparePairBar.jsx';
import RecordDetails from './RecordDetails.jsx';
import { SME2_L3_DATASET } from './sme2Data.js';
import { computeSarChangeProduct } from './sarChangeEngine.js';
import { LanguageSwitcher, t, useLanguage } from '../../i18n.jsx';
import waterCaseImage from '../../../nisar_area3/outputs/water_change.png';

const INITIAL_FILTERS = { productType: '', startDate: '', endDate: '' };
const CATALOG_URL = `${import.meta.env.BASE_URL}data/nisar-catalog.json`;
const WATCHPOINTS_STORAGE_KEY = 'nisar-lens-watchpoints-v1';
const LEGACY_WATCHPOINTS_KEY = String.fromCharCode(122, 101, 110, 105, 116, 104, 45, 109, 105, 115, 115, 105, 111, 110, 45, 119, 97, 116, 99, 104, 112, 111, 105, 110, 116, 115, 45, 118, 49);
const DEFAULT_WATCHPOINTS = [
  { id: 'default-meghna', title: 'Meghna-Brahmaputra Subsidence & Flood Node', latitude: 23.81, longitude: 90.41, pinned_granule_id: 'NISAR_L2_PR_GCOV_021_069_A_008_2005_DHDH_A_20261006T120416_20261006T120452_P05024_N_F_J_001', product_type: 'GCOV', status: 'ACTIVE INTERFEROMETRY', notes: 'Dual-pol L-band covariance monitoring monsoon floodplain inundation across the Dhaka-Meghna basin.' },
  { id: 'default-jamuna', title: 'Jamuna-Padma Unwrapped Phase Pair', latitude: 24.18, longitude: 89.82, pinned_granule_id: 'NISAR_L2_PR_GUNW_031_069_A_015_032_4000_SH_20260922T232205_20260922T232240_20261004T232205_20261004T232240_P05023_N_F_J_001', product_type: 'GUNW', status: 'PHASE COHERENT', notes: '12-day repeat-pass unwrapped interferogram measuring levee subsidence.' },
  { id: 'default-svalbard', title: 'Svalbard Arctic Permafrost Soil Moisture Array', latitude: 77.521, longitude: 13.945, pinned_granule_id: SME2_L3_DATASET.granuleId, product_type: 'SME2', status: 'L3 EASE-GRID 200M', notes: '561-pixel L3 SME2 volumetric soil moisture grid over Arctic permafrost.' },
];

const SME2_SYNTHESIZED_RECORD = {
  granuleName: SME2_L3_DATASET.granuleId,
  granuleUr: SME2_L3_DATASET.granuleId,
  platform: 'NISAR',
  sensor: 'L-SAR',
  beamMode: 'SM · 200m EASE-Grid 2.0',
  processingLevel: 'SME2',
  processingType: 'L3 Soil Moisture (Parsed HDF5)',
  startTime: SME2_L3_DATASET.startTime,
  stopTime: SME2_L3_DATASET.stopTime,
  flightDirection: 'ASCENDING',
  polarization: 'HH+HV Dual-Pol',
  pathNumber: String(SME2_L3_DATASET.trackNumber),
  frameNumber: String(SME2_L3_DATASET.frameNumber),
  stringFootprint: SME2_L3_DATASET.wkt,
  browse: [],
  nisar: {
    doi: SME2_L3_DATASET.doi,
    additionalUrls: [],
  },
};

const LIVE_REGION_PRESETS = [
  {
    id: 'bengal',
    label: 'Bengal Delta',
    tag: '23.81°N · 90.41°E',
    subtitle: 'Monsoon Inundation',
    coords: 'POINT(90.41 23.81)',
  },
  {
    id: 'himalaya',
    label: 'Eastern Himalayas',
    tag: '27.65°N · 91.75°E',
    subtitle: 'Glacial Elevation',
    coords: 'POINT(91.75 27.65)',
  },
  {
    id: 'sundarbans',
    label: 'Sundarbans Coast',
    tag: '21.95°N · 89.18°E',
    subtitle: 'Tidal Mangroves',
    coords: 'POINT(89.18 21.95)',
  },
  {
    id: 'svalbard',
    label: 'Svalbard Arctic',
    tag: '77.52°N · 13.94°E',
    subtitle: 'Permafrost & Cryosphere',
    coords: 'POINT(13.94 77.52)',
  },
  {
    id: 'local',
    label: 'Meghna Baseline',
    tag: 'Saved Catalog',
    subtitle: '153 catalog records',
    coords: null,
  },
];

function coverageLabel(features) {
  const dates = features
    .map((feature) => feature.properties?.acquisitionDate)
    .filter(Boolean)
    .sort();
  if (!dates.length) return null;
  const first = dates[0];
  const last = dates.at(-1);
  return first === last ? first : `${first} – ${last}`;
}

export default function ExplorerPage() {
  const [language, changeLanguage] = useLanguage();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [baselineRecords, setBaselineRecords] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetryKey, setCatalogRetryKey] = useState(0);
  const [liveRecords, setLiveRecords] = useState(null);
  const [activePreset, setActivePreset] = useState('local');
  const [customLon, setCustomLon] = useState('90.41');
  const [customLat, setCustomLat] = useState('23.81');
  const [coordinateError, setCoordinateError] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [detailsImageRequest, setDetailsImageRequest] = useState(0);
  const [liveStatusMsg, setLiveStatusMsg] = useState(null);
  const [drapeRadarOnGlobe, setDrapeRadarOnGlobe] = useState(true);
  const [sme2FocusTrigger, setSme2FocusTrigger] = useState(0);

  // Multi-temporal SAR change detection & split-curtain comparison state
  const [comparePair, setComparePair] = useState(null);
  const [changeProduct, setChangeProduct] = useState(null);
  const [changeError, setChangeError] = useState(false);
  const [comparisonAttempt, setComparisonAttempt] = useState(0);
  const [pairMessage, setPairMessage] = useState('');
  const [activeThresholdDb, setActiveThresholdDb] = useState(-18.0);
  const [compareLayerMode, setCompareLayerMode] = useState('curtain');
  const [compareOpacity, setCompareOpacity] = useState(0.9);
  const [splitRatio, setSplitRatio] = useState(0.5);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(false);

    fetch(CATALOG_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const records = Array.isArray(payload?.[0])
          ? payload[0]
          : Array.isArray(payload)
            ? payload
            : null;
        if (!records) throw new Error('Catalog payload is not an array');
        setBaselineRecords(records);
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        console.error('Failed to load saved NISAR catalog:', error);
        setCatalogError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => controller.abort();
  }, [catalogRetryKey]);

  const catalog = useMemo(() => {
    const sourceRecords = liveRecords ?? [
      SME2_SYNTHESIZED_RECORD,
      ...baselineRecords,
    ];
    return normalizeCatalog(sourceRecords);
  }, [baselineRecords, liveRecords]);

  const archiveStatusMsg = catalogLoading
    ? (language === 'ru' ? 'Загружаем локальный архив наблюдений…' : 'Loading saved observations…')
    : catalogError
      ? (language === 'ru' ? 'Не удалось загрузить архив наблюдений.' : 'Could not load the saved observation archive.')
      : (language === 'ru'
        ? `Показан архив из ${baselineRecords.length} наблюдений.`
        : `Showing ${baselineRecords.length} saved observations.`);
  const statusMessage = liveStatusMsg ?? archiveStatusMsg;

  const features = useMemo(
    () =>
      [...catalog.features].sort((a, b) => {
        const timeA = Date.parse(a.properties?.startTime ?? '') || 0;
        const timeB = Date.parse(b.properties?.startTime ?? '') || 0;
        return timeB - timeA || String(a.id).localeCompare(String(b.id));
      }),
    [catalog]
  );

  // Default to the newest GCOV or GUNW observation so real SAR browse imagery and QA CSV load immediately
  const defaultFeatureId = useMemo(() => {
    const withBrowse = features.find(
      (f) =>
        (f.properties?.processingLevel === 'GCOV' ||
          f.properties?.processingLevel === 'GUNW') &&
        Array.isArray(f.properties?.browse) &&
        f.properties.browse.length > 0
    );
    return withBrowse?.id ?? features[0]?.id ?? null;
  }, [features]);

  const [selectedId, setSelectedId] = useState(null);
  const effectiveSelectedId = selectedId ?? defaultFeatureId;

  const types = useMemo(
    () =>
      [
        ...new Set(
          features.map((feature) => feature.properties?.productType).filter(Boolean)
        ),
      ].sort(),
    [features]
  );

  const filtered = useMemo(
    () => filterCatalog(features, filters),
    [features, filters]
  );

  const selected =
    filtered.find(
      (feature) => (feature.id ?? feature.properties?.id) === effectiveSelectedId
    ) ??
    filtered[0] ??
    null;
  const activeId = selected?.id ?? null;
  const isRu = language === 'ru';
  const reveal = (id) => {
    requestAnimationFrame(() => {
      const section = document.getElementById(id);
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // Find repeat-pass partner for the currently selected record (if not already comparing)
  const activePartner = useMemo(() => {
    if (!selected || comparePair) return null;
    const partners = getPartnerGranules(selected, features);
    return partners[0] ?? null;
  }, [selected, features, comparePair]);

  const startComparison = (granuleA, granuleB) => {
    setPairMessage('');
    if (comparePair?.granuleA?.id !== granuleA.id || comparePair?.granuleB?.id !== granuleB.id) {
      setChangeProduct(null);
      setChangeError(false);
    }
    setComparePair({ granuleA, granuleB });
    setCompareLayerMode('curtain');
    setSplitRatio(0.5);
    setShowDetails(true);
    reveal('compare-workspace');
  };

  const selectCompareDate = (key, feature) => {
    if (!getMapBrowseUrl(feature.properties ?? feature)) {
      setPairMessage(isRu ? 'Для этого наблюдения нет обзорного снимка LATLON.' : 'This observation has no LATLON browse image.');
      return;
    }
    const pair = { granuleA: null, granuleB: null, ...comparePair, [key]: feature };
    if (pair.granuleA && pair.granuleB) {
      if (canCompareGranules(pair.granuleA, pair.granuleB)) {
        startComparison(pair.granuleA, pair.granuleB);
      } else {
        setPairMessage(isRu
          ? 'Выбери другую дату с тем же продуктом, треком, кадром и поляризацией. Для обеих дат нужны снимки LATLON.'
          : 'Choose a different date with the same product, track, frame and polarization. Both dates need LATLON images.');
      }
      return;
    }
    setPairMessage('');
    setComparePair(pair);
  };

  const handleStartAutoCompare = (feature, partner) => {
    const fA = feature ?? selected;
    const fB = partner ?? (fA ? getPartnerGranules(fA, features)[0] : null) ?? activePartner;
    if (!canCompareGranules(fA, fB)) return;

    // Order chronologically: older date as Date A, newer as Date B
    const timeA = Date.parse(fA.properties?.startTime ?? '') || 0;
    const timeB = Date.parse(fB.properties?.startTime ?? '') || 0;
    if (timeA <= timeB) startComparison(fA, fB);
    else startComparison(fB, fA);
  };

  const demoPair = useMemo(() => DEMO_DATES.map((date) =>
    baselineRecords.find((record) => String(record.startTime).startsWith(date) &&
      getLocalBrowseUrl(getMapBrowseUrl(record)))
  ), [baselineRecords]);

  const handleDemoCompare = () => {
    const [a, b] = normalizeCatalog(demoPair).features;
    if (!canCompareGranules(a, b)) return;
    setLiveRecords(null);
    setActivePreset('local');
    setLiveStatusMsg(null);
    setFilters({ ...INITIAL_FILTERS, productType: 'GCOV' });
    setSelectedId(b.id);
    startComparison(a, b);
  };

  const handleSwapCompare = () => {
    setChangeProduct(null);
    setChangeError(false);
    setComparePair((prev) => {
      if (!prev?.granuleA || !prev?.granuleB) return prev;
      return { granuleA: prev.granuleB, granuleB: prev.granuleA };
    });
  };

  const handleExitCompare = () => {
    setComparePair(null);
    setChangeProduct(null);
    setPairMessage('');
  };

  const handleThresholdChange = (newThreshold) => {
    setActiveThresholdDb(newThreshold);
    if (changeProduct?.recomputeAtThreshold) {
      const recomputed = changeProduct.recomputeAtThreshold(newThreshold);
      setChangeProduct((prev) =>
        prev
          ? {
              ...prev,
              waterClassDataUrl: recomputed.waterClassDataUrl,
              stats: recomputed.stats,
              thresholdDb: newThreshold,
            }
          : null
      );
    }
  };

  // Run real-time browser SAR change computation whenever comparePair updates
  useEffect(() => {
    if (!comparePair?.granuleA || !comparePair?.granuleB) {
      setChangeProduct(null);
      setChangeError(false);
      return;
    }

    let isCancelled = false;
    setChangeProduct(null);
    setChangeError(false);

    const gA = comparePair.granuleA;
    const gB = comparePair.granuleB;
    const pA = gA.properties ?? gA;
    const pB = gB.properties ?? gB;

    const rawUrlA = getMapBrowseUrl(pA);
    const rawUrlB = getMapBrowseUrl(pB);

    computeSarChangeProduct({
      granuleA: gA,
      granuleB: gB,
      imageUrlA: getBrowseUrl(rawUrlA),
      imageUrlB: getBrowseUrl(rawUrlB),
      thresholdDb: activeThresholdDb,
    })
      .then((res) => {
        if (!isCancelled) {
          setChangeProduct({ ...res, source: [rawUrlA, rawUrlB].map((url) => ({
            url,
            local: Boolean(getLocalBrowseUrl(url)),
          })) });
        }
      })
      .catch((err) => {
        console.error('Failed to compute SAR change product:', err);
        if (!isCancelled) {
          setChangeError(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    comparePair?.granuleA?.id ?? comparePair?.granuleA?.properties?.id,
    comparePair?.granuleB?.id ?? comparePair?.granuleB?.properties?.id,
    comparisonAttempt,
  ]);

  const runLiveAsfQuery = async (wktPoint, presetId, label) => {
    setCoordinateError(false);
    handleExitCompare();
    if (!wktPoint) {
      setLiveRecords(null);
      setActivePreset('local');
      setFilters(INITIAL_FILTERS);
      setSelectedId(null);
      setShowDetails(false);
      setLiveStatusMsg(null);
      return;
    }

    setLiveLoading(true);
    setActivePreset(presetId);
    setLiveStatusMsg(language === 'ru' ? `Ищем наблюдения NASA для места «${t(label, language)}»…` : `Looking for NASA observations near ${label}…`);

    try {
      const params = new URLSearchParams({
        platform: 'NISAR',
        intersectsWith: wktPoint,
        maxResults: '100',
      });
      const res = await fetch(`/api/asf-search?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`ASF API HTTP ${res.status}`);
      }
      const data = await res.json();
      const rawList = Array.isArray(data?.[0])
        ? data[0]
        : Array.isArray(data?.results)
          ? data.results
          : Array.isArray(data)
            ? data
            : [];
      const { features: results } = normalizeCatalog(rawList);
      setLiveRecords(results.map(({ properties }) => properties));
      setFilters(INITIAL_FILTERS);
      setSelectedId(results[0]?.id ?? null);
      setShowDetails(results.length > 0);
      setLiveStatusMsg(results.length
        ? (isRu ? `Готово: найдено наблюдений — ${results.length}.` : `Done: found ${results.length} observations.`)
        : (isRu ? 'Для этой точки не найдено наблюдений NISAR.' : 'No NISAR observations found for these coordinates.'));
    } catch (err) {
      setLiveRecords(null);
      setActivePreset('local');
      setFilters(INITIAL_FILTERS);
      setSelectedId(null);
      setShowDetails(false);
      setLiveStatusMsg(baselineRecords.length
        ? (language === 'ru' ? 'Не удалось получить данные NASA. Показан сохранённый архив.' : 'NASA search is unavailable. Showing the saved archive instead.')
        : (language === 'ru' ? 'Поиск NASA недоступен, локальный архив не загружен.' : 'NASA search is unavailable and the local archive has not loaded.'));
    } finally {
      setLiveLoading(false);
    }
  };

  const handleCustomSearch = (e) => {
    e.preventDefault();
    const decimal = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
    const lonText = customLon.trim();
    const latText = customLat.trim();
    const lon = Number(lonText.replace(',', '.'));
    const lat = Number(latText.replace(',', '.'));
    if (!decimal.test(lonText) || !decimal.test(latText) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      setCoordinateError(true);
      return;
    }
    runLiveAsfQuery(
      `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`,
      'custom',
      `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`
    );
  };

  const handleFocusSme2 = () => {
    handleExitCompare();
    setCoordinateError(false);
    setLiveRecords(null);
    setLiveStatusMsg(null);
    setActivePreset('sme2');
    setFilters(INITIAL_FILTERS);
    setSelectedId(SME2_L3_DATASET.granuleId);
    setDetailsImageRequest((value) => value + 1);
    setShowDetails(true);
    setSme2FocusTrigger((c) => c + 1);
    reveal('compare-workspace');
  };

  const [watchpoints, setWatchpoints] = useState(() => {
    try {
      const saved = localStorage.getItem(WATCHPOINTS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_WATCHPOINTS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_WATCHPOINTS;
    } catch {
      return DEFAULT_WATCHPOINTS;
    }
  });
  const [pinning, setPinning] = useState(false);

  useEffect(() => {
    localStorage.setItem(WATCHPOINTS_STORAGE_KEY, JSON.stringify(watchpoints));
  }, [watchpoints]);

  const handlePinWatchpoint = (featureToPin) => {
    if (!featureToPin || pinning) return;
    if (featureToPin.granuleIds) {
      setWatchpoints((prev) => [
        { ...featureToPin, id: `study-${Date.now()}` },
        ...prev.filter((w) => w.pinned_granule_id !== featureToPin.pinned_granule_id),
      ]);
      return;
    }
    const p = featureToPin.properties ?? {};
    const granuleId = p.granuleName ?? p.granuleUr ?? featureToPin.id;
    const ring = featureToPin.geometry?.coordinates?.[0] ?? [];
    const pts = ring.slice(0, -1);
    const [lonSum, latSum] = pts.reduce(
      (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
      [0, 0]
    );
    const lon = pts.length ? lonSum / pts.length : 90.41;
    const lat = pts.length ? latSum / pts.length : 23.81;

    const entry = {
      id: `watchpoint-${Date.now()}`,
      title: `${p.processingLevel ?? p.productType ?? 'SAR'} · Track ${p.pathNumber ?? '—'} Frame ${p.frameNumber ?? '—'} (${p.acquisitionDate ?? 'NISAR'})`,
      latitude: Number(lat.toFixed(4)),
      longitude: Number(lon.toFixed(4)),
      pinned_granule_id: granuleId,
      product_type: p.processingLevel ?? p.productType ?? 'SAR',
      status: 'SAVED IN THIS BROWSER',
      notes: `Pinned observation ${granuleId} (${p.flightDirection ?? 'Orbit'}, ${p.polarization ?? 'Dual-Pol'}).`,
    };
    setWatchpoints((prev) => [entry, ...prev.filter((w) => w.pinned_granule_id !== granuleId)]);
    setLiveStatusMsg(`Saved observation ${granuleId.slice(0, 32)}… in this browser.`);
  };

  const handleDeleteWatchpoint = (id) => {
    setWatchpoints((prev) => prev.filter((w) => w.id !== id));
  };

  const handleSelectWatchpoint = (wp) => {
    if (!wp) return;
    if (wp.granuleIds?.length === 2) {
      const archive = normalizeCatalog(baselineRecords).features;
      const [a, b] = wp.granuleIds.map((id) =>
        features.find((feature) => feature.id === id) ?? archive.find((feature) => feature.id === id)
      );
      if (canCompareGranules(a, b)) startComparison(a, b);
      else setLiveStatusMsg(isRu ? 'Для этой пары сначала загрузите исходный каталог.' : 'Load the original catalog to reopen this pair.');
      return;
    }
    setShowDetails(true);
    if (wp.pinned_granule_id === SME2_L3_DATASET.granuleId) {
      handleFocusSme2();
      return;
    }
    setFilters(INITIAL_FILTERS);
    if (wp.pinned_granule_id) {
      setSelectedId(wp.pinned_granule_id);
    }
  };

  const handleSelectObservation = (id) => {
    handleExitCompare();
    setSelectedId(id);
    setShowDetails(true);
    reveal('observation-details');
  };

  const isSelectedPinned = useMemo(
    () =>
      Boolean(
        activeId &&
          watchpoints.some((w) => w.pinned_granule_id === activeId)
      ),
    [activeId, watchpoints]
  );

  const isSme2Active = useMemo(
    () => activePreset === 'sme2',
    [activePreset]
  );

  const activeRegionLabel = useMemo(() => {
    if (activePreset === 'sme2') return 'Svalbard L3 Soil Moisture';
    if (activePreset === 'custom') return `Custom (${customLat}°N, ${customLon}°E)`;
    const preset = LIVE_REGION_PRESETS.find((p) => p.id === activePreset);
    return preset?.label ?? 'Meghna Baseline';
  }, [activePreset, customLat, customLon]);

  return (
    <main className="x-explorer min-h-screen bg-[#040406] text-[#F4F4F6] relative overflow-x-hidden selection:bg-white/20 selection:text-white">
      {/* Ambient Background & Grid Matrix */}
      <div className="fixed inset-0 bg-dot-matrix opacity-40 pointer-events-none z-0" />
      <div
        className="fixed top-[-18%] left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full blur-[150px] pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(circle, rgba(255,255,255,0.06) 0%, rgba(225,29,72,0.035) 55%, transparent 80%)',
        }}
      />
      <style>{`
        .x-explorer {
          --x-bg: #040406;
          --x-panel: rgba(12, 12, 18, 0.65);
          --x-panel-raised: rgba(20, 20, 28, 0.78);
          --x-border: rgba(255, 255, 255, 0.09);
          --x-border-hover: rgba(255, 255, 255, 0.22);
          --x-text: #F4F4F6;
          --x-muted: rgba(244, 244, 246, 0.72);
          --x-dim: rgba(244, 244, 246, 0.52);
          --x-accent: #F4F4F6;
          --x-crimson: #E11D48;
          --x-rose: #FB7185;
          --x-crimson-dim: rgba(225, 29, 72, 0.2);
          font-family: "Plus Jakarta Sans", "Inter", system-ui, -apple-system, sans-serif;
          padding: 0 24px 48px;
        }
        .x-explorer * { box-sizing: border-box; }
        .x-shell { position: relative; z-index: 10; max-width: 1440px; margin: 0 auto; }

        /* Frosted Glass Top Navigation Bar */
        .x-topbar-wrap { padding-top: 16px; margin-bottom: 6px; }
        .x-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 20px;
          border-radius: 16px;
          background: rgba(4, 4, 6, 0.75);
          backdrop-filter: blur(28px) saturate(140%);
          -webkit-backdrop-filter: blur(28px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 16px 44px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        }
        .x-brand { display: flex; align-items: center; gap: 12px; text-decoration: none; color: inherit; min-width: 0; }
        .x-brand-mark {
          width: 38px;
          height: 38px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
        }
        .x-brand-name {
          font-family: "Space Grotesk", sans-serif;
          font-size: 13px;
          letter-spacing: 0.26em;
          text-transform: uppercase;
          font-weight: 600;
          color: #FFFFFF;
        }
        .x-brand-sub {
          margin-top: 2px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--x-muted);
        }
        .x-back {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          border-radius: 9999px;
          padding: 8px 16px;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.88);
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.65), inset 0 1px 0 0 rgba(255, 255, 255, 0.18);
          transition: all 0.25s ease;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-back:hover {
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.05) 100%);
          border-color: rgba(255, 255, 255, 0.32);
          color: #FFFFFF;
        }

        /* Scientific Workspace Header */
        .x-console-header {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          padding: 18px 4px 14px;
        }
        .x-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.7);
        }
        .x-console-title-group h1 {
          font-family: "Space Grotesk", sans-serif;
          font-size: clamp(22px, 2.4vw, 30px);
          letter-spacing: -0.02em;
          line-height: 1.2;
          margin: 6px 0 4px;
          font-weight: 500;
          color: #FFFFFF;
        }
        .x-console-title-group h1 strong { font-weight: 700; }
        .x-console-title-group p {
          margin: 0;
          color: var(--x-muted);
          font-size: 13px;
          font-weight: 300;
          line-height: 1.5;
          max-width: 680px;
        }
        .x-console-header { padding-top: 14px; padding-bottom: 10px; }
        .x-live-tag {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
          padding: 7px 13px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.12);
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.88);
        }
        .x-live-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #E11D48;
          box-shadow: 0 0 10px rgba(225, 29, 72, 0.85);
        }

        /* Command Station: Live NASA Earthdata Study Region Selector */
        .x-earthdata-bar {
          margin-bottom: 16px;
          padding: 18px 20px;
          border-radius: 18px;
          background: linear-gradient(
            145deg,
            rgba(20, 20, 30, 0.78) 0%,
            rgba(10, 10, 16, 0.88) 60%,
            rgba(32, 14, 24, 0.78) 100%
          );
          backdrop-filter: blur(28px) saturate(140%);
          -webkit-backdrop-filter: blur(28px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 20px 48px -12px rgba(0, 0, 0, 0.8),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.16);
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .x-cmd-header {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .x-cmd-title-wrap {
          flex: 1 1 320px;
          min-width: 0;
        }
        .x-cmd-eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--x-rose);
          font-weight: 600;
          margin-bottom: 4px;
        }
        .x-cmd-title {
          font-family: "Space Grotesk", sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #FFFFFF;
          margin: 0 0 4px 0;
          letter-spacing: -0.01em;
        }
        .x-cmd-desc {
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          color: rgba(244, 244, 246, 0.72);
          max-width: 780px;
        }
        .x-query-status { margin: 0; color: rgba(244,244,246,.68); font-size: 11px; }
        .x-query-status.is-loading { color: #FDA4AF; }
        .x-query-retry { margin-left: 8px; padding: 2px 7px; color: #F4F4F6; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.16); border-radius: 5px; cursor: pointer; }
        .x-query-retry:hover { background: rgba(255,255,255,.12); }
        .x-advanced-filters { margin: 0 0 14px; }
        .x-details-reveal { scroll-margin-top: 18px; margin-top: 20px; }
        .x-step-three { margin: 0 0 12px 4px; }
        .x-step-three span { color: #FB7185; font: 600 10px "JetBrains Mono", monospace; letter-spacing: .16em; }
        .x-step-three p { color: rgba(244,244,246,.7); font-size: 13px; margin: 5px 0 0; }
        .x-hide-details { margin: 0 0 10px auto; display:block; color:rgba(255,255,255,.7); background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.15); border-radius:999px; padding:8px 14px; cursor:pointer; }
        .x-hide-details:hover { color:#fff; border-color:rgba(251,113,133,.55); }
        .x-next-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
        .x-next-actions button, .x-comparison-notice button { padding: 8px 12px; border: 1px solid #526277; border-radius: 6px; background: #202936; color: #fff; text-align: left; }
        .x-next-actions button:first-child { background: #215889; border-color: #559cdb; }
        .x-next-actions button:disabled { opacity: .55; cursor: default; }
        .x-next-actions span { display: block; margin-top: 2px; font-size: .75rem; color: #dae6f1; }
        .x-compare-guide { font-size: .85rem; color: #e5e7eb; margin-bottom: 8px; }
        .x-water-case { padding: 12px; border: 1px solid #404552; border-radius: 6px; margin-bottom: 8px; }
        .x-water-case summary { cursor: pointer; font-weight: 600; }
        .x-water-case p { margin: 8px 0; font-size: .85rem; color: #e5e7eb; }
        .x-water-case img { display: block; width: 100%; height: auto; background: white; }
        .x-comparison-notice { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin: 0 0 8px; padding: 10px 12px; border: 1px solid #514b3b; border-radius: 6px; background: #201c13; color: #f6e5b8; font-size: .8rem; }
        .x-comparison-notice strong { color: #ffdc87; }
        #compare-workspace, #observation-details { scroll-margin-top: 16px; }
        .x-cmd-restore-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: rgba(244, 244, 246, 0.9);
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }
        .x-cmd-restore-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.28);
          color: #FFFFFF;
        }

        .x-cmd-grid {
          display: flex;
          flex-wrap: wrap;
          align-items: stretch;
          gap: 12px;
        }
        .x-cmd-presets {
          flex: 1 1 540px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
          gap: 8px;
        }
        .x-region-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: space-between;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.035);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #F4F4F6;
          cursor: pointer;
          transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          text-align: left;
          min-height: 70px;
        }
        .x-region-card:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.075);
          border-color: rgba(255, 255, 255, 0.24);
          transform: translateY(-1px);
        }
        .x-region-card.is-active {
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.24) 0%, rgba(190, 18, 60, 0.16) 100%);
          border-color: rgba(251, 113, 133, 0.75);
          box-shadow: 0 0 20px rgba(225, 29, 72, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .x-region-card.is-sme2 {
          background: rgba(255, 255, 255, 0.035);
          border-color: rgba(255, 255, 255, 0.1);
        }
        .x-region-card.is-sme2:hover {
          background: rgba(255, 255, 255, 0.075);
          border-color: rgba(255, 255, 255, 0.24);
        }
        .x-region-card.is-sme2.is-active {
          border-color: rgba(251, 113, 133, 0.75);
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.24) 0%, rgba(190, 18, 60, 0.16) 100%);
          box-shadow: 0 0 20px rgba(225, 29, 72, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }

        .x-region-top {
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          min-width: 0;
        }
        .x-region-indicator {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 5px;
          background: rgba(255, 255, 255, 0.05);
          flex-shrink: 0;
        }
        .x-region-name {
          font-family: "Space Grotesk", sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          color: #FFFFFF;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: -0.01em;
          flex: 1;
          min-width: 0;
        }
        .x-region-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
          width: 100%;
          min-width: 0;
          margin-top: 5px;
        }
        .x-region-tag {
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.72);
          letter-spacing: 0.03em;
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .x-region-sub {
          font-size: 10px;
          line-height: 1.3;
          color: rgba(244, 244, 246, 0.72);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Custom Coordinates Search Box */
        .x-coord-tool {
          flex: 0 1 310px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(4, 4, 6, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.12);
          gap: 8px;
          min-height: 70px;
        }
        .x-coord-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(244, 244, 246, 0.75);
          font-weight: 500;
        }
        .x-coord-inputs {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .x-coord-field {
          position: relative;
          flex: 1 1 80px;
          min-width: 0;
        }
        .x-coord-input {
          width: 100%;
          height: 32px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.04);
          color: #FFFFFF;
          padding: 0 24px 0 8px;
          font-family: "JetBrains Mono", monospace;
          font-size: 11px;
          outline: none;
          transition: border-color 0.2s ease;
          color-scheme: dark;
        }
        .x-coord-input:focus {
          border-color: rgba(251, 113, 133, 0.7);
          background: rgba(255, 255, 255, 0.08);
        }
        .x-coord-unit {
          position: absolute;
          right: 7px;
          top: 50%;
          transform: translateY(-50%);
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          font-weight: 700;
          color: #FB7185;
          pointer-events: none;
        }
        .x-coord-submit {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          height: 32px;
          padding: 0 12px;
          border-radius: 8px;
          background: linear-gradient(135deg, #E11D48 0%, #BE123C 100%);
          border: 1px solid rgba(251, 113, 133, 0.45);
          color: #FFFFFF;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }
        .x-coord-submit:hover:not(:disabled) {
          filter: brightness(1.15);
          box-shadow: 0 0 12px rgba(225, 29, 72, 0.4);
        }
        .x-coord-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* 2-Column Primary Geospatial Workspace (70% Globe / 30% Timeline) */
        .x-primary-stage {
          display: grid;
          grid-template-columns: minmax(0, 7fr) minmax(0, 3fr);
          gap: 16px;
          align-items: stretch;
          margin-bottom: 14px;
        }
        .x-globe-column {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .x-globe-viewport {
          position: relative;
          height: 650px;
          min-height: 650px;
          max-height: 650px;
          width: 100%;
          border-radius: 20px;
          overflow: hidden;
        }
        .x-globe-viewport .x-globe-card {
          height: 100% !important;
          min-height: 650px !important;
        }
        .x-timeline-column {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .x-timeline-column .x-timeline {
          height: 650px;
          min-height: 650px;
          max-height: 650px;
          display: flex;
          flex-direction: column;
        }
        .x-timeline-column .x-observation-list {
          flex: 1;
          overflow-y: auto;
        }
        .x-globe-legend {
          position: absolute;
          bottom: 12px;
          left: 12px;
          right: 12px;
          z-index: 20;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 10px 14px;
          padding: 9px 16px;
          border-radius: 12px;
          background: rgba(4, 4, 6, 0.42);
          backdrop-filter: blur(18px) saturate(140%);
          -webkit-backdrop-filter: blur(18px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.14);
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.15);
          color: #F4F4F6;
          font-family: "JetBrains Mono", monospace;
          font-size: 10.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          pointer-events: auto;
        }
        .x-globe-legend span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #FFFFFF;
          font-weight: 500;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
        }
        .x-globe-legend i {
          width: 14px;
          height: 9px;
          border-radius: 2px;
          border: 1px solid #FDA4AF;
          background: rgba(251, 113, 133, 0.6);
          display: inline-block;
          box-shadow: 0 0 8px rgba(251, 113, 133, 0.45);
        }
        .x-globe-legend .x-swatch-desc {
          border: 1px solid #FDA4AF;
          background: rgba(251, 113, 133, 0.6);
          box-shadow: 0 0 8px rgba(251, 113, 133, 0.45);
        }
        .x-globe-legend .x-swatch-selected {
          border: 1.5px solid #FFFFFF;
          background: #E11D48;
          box-shadow: 0 0 12px rgba(225, 29, 72, 0.8);
        }
        .x-globe-legend-hint {
          color: rgba(255, 255, 255, 0.82);
          font-size: 10px;
          letter-spacing: 0.04em;
          text-transform: none;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
        }

        /* Generic Panel Styling */
        .explorer-panel {
          position: relative;
          min-width: 0;
          border-radius: 20px;
          background: linear-gradient(
            145deg,
            rgba(255, 255, 255, 0.055) 0%,
            rgba(255, 255, 255, 0.018) 55%,
            rgba(255, 255, 255, 0.035) 100%
          );
          backdrop-filter: blur(28px) saturate(140%);
          -webkit-backdrop-filter: blur(28px) saturate(140%);
          border: 1px solid rgba(255, 255, 255, 0.09);
          box-shadow:
            0 24px 60px -15px rgba(0, 0, 0, 0.85),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.16),
            inset 0 -1px 0 0 rgba(255, 255, 255, 0.04);
          padding: 18px 20px;
        }
        .x-panel-heading {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 10px;
        }
        .x-panel-heading h2 {
          font-family: "Space Grotesk", sans-serif;
          font-size: 16px;
          letter-spacing: -0.02em;
          font-weight: 500;
          color: #FFFFFF;
          margin: 4px 0 0;
        }
        .x-product-badge {
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          background: rgba(225, 29, 72, 0.15);
          border: 1px solid rgba(251, 113, 133, 0.4);
          color: #FFE4E6;
          border-radius: 999px;
          padding: 4px 12px;
          font-family: "JetBrains Mono", monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-weight: 600;
        }
        .x-sub-eyebrow {
          display: block;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.65);
        }
        .x-record-id {
          font-family: "JetBrains Mono", monospace;
          font-size: 11.5px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.9);
          overflow-wrap: anywhere;
          margin: 10px 0;
          padding: 8px 12px;
          border-radius: 8px;
          background: rgba(4, 4, 6, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .x-metadata {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 14px;
          margin: 0;
        }
        .x-metadata > div {
          min-width: 0;
          padding: 7px 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .x-metadata dt {
          color: rgba(244, 244, 246, 0.7);
          font-family: "JetBrains Mono", monospace;
          font-size: 10.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 2px;
        }
        .x-metadata dd {
          margin: 0;
          color: #FFFFFF;
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .x-record-actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 12px;
        }
        .x-link-button,
        .x-icon-button,
        .x-btn-ghost,
        .x-disabled-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 34px;
          border-radius: 999px;
          padding: 0 14px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          transition: all 0.25s ease;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-link-button {
          background: linear-gradient(135deg, #E11D48 0%, #BE123C 100%);
          border: 1px solid rgba(251, 113, 133, 0.55);
          color: #FFFFFF;
          text-decoration: none;
          font-weight: 600;
          box-shadow: 0 4px 16px rgba(225, 29, 72, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .x-link-button:hover {
          background: linear-gradient(135deg, #FB7185 0%, #E11D48 100%);
          border-color: rgba(255, 255, 255, 0.45);
          color: #FFFFFF;
          transform: translateY(-1px);
        }
        .x-icon-button {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.18);
          color: rgba(255, 255, 255, 0.9);
        }
        .x-icon-button:hover {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(251, 113, 133, 0.45);
          color: #FFFFFF;
        }
        .x-btn-ghost {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.65);
        }
        .x-btn-ghost:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.25);
          color: #FFFFFF;
        }
        .x-disabled-link {
          color: var(--x-dim);
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .x-cloud-assets {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: grid;
          gap: 6px;
        }
        .x-asset-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .x-asset-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.82);
          text-decoration: none;
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          transition: all 0.2s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-asset-chip:hover {
          border-color: rgba(251, 113, 133, 0.45);
          background: rgba(225, 29, 72, 0.14);
          color: #FFFFFF;
        }

        /* Browse Panel */
        .x-browse-panel {
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .x-browse-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .x-browse-tab {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(4, 4, 6, 0.6);
          color: rgba(255, 255, 255, 0.68);
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-browse-tab.is-active {
          border-color: rgba(251, 113, 133, 0.55);
          background: rgba(225, 29, 72, 0.22);
          color: #FFFFFF;
        }
        .x-browse-stage {
          position: relative;
          flex: 1;
          min-height: 220px;
          max-height: 300px;
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
        .x-browse-img {
          width: 100%;
          max-height: 280px;
          object-fit: contain;
          opacity: 0;
          transition: opacity 0.25s ease;
        }
        .x-browse-img.is-loaded { opacity: 1; }
        .x-browse-footer {
          margin-top: auto;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--x-dim);
        }
        .x-browse-open {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #FDA4AF;
          text-decoration: none;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-browse-open:hover { color: #FFFFFF; }

        /* L3 SME2 Soil Moisture Panel */
        .x-sme2-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          margin-top: 10px;
        }
        .x-sme2-stats > div {
          padding: 10px;
          border-radius: 12px;
          background: rgba(4, 4, 6, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: grid;
          gap: 3px;
        }
        .x-sme2-stats span {
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--x-dim);
        }
        .x-sme2-stats strong {
          font-family: "Space Grotesk", sans-serif;
          font-size: 16px;
          color: #FFFFFF;
        }
        .x-sme2-stats small {
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          color: var(--x-muted);
        }

        /* QA & Database Watchpoints Panel */
        .x-qa-watchpoints-panel {
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .x-qa-box {
          padding: 12px;
          border-radius: 12px;
          background: rgba(4, 4, 6, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: grid;
          gap: 9px;
        }
        .x-qa-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .x-qa-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          border-radius: 999px;
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.75);
          white-space: nowrap;
          flex-shrink: 0;
        }
        .x-qa-pill.is-pass {
          background: rgba(16, 185, 129, 0.16);
          border: 1px solid rgba(52, 211, 153, 0.4);
          color: #6EE7B7;
        }
        .x-qa-list {
          display: grid;
          gap: 6px;
          max-height: 155px;
          overflow-y: auto;
          padding-right: 4px;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
          scrollbar-width: thin;
        }
        .x-qa-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 8px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .x-qa-row strong {
          display: block;
          font-size: 11px;
          font-weight: 500;
          color: #FFFFFF;
        }
        .x-qa-row span {
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          color: var(--x-muted);
        }
        .x-qa-badge {
          padding: 3px 7px;
          border-radius: 999px;
          font-family: "JetBrains Mono", monospace;
          font-size: 8.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .x-qa-badge.is-pass {
          background: rgba(16, 185, 129, 0.18);
          border: 1px solid rgba(52, 211, 153, 0.4);
          color: #6EE7B7;
        }
        .x-qa-badge.is-warn {
          background: rgba(225, 29, 72, 0.2);
          border: 1px solid rgba(251, 113, 133, 0.45);
          color: #FFE4E6;
        }

        .x-watchpoints-sub {
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          display: grid;
          gap: 8px;
        }
        .x-wp-list {
          display: grid;
          gap: 7px;
          max-height: 200px;
          overflow-y: auto;
          padding-right: 4px;
          scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
          scrollbar-width: thin;
        }
        .x-wp-card {
          position: relative;
          display: grid;
          gap: 4px;
          padding: 9px 11px;
          border-radius: 12px;
          background: rgba(4, 4, 6, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.08);
          text-align: left;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .x-wp-card:hover {
          border-color: rgba(251, 113, 133, 0.4);
          background: rgba(255, 255, 255, 0.045);
        }
        .x-wp-card.is-active {
          border-color: rgba(251, 113, 133, 0.75);
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.22) 0%, rgba(190, 18, 60, 0.12) 100%);
        }
        .x-wp-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .x-wp-title {
          font-size: 11px;
          font-weight: 500;
          color: #FFFFFF;
          line-height: 1.35;
        }
        .x-wp-meta {
          font-family: "JetBrains Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #FDA4AF;
        }
        .x-wp-notes {
          font-size: 10.5px;
          line-height: 1.45;
          color: var(--x-muted);
          margin: 2px 0 0;
        }
        .x-wp-del {
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.4);
          padding: 2px;
          cursor: pointer;
        }
        .x-wp-del:hover { color: #FB7185; }

        .x-empty {
          display: grid;
          place-content: center;
          text-align: center;
          min-height: 150px;
          gap: 8px;
          padding: 22px;
          color: var(--x-muted);
          font-size: 13px;
          font-weight: 300;
          line-height: 1.6;
        }
        .x-empty span:first-child {
          font-family: "Space Grotesk", sans-serif;
          font-size: 15px;
          color: #FFFFFF;
          font-weight: 500;
        }
        .x-details-empty { display: grid; place-items: center; min-height: 250px; }

        @media (max-width: 1180px) {
          .x-primary-stage { grid-template-columns: 1fr; }
          .x-globe-viewport { height: 480px; min-height: 480px; max-height: 480px; }
          .x-globe-viewport .x-globe-card { min-height: 480px !important; }
          .x-timeline-column .x-timeline { height: 420px; min-height: 420px; max-height: 420px; }
          .x-cmd-grid { flex-direction: column; }
          .x-coord-tool { flex: 1 1 100%; }
        }
        @media (max-width: 760px) {
          .x-explorer { padding: 0 12px 28px; }
          .x-topbar { padding: 10px 14px; flex-wrap: wrap; }
          .x-console-header { padding: 16px 0 12px; }
          .x-earthdata-bar { padding: 12px 14px; }
          .x-cmd-presets { grid-template-columns: 1fr; }
          .x-globe-viewport { height: 380px; min-height: 380px; max-height: 380px; }
          .x-globe-viewport .x-globe-card { min-height: 380px !important; }
          .x-timeline-column .x-timeline { height: 350px; min-height: 350px; max-height: 350px; }
          .x-globe-legend {
            bottom: 8px;
            left: 8px;
            right: 8px;
            padding: 8px 12px;
            font-size: 9.5px;
          }
          .x-coord-inputs { flex-wrap: wrap; }
          .x-coord-field { flex: 1 1 calc(50% - 4px); }
          .x-coord-submit { width: 100%; margin-top: 4px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .x-explorer * { scroll-behavior: auto !important; transition: none !important; }
        }
      `}</style>

      <div className="x-shell">
        {/* Top Navbar with Spatial Breadcrumb Anchor */}
        <div className="x-topbar-wrap">
          <header className="x-topbar">
            <a className="x-brand" href="/">
              <span className="x-brand-mark">
                <img
                  src="/nisar-lens.svg"
                  alt="NISAR Lens"
                  className="w-6 h-6 object-contain"
                />
              </span>
              <div>
                <div className="x-brand-name">NISAR LENS</div>
                <div className="x-brand-sub">
                  NASA SPACE APPS 2026 · MISSION CONSOLE
                </div>
              </div>
            </a>

            <LanguageSwitcher language={language} onChange={changeLanguage} />
          </header>
        </div>

        {/* Scientific Console Header */}
        <div className="x-console-header">
          <div className="x-console-title-group">
            <span className="x-eyebrow"><DiamondCrosshair /><span>{language === 'ru' ? 'РАДАР ПОМОГАЕТ УВИДЕТЬ, КАК МЕНЯЕТСЯ ЗЕМЛЯ' : 'SEE HOW EARTH CHANGES WITH RADAR'}</span></span>
            <h1>{language === 'ru' ? 'Что происходит на Земле?' : 'What is happening on Earth?'}</h1>
            <p>{language === 'ru' ? 'Выберите место — и посмотрите, что спутник NISAR заметил там.' : 'Pick a place and explore what the NISAR satellite saw.'}</p>
          </div>

          <div className="x-console-status-group flex items-center gap-3">
            <DotGridMark className="hidden sm:grid shrink-0" />
          </div>
        </div>

        {/* Command Station: Live NASA Earthdata Study Region Selector */}
        <section
          className="x-earthdata-bar"
          aria-label={language === 'ru' ? 'Выбор области наблюдения и поиск NASA Earthdata' : 'Scientific target selector and live NASA Earthdata search'}
        >
          {/* Top Bar: Section Header / Guidance */}
          <div className="x-cmd-header">
            <div className="x-cmd-title-wrap">
              <span className="x-cmd-eyebrow">
                <Compass size={12} className="text-[#FB7185]" aria-hidden="true" />
                <span>{language === 'ru' ? 'ШАГ 1 · ВЫБЕРИТЕ МЕСТО' : 'STEP 1 · CHOOSE A PLACE'}</span>
              </span>
              <h2 className="x-cmd-title">{language === 'ru' ? 'Где будем смотреть?' : 'Where should we look?'}</h2>
              <p className="x-cmd-desc">
                {language === 'ru' ? 'Нажмите на карточку места. Мы покажем спутниковые наблюдения для этого района.' : 'Choose a place to see the satellite observations for that area.'}
              </p>
            </div>
            {liveRecords && (
              <button
                type="button"
                className="x-cmd-restore-btn"
                onClick={() => runLiveAsfQuery(null, 'local', 'Meghna Baseline')}
                title="Restore the saved Meghna catalog"
              >
                <RefreshCw size={11} aria-hidden="true" />
                <span>{t('Restore Baseline Archive', language)}</span>
              </button>
            )}
          </div>

          {/* Interactive Row: Region Presets + Featured Product + Coordinate Search */}
          <div className="x-cmd-grid">
            {/* Presets List */}
              <div className="x-cmd-presets" role="group" aria-label={language === 'ru' ? 'Регионы наблюдений' : 'Target observation regions'}>
              {LIVE_REGION_PRESETS.map((preset) => {
                const isActive = activePreset === preset.id;
                const isLoadingThis = liveLoading && activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={liveLoading}
                    className={`x-region-card${isActive ? ' is-active' : ''}`}
                    onClick={() =>
                      runLiveAsfQuery(preset.coords, preset.id, preset.label)
                    }
                    title={`${preset.label} — ${preset.subtitle} (${preset.tag})`}
                  >
                    <div className="x-region-top">
                      <span className="x-region-indicator">
                        {isLoadingThis ? (
                          <Loader2 size={11} className="animate-spin text-[#FB7185]" />
                        ) : (
                          <Radar size={11} className={isActive ? 'text-[#FB7185]' : 'text-white/60'} />
                        )}
                      </span>
                      <span className="x-region-name">{t(preset.label, language)}</span>
                    </div>
                    <div className="x-region-meta">
                      <span className="x-region-tag">{preset.tag}</span>
                      <span className="x-region-sub">{preset.id === 'local' && isRu ? '153 записи каталога' : t(preset.subtitle, language)}</span>
                    </div>
                  </button>
                );
              })}

              {/* Special Featured L3 Product Card */}
              <button
                type="button"
                className={`x-region-card is-sme2${isSme2Active ? ' is-active' : ''}`}
                disabled={liveLoading}
                onClick={handleFocusSme2}
                title="Select and fly to the 561-pixel L3 Soil Moisture (SME2) EASE-Grid 2.0 over Svalbard"
              >
                <div className="x-region-top">
                  <span className="x-region-indicator">
                    <Sparkles size={11} className={isSme2Active ? 'text-[#FB7185]' : 'text-white/60'} />
                  </span>
                  <span className="x-region-name">{t('L3 Soil Moisture', language)}</span>
                </div>
                <div className="x-region-meta">
                  <span className="x-region-tag">561 Px · Svalbard</span>
                  <span className="x-region-sub">200m EASE-Grid 2.0</span>
                </div>
              </button>
            </div>

            {/* Custom Coordinates Search Tool */}
            <form className="x-coord-tool" onSubmit={handleCustomSearch}>
              <div className="x-coord-label">
                <Globe size={11} className="text-white/60" aria-hidden="true" />
                <span>{t('Custom Global Coordinates', language)}</span>
              </div>
              <div className="x-coord-inputs">
                <div className="x-coord-field">
                  <label htmlFor="custom-lat" className="sr-only">{t('Latitude', language)}</label>
                  <input
                    id="custom-lat"
                    type="text"
                    className="x-coord-input"
                    value={customLat}
                    onChange={(e) => { setCustomLat(e.target.value); setCoordinateError(false); }}
                    inputMode="decimal"
                    aria-describedby={coordinateError ? 'coordinate-error' : undefined}
                    placeholder={language === 'ru' ? 'Широта (напр. 23.81)' : 'Lat (e.g. 23.81)'}
                    aria-label={language === 'ru' ? 'Широта в десятичных градусах' : 'Latitude in decimal degrees'}
                  />
                  <span className="x-coord-unit">°N</span>
                </div>
                <div className="x-coord-field">
                  <label htmlFor="custom-lon" className="sr-only">{t('Longitude', language)}</label>
                  <input
                    id="custom-lon"
                    type="text"
                    className="x-coord-input"
                    value={customLon}
                    onChange={(e) => { setCustomLon(e.target.value); setCoordinateError(false); }}
                    inputMode="decimal"
                    aria-describedby={coordinateError ? 'coordinate-error' : undefined}
                    placeholder={language === 'ru' ? 'Долгота (напр. 90.41)' : 'Lon (e.g. 90.41)'}
                    aria-label={language === 'ru' ? 'Долгота в десятичных градусах' : 'Longitude in decimal degrees'}
                  />
                  <span className="x-coord-unit">°E</span>
                </div>
                <button
                  type="submit"
                  disabled={liveLoading}
                  className="x-coord-submit"
                  title="Search the NASA ASF catalog at custom coordinates"
                >
                  {liveLoading && activePreset === 'custom' ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Search size={12} aria-hidden="true" />
                  )}
                  <span>{isRu ? 'Поиск в NASA ASF' : 'Search NASA ASF'}</span>
                </button>
              </div>
            </form>
          </div>
          {coordinateError && (
            <p id="coordinate-error" className="x-query-status" role="alert">
              {isRu ? 'Введите широту от −90 до 90 и долготу от −180 до 180.' : 'Enter a latitude from −90 to 90 and a longitude from −180 to 180.'}
            </p>
          )}
          <p className={`x-query-status${liveLoading || catalogLoading ? ' is-loading' : ''}`} role="status" aria-live="polite">
            {statusMessage}
            {catalogError && <button type="button" className="x-query-retry" onClick={() => { setLiveStatusMsg(null); setCatalogRetryKey((key) => key + 1); }}>{language === 'ru' ? 'Повторить' : 'Retry'}</button>}
          </p>
        </section>

        <div className="x-advanced-filters">
        <CatalogFilters
          productTypes={types}
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(INITIAL_FILTERS)}
          resultCount={filtered.length}
          totalCount={features.length}
          coverage={coverageLabel(features)}
        />
        </div>

        {/* 2-Column Primary Geospatial Workspace (70% Globe / 30% Timeline) */}
        <div id="compare-workspace" className="x-primary-stage" tabIndex={-1}>
          <div className="x-globe-column">
            {!comparePair && (
              <div className="x-next-actions">
                <button type="button" disabled={!activeId} onClick={() => {
                  setDetailsImageRequest((value) => value + 1);
                  handleSelectObservation(activeId);
                }}>
                  {isRu ? 'Открыть выбранный снимок' : 'Open selected image'}
                  {selected && <span>{[selected.properties?.productType, selected.properties?.acquisitionDate].filter(Boolean).join(' · ')}</span>}
                </button>
                <button type="button" disabled={liveLoading || !demoPair.every(Boolean)} onClick={handleDemoCompare}>
                  {isRu ? 'Сравнить два снимка NISAR' : 'Compare two NISAR images'}
                  <span>{isRu ? 'Готовая пара GCOV · 22 сент. → 4 окт. 2026' : 'Ready-to-view GCOV pair · Sep 22 → Oct 4, 2026'}</span>
                </button>
              </div>
            )}
            <ComparePairBar
              comparePair={comparePair}
              activePartner={activePartner}
              changeProduct={changeProduct}
              onStartAutoCompare={handleStartAutoCompare}
              compareLayerMode={compareLayerMode}
              onSetCompareMode={setCompareLayerMode}
              compareOpacity={compareOpacity}
              onOpacityChange={setCompareOpacity}
              onSwapCompare={handleSwapCompare}
              onExitCompare={handleExitCompare}
            />
            {comparePair?.granuleA && comparePair?.granuleB && (
              <div className="x-comparison-notice" role="status">
                {changeError ? (
                  <>
                    {isRu ? 'Не удалось загрузить оба снимка. Проверьте соединение и доступ Earthdata.' : 'Could not load both images. Check your connection and Earthdata access.'}
                    <button type="button" onClick={() => setComparisonAttempt((value) => value + 1)}>
                      {isRu ? 'Повторить' : 'Retry'}
                    </button>
                  </>
                ) : changeProduct ? (
                  <>
                    <span>{changeProduct.source.every(({ local }) => local)
                      ? (isRu ? 'Два реальных снимка NISAR · копии NASA Earthdata сохранены в приложении' : 'Two real NISAR images · NASA Earthdata copies included with the app')
                      : (isRu ? 'NASA Earthdata · обзорные снимки NISAR' : 'NASA Earthdata · NISAR browse images')}</span>
                    {compareLayerMode !== 'curtain' && <strong>{isRu
                      ? 'Сравнение яркости обзорных PNG в общей области двух снимков.'
                      : 'Browse PNG brightness compared over the shared image extent.'}</strong>}
                    <button type="button" onClick={() => { setShowDetails(true); reveal('observation-details'); }}>
                      {isRu ? 'Открыть оценки и экспорт' : 'View estimates and export'}
                    </button>
                  </>
                ) : (isRu ? 'Загружаем два снимка…' : 'Loading both images…')}
              </div>
            )}
            {changeProduct && compareLayerMode === 'curtain' && (
              <p className="x-compare-guide">{isRu
                ? 'Проведите разделителем через одну и ту же реку или участок суши. Цвета передают радарный сигнал. Разница в цвете сама по себе не подтверждает изменение поверхности.'
                : 'Sweep the divider across the same river or patch of land. Colors represent the radar signal. Color differences alone cannot establish surface change.'}</p>
            )}
            <div className="x-globe-viewport">
              <GlobeViewer
                features={filtered}
                selectedId={activeId}
                onSelect={handleSelectObservation}
                drapeRadarOnGlobe={drapeRadarOnGlobe}
                sme2FocusTrigger={sme2FocusTrigger}
                comparePair={comparePair}
                changeProduct={changeProduct}
                compareLayerMode={compareLayerMode}
                compareOpacity={compareOpacity}
                onOpacityChange={setCompareOpacity}
                splitRatio={splitRatio}
                onSplitRatioChange={setSplitRatio}
                onExitCompare={handleExitCompare}
                onSetCompareMode={setCompareLayerMode}
                onSwapCompare={handleSwapCompare}
                onStartAutoCompare={handleStartAutoCompare}
                activePartner={activePartner}
              />
              {(!comparePair?.granuleA || !comparePair?.granuleB || changeProduct) && <div className="x-globe-legend" aria-label="Globe legend">
                {changeProduct ? (
                  compareLayerMode === 'diffDb' ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        <i style={{ background: '#E11D48', border: '1px solid #FB7185' }} aria-hidden="true" /> {isRu ? 'Темнее на B' : 'Darker in B'}
                      </span>
                      <span>
                        <i style={{ background: 'transparent', border: '1px dashed rgba(244, 244, 246, 0.4)' }} aria-hidden="true" /> {isRu ? 'Небольшая разница' : 'Little difference'}
                      </span>
                      <span>
                        <i style={{ background: '#0284C7', border: '1px solid #38BDF8' }} aria-hidden="true" /> {isRu ? 'Светлее на B' : 'Brighter in B'}
                      </span>
                    </div>
                  ) : compareLayerMode === 'curtain' ? (
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        <i style={{ background: '#F4F4F6', border: '1px solid #FFFFFF' }} aria-hidden="true" /> Date A ({comparePair.granuleA?.properties?.acquisitionDate ?? 'Ref'})
                      </span>
                      <span>
                        <i style={{ background: '#E11D48', border: '1px solid #FB7185' }} aria-hidden="true" /> Date B ({comparePair.granuleB?.properties?.acquisitionDate ?? 'Sec'})
                      </span>
                      <span>
                        <i style={{ background: '#FB7185', border: '1px solid #FDA4AF' }} aria-hidden="true" /> Interactive 3D Curtain Divider
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-4">
                      <span>
                        <i style={{ background: '#1E3A8A', border: '1px solid #3B82F6' }} aria-hidden="true" /> {isRu ? 'Ниже порога на A и B' : 'Below threshold in A and B'}
                      </span>
                      <span>
                        <i style={{ background: '#E11D48', border: '1px solid #FB7185' }} aria-hidden="true" /> {isRu ? 'Ниже порога только на B' : 'Below threshold in B only'}
                      </span>
                      <span>
                        <i style={{ background: '#38BDF8', border: '1px solid #7DD3FC' }} aria-hidden="true" /> {isRu ? 'Ниже порога только на A' : 'Below threshold in A only'}
                      </span>
                      <span>
                        <i style={{ background: 'transparent', border: '1px dashed rgba(244, 244, 246, 0.4)' }} aria-hidden="true" /> {isRu ? 'На пороге или выше на обеих датах' : 'At or above threshold in both'}
                      </span>
                    </div>
                  )
                ) : (
                  <div className="flex flex-wrap items-center gap-4">
                    <span>
                      <i aria-hidden="true" /> Ascending Track
                    </span>
                    <span>
                      <i className="x-swatch-desc" aria-hidden="true" /> Descending Track
                    </span>
                    <span>
                      <i className="x-swatch-selected" aria-hidden="true" /> Selected + Draped SAR
                    </span>
                  </div>
                )}
                <span className="x-globe-legend-hint">
                  {changeProduct
                    ? changeProduct && compareLayerMode === 'curtain'
                      ? (isRu ? 'Потяните разделитель, чтобы сравнить снимки.' : 'Drag the divider to compare the images.')
                      : null
                    : language === 'ru'
                      ? 'Выберите область на карте или наблюдение в списке · Вращайте мышью · Приближайте колёсиком'
                      : 'Select a place on the map or an observation in the list · Drag to move · Scroll to zoom'}
                </span>
              </div>}
            </div>
          </div>

          <div className="x-timeline-column">
            {pairMessage && <p className="x-comparison-notice" role="alert">{pairMessage}</p>}
            <CatalogTimeline
              features={filtered}
              selectedId={activeId}
              onSelect={handleSelectObservation}
              comparePair={comparePair}
              activePartner={activePartner}
              onSelectAsDateA={(feature) => selectCompareDate('granuleA', feature)}
              onSelectAsDateB={(feature) => selectCompareDate('granuleB', feature)}
              onAutoPair={handleStartAutoCompare}
            />
          </div>
        </div>

        {/* Secondary Analysis Workbench: Tabbed Observation Inspector */}
        {showDetails && <section id="observation-details" className="x-details-reveal" tabIndex={-1}>
          <div className="x-step-three">
            <span>{comparePair?.granuleA && comparePair?.granuleB
              ? (isRu ? 'ШАГ 3 · ОЦЕНКИ И ЭКСПОРТ' : 'STEP 3 · ESTIMATES AND EXPORT')
              : (isRu ? 'ШАГ 3 · ИЗУЧИТЕ НАБЛЮДЕНИЕ' : 'STEP 3 · EXPLORE THIS OBSERVATION')}</span>
          </div>
          <button type="button" className="x-hide-details" onClick={() => setShowDetails(false)}>
            {language === 'ru' ? 'Скрыть подробности' : 'Hide details'}
          </button>
        {changeProduct && (
          <details className="x-water-case">
            <summary>{isRu ? 'Пример анализа воды по научным данным GCOV' : 'Water analysis example from GCOV science data'}</summary>
            <p>{isRu
              ? 'Отдельная область и пара дат: 27 июня → 9 июля 2026. Карта использует канал HH на общей сетке и порог −18 дБ. Красный обозначает вероятную воду только 9 июля, жёлтый — только 27 июня. Классификация по порогу требует независимой проверки.'
              : 'A separate area and date pair: June 27 → July 9, 2026. The map uses HH on a common grid and a −18 dB threshold. Red marks possible water only on July 9 and yellow marks possible water only on June 27. The threshold classification needs independent validation.'}</p>
            <img src={waterCaseImage} loading="lazy" alt={isRu ? 'Снимки GCOV за две даты, разность сигнала и классификация воды по порогу' : 'GCOV for two dates, radar signal difference and threshold-based water classification'} />
          </details>
        )}
        {!(comparePair?.granuleA && comparePair?.granuleB && !changeProduct) && <RecordDetails
          feature={selected}
          detailsImageRequest={detailsImageRequest}
          drapeRadarOnGlobe={drapeRadarOnGlobe}
          onToggleDrapeRadar={() => setDrapeRadarOnGlobe((prev) => !prev)}
          onFlyToSme2={handleFocusSme2}
          onPinWatchpoint={handlePinWatchpoint}
          isPinned={isSelectedPinned}
          pinning={pinning}
          watchpoints={watchpoints}
          onSelectWatchpoint={handleSelectWatchpoint}
          onDeleteWatchpoint={handleDeleteWatchpoint}
          activeId={activeId}
          isStudySaved={Boolean(comparePair?.granuleA && comparePair?.granuleB &&
            watchpoints.some((item) => item.pinned_granule_id === `${comparePair.granuleA.id}__VS__${comparePair.granuleB.id}`))}
          comparePair={comparePair}
          changeProduct={changeProduct}
          activeThresholdDb={activeThresholdDb}
          onThresholdChange={handleThresholdChange}
          onExitCompare={handleExitCompare}
        />}
        </section>}
      </div>
    </main>
  );
}
