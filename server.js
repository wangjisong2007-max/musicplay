// MusicPlay Server — 多源音乐 API + 静态服务
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ============ 工具函数 ============
function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: opts.method || 'GET',
      headers: Object.assign({ 'User-Agent': UA }, opts.headers || {}),
      timeout: 12000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function sendJSON(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ============ 网易云 eapi ============
const EAPI_KEY = 'e82ckenh8dichen8';

function eapi(url, obj) {
  const text = JSON.stringify(obj);
  const msg = `nobody${url}use${text}md5forencrypt`;
  const digest = md5(msg);
  const data = `${url}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', EAPI_KEY, '');
  cipher.setAutoPadding(true);
  let enc = cipher.update(data, 'utf8', 'hex');
  enc += cipher.final('hex');
  return new URLSearchParams({ params: enc.toUpperCase() }).toString();
}

async function wySearch(keywords, limit = 20) {
  const body = await fetchJson('https://interface3.music.163.com/eapi/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://music.163.com' },
    body: eapi('/api/search/song/list/page', { keyword: keywords, needCorrect: '1', limit, offset: 0, scene: 'normal', total: true }),
  });
  if (body.status !== 200 || body.body.code !== 200) return [];
  return (body.body.data?.resources || []).map(r => {
    const s = r.baseInfo?.simpleSongData || r;
    return {
      id: String(s.id), name: s.name || '', singer: (s.ar || []).map(a => a.name).join('、'),
      album: s.al?.name || '', duration: Math.floor((s.dt || 0) / 1000),
      img: s.al?.picUrl || '', source: 'wy',
    };
  });
}

async function wyUrl(songId, quality = '128k') {
  const brMap = { '128k': 128000, '320k': 320000, flac: 999000 };
  const body = await fetchJson('https://interface3.music.163.com/eapi/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://music.163.com' },
    body: eapi('/api/song/enhance/player/url', { ids: `[${songId}]`, br: brMap[quality] || 128000, encodeType: 'mp3' }),
  });
  if (body.status !== 200) return '';
  const d = (body.body.data || [])[0];
  return d?.url || '';
}

// ============ 洛雪 API (URL解析, 全平台无损) ============
const LX_API = 'https://88.lxmusic.xn--fiqs8s';
const LX_KEY = 'lxmusic';

function b64Encode(data) {
  return Buffer.from(data, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

async function lxUrl(songId, source = 'kw', quality = '128k') {
  const url = `${LX_API}/v4/url/${source}/${songId}/${quality}`;
  const body = await fetchJson(url, {
    headers: { 'User-Agent': UA, 'X-Request-Key': LX_KEY },
  });
  if (body.status !== 200 || body.body.code !== 0) return '';
  return body.body.data || '';
}

// ============ 酷我搜索 ============
async function kwSearch(keywords, limit = 20) {
  const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keywords)}&pn=0&rn=${limit}&ft=music&rformat=json&encoding=utf8&mobi=1`;
  const body = await fetchJson(url);
  if (!body.body?.abslist) return [];
  return body.body.abslist.map(s => ({
    id: String(s.MUSICRID || '').replace('MUSIC_', ''),
    name: s.SONGNAME || s.NAME || '',
    singer: s.ARTIST || s.SINGER || '',
    album: s.ALBUM || '',
    duration: parseInt(s.DURATION || '0'),
    img: '', source: 'kw',
  }));
}

// ============ 咪咕搜索 ============
async function mgSearch(keywords, limit = 20) {
  const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCopyright=1&pageNo=1&pageSize=${limit}&searchSwitch={%22song%22:1}&sort=0&text=${encodeURIComponent(keywords)}`;
  const body = await fetchJson(url, { headers: { 'Referer': 'https://m.music.migu.cn/' } });
  if (body.body.code !== '000000') return [];
  const songs = body.body.songResultData?.resultList?.[0] || [];
  return songs.map(s => {
    const alb = s.albums?.[0] || {};
    const img = s.imgItems?.[1]?.img || s.imgItems?.[0]?.img || '';
    return {
      id: String(s.copyrightId || s.id || ''),
      name: s.name || '', singer: (s.singers || []).map(a => a.name).join('、'),
      album: alb.name || '', duration: 0, img, source: 'mg',
    };
  });
}

// ============ 聚合搜索 ============
async function multiSearch(keywords, limit = 12) {
  const results = await Promise.allSettled([
    wySearch(keywords, limit),
    kwSearch(keywords, limit),
    mgSearch(keywords, limit),
  ]);
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  return all;
}

// ============ HTTP 路由 ============
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

let customSourceScript = null; // user-imported source script

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  if (p === '/api/sources') return sendJSON(res, {
    sources: [{ id: 'all', name: '聚合' }, { id: 'lx', name: '洛雪' }, { id: 'kw', name: '酷我' }, { id: 'mg', name: '咪咕' }, { id: 'wy', name: '网易云' }],
  });

  // 自定义音源导入
  if (p === '/api/custom-source' && req.method === 'POST') {
    try {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const script = body.script || '';
          if (!script || script.length > 500000) return sendJSON(res, { ok: false, error: '脚本无效或过大' });
          // Store in memory
          try {
          customSourceScript = script;
          // Parse MUSIC_SOURCE from script to get available platforms
          const srcMatch = script.match(/MUSIC_SOURCE\s*=\s*\[([^\]]*)\]/);
          const qualityMatch = script.match(/MUSIC_QUALITY\s*=\s*(\{[^}]+\})/s);
          let sources = [];
          if (srcMatch) {
            const ids = srcMatch[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
            const nameMap = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易云', mg: '咪咕', local: '本地' };
            sources = ids.map(id => ({ id, name: nameMap[id] || id.toUpperCase() }));
          }
          // Validate script syntax
          new Function('globalThis', script);
          sendJSON(res, { ok: true, name: '自定义音源', sources });
          } catch (e) {
            sendJSON(res, { ok: false, error: '脚本语法错误: ' + e.message });
          }
        } catch (e) {
          sendJSON(res, { ok: false, error: '请求解析失败' });
        }
      });
    } catch (_) { sendJSON(res, { ok: false, error: '服务器错误' }, 500); }
    return;
  }

  // 重置为内置音源
  if (p === '/api/custom-source/reset' && req.method === 'POST') {
    customSourceScript = null;
    return sendJSON(res, { ok: true });
  }

  if (p === '/api/search') {
    const q = u.searchParams.get('q') || '';
    const src = u.searchParams.get('source') || 'all';
    const limit = Math.min(30, parseInt(u.searchParams.get('limit') || '15'));
    if (!q) return sendJSON(res, { list: [] });
    try {
      let list;
      if (src === 'wy') list = await wySearch(q, limit);
      else if (src === 'kw') list = await kwSearch(q, limit);
      else if (src === 'mg') list = await mgSearch(q, limit);
      else if (src === 'lx') list = await multiSearch(q, limit);
      else list = await multiSearch(q, limit);
      sendJSON(res, { list });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  // 排行榜
  if (p === '/api/leaderboard') {
    try {
      const { playlist_detail } = require('NeteaseCloudMusicApi');
      const r = await playlist_detail({ id: '3778678', s: 0 });
      const tracks = (r.body?.playlist?.tracks || []).slice(0, 15);
      const list = tracks.map(t => ({
        id: String(t.id), name: t.name || '', singer: (t.ar || []).map(a => a.name).join('、'),
        album: t.al?.name || '', duration: Math.floor((t.dt || 0) / 1000), img: t.al?.picUrl || '', source: 'wy',
      }));
      sendJSON(res, { list, name: '热歌榜' });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  // 推荐歌单
  if (p === '/api/recommend') {
    try {
      const { personalized } = require('NeteaseCloudMusicApi');
      const r = await personalized({ limit: 8, cookie: '' });
      const list = (r.body?.result || []).map(p => ({
        id: String(p.id), name: p.name || '', desc: p.copywriter || '', img: p.picUrl || '', count: p.trackCount || 0,
      }));
      sendJSON(res, { list });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  if (p === '/api/song/url') {
    const id = u.searchParams.get('id');
    const src = u.searchParams.get('source') || 'wy';
    const quality = u.searchParams.get('quality') || '128k';
    const name = u.searchParams.get('name') || '';
    const singer = u.searchParams.get('singer') || '';
    if (!id) return sendJSON(res, { url: '' }, 400);
    try {
      let url = '';
      if (src === 'wy') url = await wyUrl(id, quality);
      else if (src === 'lx') url = await lxUrl(id, 'kw', quality);
      // Try lx as fallback for kw/mg before wy fallback
      if (!url && (src === 'kw' || src === 'mg')) {
        url = await lxUrl(id, src, quality);
      }
      // wy as ultimate fallback
      if (!url && (src === 'kw' || src === 'mg') && name) {
        const wyResults = await wySearch(`${name} ${singer}`, 3);
        if (wyResults[0]) url = await wyUrl(wyResults[0].id, quality);
      }
      sendJSON(res, { url, playable: !!url });
    } catch (e) { sendJSON(res, { url: '', error: e.message }, 500); }
    return;
  }

  if (p === '/api/audio') {
    const audioUrl = u.searchParams.get('url');
    if (!audioUrl) { res.writeHead(400); res.end(); return; }
    try {
      const au = new URL(audioUrl);
      const mod = au.protocol === 'https:' ? https : http;
      mod.get(audioUrl, (proxy) => {
        res.writeHead(proxy.statusCode || 200, { 'Content-Type': proxy.headers['content-type'] || 'audio/mpeg' });
        proxy.pipe(res);
      }).on('error', () => { res.writeHead(502); res.end(); });
    } catch (_) { res.writeHead(400); res.end(); }
    return;
  }

  // 静态文件
  let filePath = p === '/' ? '/index.html' : p;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    // SPA fallback
    try {
      const idx = path.join(__dirname, 'public', 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(idx).pipe(res);
    } catch (__) { res.writeHead(404); res.end(); }
  }
});

server.listen(PORT, () => {
  console.log(`MusicPlay Server listening on http://localhost:${PORT}`);
});
