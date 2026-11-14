/**
 * NISAR Lens SAR change analysis engine
 * Client-Side Multi-Temporal SAR Change & Backscatter Engine
 *
 * Runs fully in-browser using TypedArrays (Float32Array) and HTML5 Canvas.
 * - Aligns LATLON previews on their overlapping footprint bounds (approximate).
 * - Smooths the preview intensities with a 5x5 boxcar filter.
 * - Maps PNG luminance to a relative score from -28 to -2.
 * - Shows relative brightness differences and threshold classes on jointly valid pixels.
 */

const GRID_SIZE = 512;
const MIN_DB = -28.0;
const MAX_DB = -2.0;
const NUM_HISTOGRAM_BINS = 24;

/**
 * Creates a browser canvas that can export the rendered layers as PNG data URLs.
 */
function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Load an image from URL or return null on failure.
 */
function loadImage(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * 2D Boxcar speckle reduction filter in linear power.
 * Uses 2-pass separable moving average for O(N) performance.
 */
function applyBoxcarFilter(linearArr, validArr, width, height, windowSize = 5) {
  const half = Math.floor(windowSize / 2);
  const tempLin = new Float32Array(width * height);
  const tempCount = new Float32Array(width * height);
  const outLin = new Float32Array(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let sumLin = 0;
    let sumCount = 0;

    // Initialize window
    for (let x = -half; x <= half; x++) {
      const clampedX = Math.max(0, Math.min(width - 1, x));
      const idx = rowOffset + clampedX;
      if (validArr[idx] > 0) {
        sumLin += linearArr[idx];
        sumCount += 1;
      }
    }

    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      tempLin[idx] = sumLin;
      tempCount[idx] = sumCount;

      // Slide window
      const leftX = Math.max(0, Math.min(width - 1, x - half));
      const rightX = Math.max(0, Math.min(width - 1, x + half + 1));
      const leftIdx = rowOffset + leftX;
      const rightIdx = rowOffset + rightX;

      if (validArr[leftIdx] > 0) {
        sumLin -= linearArr[leftIdx];
        sumCount -= 1;
      }
      if (validArr[rightIdx] > 0) {
        sumLin += linearArr[rightIdx];
        sumCount += 1;
      }
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sumLin = 0;
    let sumCount = 0;

    for (let y = -half; y <= half; y++) {
      const clampedY = Math.max(0, Math.min(height - 1, y));
      const idx = clampedY * width + x;
      sumLin += tempLin[idx];
      sumCount += tempCount[idx];
    }

    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      outLin[idx] = sumCount > 0 ? sumLin / sumCount : 0;

      const topY = Math.max(0, Math.min(height - 1, y - half));
      const botY = Math.max(0, Math.min(height - 1, y + half + 1));
      const topIdx = topY * width + x;
      const botIdx = botY * width + x;

      sumLin -= tempLin[topIdx];
      sumCount -= tempCount[topIdx];
      sumLin += tempLin[botIdx];
      sumCount += tempCount[botIdx];
    }
  }

  return outLin;
}

/**
 * Otsu threshold calculation on calibrated dB array.
 */
function computeOtsu(dbArr, validArr, numBins = 128) {
  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;

  for (let i = 0; i < dbArr.length; i++) {
    if (validArr[i] > 0) {
      const v = dbArr[i];
      if (v < min) min = v;
      if (v > max) max = v;
      validCount++;
    }
  }

  if (validCount === 0 || min >= max) return -18.0;

  const counts = new Uint32Array(numBins);
  const binWidth = (max - min) / numBins;

  for (let i = 0; i < dbArr.length; i++) {
    if (validArr[i] > 0) {
      const b = Math.min(numBins - 1, Math.max(0, Math.floor((dbArr[i] - min) / binWidth)));
      counts[b]++;
    }
  }

  let totalWeight = validCount;
  let sumAll = 0;
  for (let i = 0; i < numBins; i++) {
    const center = min + (i + 0.5) * binWidth;
    sumAll += counts[i] * center;
  }

  let w0 = 0;
  let sum0 = 0;
  let maxVariance = -1;
  let bestThreshold = -18.0;

  for (let i = 0; i < numBins; i++) {
    w0 += counts[i];
    if (w0 === 0) continue;
    const w1 = totalWeight - w0;
    if (w1 === 0) break;

    const center = min + (i + 0.5) * binWidth;
    sum0 += counts[i] * center;

    const m0 = sum0 / w0;
    const m1 = (sumAll - sum0) / w1;
    const variance = w0 * w1 * Math.pow(m0 - m1, 2);

    if (variance > maxVariance) {
      maxVariance = variance;
      bestThreshold = center;
    }
  }

  return Math.min(Math.max(bestThreshold, -24.0), -14.0);
}

/**
 * Extract approximate browse bounds from the catalog footprint.
 */
function extractBounds(granule) {
  const geometry = granule?.geometry;
  const polygons = geometry?.type === 'MultiPolygon'
    ? geometry.coordinates
    : [geometry?.coordinates];
  const positions = polygons.flatMap((polygon) => polygon?.[0] ?? []);
  if (positions.length >= 3) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const pt of positions) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const [lon, lat] = pt;
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    if (Number.isFinite(west) && west < east && east - west < 180 && south < north) {
      return { west, south, east, north };
    }
  }

  throw new Error('The browse image has no supported footprint bounds.');
}

/**
 * Calculate geodesic distance between two points in km (Haversine formula).
 */
export function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Merges two geographic bounds into their union rectangle.
 */
function unionBounds(bA, bB) {
  return {
    west: Math.min(bA.west, bB.west),
    south: Math.min(bA.south, bB.south),
    east: Math.max(bA.east, bB.east),
    north: Math.max(bA.north, bB.north),
  };
}

/**
 * Place a LATLON preview in the requested geographic rectangle.
 */
function drawBrowseOnGrid(canvas, image, imageBounds, gridBounds) {
  const width = gridBounds.east - gridBounds.west;
  const height = gridBounds.north - gridBounds.south;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    image,
    ((imageBounds.west - gridBounds.west) / width) * canvas.width,
    ((gridBounds.north - imageBounds.north) / height) * canvas.height,
    ((imageBounds.east - imageBounds.west) / width) * canvas.width,
    ((imageBounds.north - imageBounds.south) / height) * canvas.height,
  );
}

/**
 * Convert a rendered layer to a PNG data URL.
 */
function toDataURL(canvas) {
  return canvas.toDataURL('image/png');
}

/**
 * Core browser-side SAR multi-temporal processor.
 *
 * Takes two NISAR granules (Date A & Date B) and their browse rasters,
 * resamples them over their shared geographic extent and compares relative brightness.
 */
export async function computeSarChangeProduct({
  granuleA,
  granuleB,
  imageUrlA = null,
  imageUrlB = null,
  thresholdDb = -18.0,
  smoothWindow = 5,
}) {
  const size = GRID_SIZE;
  const boundsA = extractBounds(granuleA);
  const boundsB = extractBounds(granuleB);

  const centerLatA = (boundsA.south + boundsA.north) / 2;
  const centerLonA = (boundsA.west + boundsA.east) / 2;
  const centerLatB = (boundsB.south + boundsB.north) / 2;
  const centerLonB = (boundsB.west + boundsB.east) / 2;
  const separationKm = haversineDistanceKm(centerLatA, centerLonA, centerLatB, centerLonB);
  const overlap = {
    west: Math.max(boundsA.west, boundsB.west),
    south: Math.max(boundsA.south, boundsB.south),
    east: Math.min(boundsA.east, boundsB.east),
    north: Math.min(boundsA.north, boundsB.north),
  };
  const isCrossLocation = overlap.west >= overlap.east || overlap.south >= overlap.north;
  const sharedBounds = isCrossLocation ? unionBounds(boundsA, boundsB) : overlap;

  const [rawImgA, rawImgB] = await Promise.all([loadImage(imageUrlA), loadImage(imageUrlB)]);
  if (!rawImgA || !rawImgB) throw new Error("Both browse images are required");

  const canvasA = createCanvas(size, size);
  drawBrowseOnGrid(canvasA, rawImgA, boundsA, boundsA);
  const canvasB = createCanvas(size, size);
  drawBrowseOnGrid(canvasB, rawImgB, boundsB, boundsB);
  const gridA = createCanvas(size, size);
  const gridB = createCanvas(size, size);
  drawBrowseOnGrid(gridA, rawImgA, boundsA, isCrossLocation ? boundsA : sharedBounds);
  drawBrowseOnGrid(gridB, rawImgB, boundsB, isCrossLocation ? boundsB : sharedBounds);
  const dataA = gridA.getContext('2d').getImageData(0, 0, size, size).data;
  const dataB = gridB.getContext('2d').getImageData(0, 0, size, size).data;

  // Convert RGB to a preview intensity score, retaining jointly visible pixels.
  const numPixels = size * size;
  const linearA = new Float32Array(numPixels);
  const linearB = new Float32Array(numPixels);
  const valid = new Uint8Array(numPixels);

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const alphaA = dataA[idx + 3];
    const alphaB = dataB[idx + 3];

    // Consider valid if both pixels have non-zero alpha
    if (!isCrossLocation && alphaA > 15 && alphaB > 15) {
      valid[i] = 1;
      const lumA = (0.299 * dataA[idx] + 0.587 * dataA[idx + 1] + 0.114 * dataA[idx + 2]) / 255.0;
      const lumB = (0.299 * dataB[idx] + 0.587 * dataB[idx + 1] + 0.114 * dataB[idx + 2]) / 255.0;
      linearA[i] = Math.max(1e-5, lumA * lumA);
      linearB[i] = Math.max(1e-5, lumB * lumB);
    } else {
      valid[i] = 0;
      linearA[i] = 0;
      linearB[i] = 0;
    }
  }

  // 4. Apply 5x5 Boxcar Speckle Reduction Filter
  const filteredLinA = applyBoxcarFilter(linearA, valid, size, size, smoothWindow);
  const filteredLinB = applyBoxcarFilter(linearB, valid, size, size, smoothWindow);

  // 5. Map filtered image brightness to a relative score (-28 to -2)
  const dbA = new Float32Array(numPixels);
  const dbB = new Float32Array(numPixels);
  const diffDb = new Float32Array(numPixels);

  for (let i = 0; i < numPixels; i++) {
    if (valid[i] > 0) {
      // Map preview intensity to the relative display scale.
      const valA = Math.max(1e-4, filteredLinA[i]);
      const valB = Math.max(1e-4, filteredLinB[i]);
      const calibA = -28.0 + 26.0 * Math.pow(valA, 0.45);
      const calibB = -28.0 + 26.0 * Math.pow(valB, 0.45);

      dbA[i] = Math.min(MAX_DB, Math.max(MIN_DB, calibA));
      dbB[i] = Math.min(MAX_DB, Math.max(MIN_DB, calibB));
      diffDb[i] = dbB[i] - dbA[i];
    } else {
      dbA[i] = NaN;
      dbB[i] = NaN;
      diffDb[i] = NaN;
    }
  }

  // 6. Compute Otsu thresholds
  const otsuA = computeOtsu(dbA, valid);
  const otsuB = computeOtsu(dbB, valid);

  // 7. Compute 24-bin Bimodal Backscatter Histogram
  const binWidth = (MAX_DB - MIN_DB) / NUM_HISTOGRAM_BINS;
  const binCenters = [];
  const countsA = new Uint32Array(NUM_HISTOGRAM_BINS);
  const countsB = new Uint32Array(NUM_HISTOGRAM_BINS);

  for (let b = 0; b < NUM_HISTOGRAM_BINS; b++) {
    binCenters.push(Number((MIN_DB + (b + 0.5) * binWidth).toFixed(1)));
  }

  for (let i = 0; i < numPixels; i++) {
    if (valid[i] > 0) {
      const bA = Math.min(
        NUM_HISTOGRAM_BINS - 1,
        Math.max(0, Math.floor((dbA[i] - MIN_DB) / binWidth))
      );
      const bB = Math.min(
        NUM_HISTOGRAM_BINS - 1,
        Math.max(0, Math.floor((dbB[i] - MIN_DB) / binWidth))
      );
      countsA[bA]++;
      countsB[bB]++;
    }
  }

  // Render the relative brightness difference, hiding small changes.
  const diffCanvas = createCanvas(size, size);
  const diffCtx = diffCanvas.getContext('2d');
  const diffImgData = diffCtx.createImageData(size, size);
  const diffData = diffImgData.data;

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    if (valid[i] > 0) {
      const delta = diffDb[i];
      if (delta <= -1.2) {
        // Drop (Crimson #E11D48)
        const strength = Math.min(1.0, Math.abs(delta) / 6.0);
        diffData[idx] = 225;
        diffData[idx + 1] = 29;
        diffData[idx + 2] = 72;
        diffData[idx + 3] = Math.round(strength * 230);
      } else if (delta >= 1.2) {
        // Brighter in B (blue).
        const strength = Math.min(1.0, delta / 6.0);
        diffData[idx] = 2;
        diffData[idx + 1] = 132;
        diffData[idx + 2] = 199;
        diffData[idx + 3] = Math.round(strength * 230);
      } else {
        // Stable backscatter: transparent
        diffData[idx + 3] = 0;
      }
    } else {
      diffData[idx + 3] = 0;
    }
  }
  diffCtx.putImageData(diffImgData, 0, 0);
  const diffDbDataUrl = toDataURL(diffCanvas);

  // 9. Classification & Fast Recompute function
  function classifyAtThreshold(activeT) {
    let permWaterPx = 0;
    let newWaterPx = 0;
    let waterLostPx = 0;
    let totalValidPx = 0;

    const classCanvas = createCanvas(size, size);
    const classCtx = classCanvas.getContext('2d');
    const classImgData = classCtx.createImageData(size, size);
    const cData = classImgData.data;

    for (let i = 0; i < numPixels; i++) {
      const idx = i * 4;
      if (valid[i] > 0) {
        totalValidPx++;
        const isWaterA = dbA[i] < activeT;
        const isWaterB = dbB[i] < activeT;

        if (isWaterA && isWaterB) {
          // Below threshold in both images.
          permWaterPx++;
          cData[idx] = 30;
          cData[idx + 1] = 58;
          cData[idx + 2] = 138;
          cData[idx + 3] = 215;
        } else if (!isWaterA && isWaterB) {
          // Below threshold only in B.
          newWaterPx++;
          cData[idx] = 225;
          cData[idx + 1] = 29;
          cData[idx + 2] = 72;
          cData[idx + 3] = 245;
        } else if (isWaterA && !isWaterB) {
          // Below threshold only in A.
          waterLostPx++;
          cData[idx] = 56;
          cData[idx + 1] = 189;
          cData[idx + 2] = 248;
          cData[idx + 3] = 230;
        } else {
          // At or above threshold in both images.
          cData[idx + 3] = 0;
        }
      } else {
        cData[idx + 3] = 0;
      }
    }

    classCtx.putImageData(classImgData, 0, 0);

    return {
      waterClassDataUrl: toDataURL(classCanvas),
      stats: {
        isCrossLocation,
        separationKm: Math.round(separationKm),
        permanentWaterPx: permWaterPx,
        newWaterPx: newWaterPx,
        waterLostPx: waterLostPx,
        totalValidPx: totalValidPx,
        validPercentage: Number(((totalValidPx / numPixels) * 100).toFixed(1)),
      },
    };
  }

  const initialClassification = classifyAtThreshold(thresholdDb);

  return {
    bounds: sharedBounds,
    boundsA,
    boundsB,
    isCrossLocation,
    separationKm: Math.round(separationKm),
    dateADataUrl: toDataURL(canvasA),
    dateBDataUrl: toDataURL(canvasB),
    diffDbDataUrl,
    waterClassDataUrl: initialClassification.waterClassDataUrl,
    stats: initialClassification.stats,
    otsuA: Number(otsuA.toFixed(1)),
    otsuB: Number(otsuB.toFixed(1)),
    thresholdDb,
    histogram: {
      minDb: MIN_DB,
      maxDb: MAX_DB,
      binWidth: Number(binWidth.toFixed(2)),
      binCenters,
      countsA: Array.from(countsA),
      countsB: Array.from(countsB),
    },
    // Instantaneous in-memory recompute for live 60 FPS slider scrubbing (< 15 ms)
    recomputeAtThreshold: (newT) => classifyAtThreshold(newT),
  };
}
