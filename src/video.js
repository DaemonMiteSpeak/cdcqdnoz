import { ApiError } from './service.js';
import { config } from './config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const isoSeconds = (d) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) : 0;
};

export function detect(url) {
  if (/^https?:\/\/((www|vm|vt|m)\.)?tiktok\.com\/\S+$/i.test(url)) return 'tiktok';
  if (/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+$/i.test(url)) return 'youtube';
  return null;
}

async function tiktok(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
  const html = await r.text();
  const m = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new ApiError(502, 'lookup_failed');
  const item = JSON.parse(m[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  if (!item) throw new ApiError(404, 'video_not_found');
  return { platform: 'tiktok', id: item.id, title: (item.desc || '').slice(0, 120) || 'TikTok', publishedAt: Number(item.createTime) * 1000, views: Number(item.stats?.playCount || 0), long: false };
}

async function youtube(url) {
  if (!process.env.YOUTUBE_API_KEY) throw new ApiError(503, 'lookup_unavailable');
  const u = new URL(url);
  const id = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') || u.pathname.split('/').filter(Boolean).pop();
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(id)}&key=${process.env.YOUTUBE_API_KEY}`, { signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  const v = j.items?.[0];
  if (!v) throw new ApiError(404, 'video_not_found');
  return { platform: 'youtube', id, title: v.snippet.title.slice(0, 120), publishedAt: Date.parse(v.snippet.publishedAt), views: Number(v.statistics.viewCount || 0), long: isoSeconds(v.contentDetails.duration) > 180 };
}

export async function lookupVideo(url) {
  const p = detect(url);
  if (!p) throw new ApiError(400, 'bad_url');
  try {
    return p === 'tiktok' ? await tiktok(url) : await youtube(url);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(502, 'lookup_failed');
  }
}
export { config };
