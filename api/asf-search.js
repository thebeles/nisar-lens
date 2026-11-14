export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = (
    process.env.EARTHDATA_TOKEN ||
    process.env.VITE_EARTHDATA_TOKEN ||
    ''
  ).trim();

  try {
    const query = req.query || {};
    const params = new URLSearchParams();
    params.set('platform', query.platform || 'NISAR');
    if (query.processingLevel) {
      params.set('processingLevel', query.processingLevel);
    }
    if (query.intersectsWith) {
      params.set('intersectsWith', query.intersectsWith);
    }
    if (query.start) params.set('start', query.start);
    if (query.end) params.set('end', query.end);
    params.set(
      'maxResults',
      String(Math.min(Number(query.maxResults) || 80, 250))
    );
    params.set('output', 'json');

    const upstreamUrl = `https://api.daac.asf.alaska.edu/services/search/param?${params.toString()}`;
    const reqHeaders = {
      Accept: 'application/json',
      'User-Agent': 'NISAR-Lens/1.0',
    };
    if (token) {
      reqHeaders.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(upstreamUrl, {
      headers: reqHeaders,
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `ASF Search API returned HTTP ${response.status}`,
      });
    }

    const payload = await response.text();

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-NISAR-Lens-Source', 'NASA-ASF-LIVE');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(payload);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Unexpected error querying NASA ASF Search API',
    });
  }
}
