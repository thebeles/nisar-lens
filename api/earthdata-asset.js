const ALLOWED_HOSTS = new Set([
  'nisar.asf.earthdatacloud.nasa.gov',
  'datapool.asf.alaska.edu',
  'cumulus.asf.earthdatacloud.nasa.gov',
  'urs.earthdata.nasa.gov',
]);

function inferContentType(urlPath, upstreamType) {
  const lower = urlPath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml'))
    return 'text/yaml; charset=utf-8';
  if (lower.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (
    upstreamType &&
    upstreamType !== 'binary/octet-stream' &&
    upstreamType !== 'application/octet-stream'
  ) {
    return upstreamType;
  }
  return 'application/octet-stream';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetUrl = req.query?.url;
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).json({ error: 'Missing required ?url= parameter' });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid target URL' });
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return res.status(403).json({
      error: `Host ${parsed.hostname} is not in the allowed NASA Earthdata domain list.`,
    });
  }

  const token = (
    process.env.EARTHDATA_TOKEN ||
    process.env.VITE_EARTHDATA_TOKEN ||
    ''
  ).trim();

  if (!token) {
    return res
      .status(500)
      .json({ error: 'Missing EARTHDATA_TOKEN in server environment' });
  }

  try {
    // Fetch live from NASA Earthdata Cloud using Earthdata Login Bearer Token
    const upstream = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'NISAR-Lens/1.0',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `NASA Earthdata Cloud returned HTTP ${upstream.status}`,
      });
    }

    const contentType = inferContentType(
      parsed.pathname,
      upstream.headers.get('content-type')
    );
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-NISAR-Lens-Source', 'NASA-EARTHDATA-LIVE');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Unexpected error proxying NASA Earthdata asset',
    });
  }
}
