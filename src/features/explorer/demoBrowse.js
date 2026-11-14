export const DEMO_DATES = ['2026-09-22', '2026-10-04'];

const demoBrowse = new Map([
  ['NISAR_L2_PR_GCOV_031_069_A_015_4005_DHDH_A_20260922T232205_20260922T232240_P05023_N_F_J_001_LATLON.png', DEMO_DATES[0]],
  ['NISAR_L2_PR_GCOV_032_069_A_015_4005_DHDH_A_20261004T232205_20261004T232240_P05023_N_F_J_001_LATLON.png', DEMO_DATES[1]],
]);

export function getLocalBrowseUrl(url) {
  const date = url && demoBrowse.get(url.split('/').pop());
  return date ? `${import.meta.env.BASE_URL}data/demo/gcov-${date}.png` : null;
}

export function getBrowseUrl(url) {
  return url ? getLocalBrowseUrl(url) ?? `/api/earthdata-asset?url=${encodeURIComponent(url)}` : null;
}
