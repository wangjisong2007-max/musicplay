// MusicPlay Server — 多源音乐 API + 静态服务 + WebDAV + 歌词
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ============ UTILS ============
function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }
function b64Encode(data) { return Buffer.from(data, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); }

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

// ============ NETASE EAPI ============
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
    return { id: String(s.id), name: s.name || '', singer: (s.ar || []).map(a => a.name).join('、'), album: s.al?.name || '', duration: Math.floor((s.dt || 0) / 1000), img: s.al?.picUrl || '', source: 'wy' };
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

async function wyLyric(songId) {
  const body = await fetchJson('https://interface3.music.163.com/eapi/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Origin': 'https://music.163.com' },
    body: eapi('/api/song/lyric', { id: String(songId), lv: -1, tv: -1, rv: -1 }),
  });
  if (body.status !== 200) return '';
  return body.body?.lrc?.lyric || body.body?.tlyric?.lyric || '';
}

// ============ LX API ============
const LX_API = 'https://88.lxmusic.xn--fiqs8s';
const LX_KEY = 'lxmusic';

async function lxUrl(songId, source = 'kw', quality = '128k') {
  const url = `${LX_API}/v4/url/${source}/${songId}/${quality}`;
  const body = await fetchJson(url, { headers: { 'User-Agent': UA, 'X-Request-Key': LX_KEY } });
  if (body.status !== 200 || body.body.code !== 0) return '';
  return body.body.data || '';
}

// ============ KUWO ============
async function kwSearch(keywords, limit = 20) {
  const url = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keywords)}&pn=0&rn=${limit}&ft=music&rformat=json&encoding=utf8&mobi=1`;
  const body = await fetchJson(url);
  if (!body.body?.abslist) return [];
  return body.body.abslist.map(s => ({
    id: String(s.MUSICRID || '').replace('MUSIC_', ''), name: s.SONGNAME || s.NAME || '', singer: s.ARTIST || s.SINGER || '', album: s.ALBUM || '', duration: parseInt(s.DURATION || '0'), img: '', source: 'kw',
  }));
}

// ============ MIGU ============
async function mgSearch(keywords, limit = 20) {
  const url = `https://app.c.nf.migu.cn/MIGUM2.0/v1.0/content/search_all.do?isCopyright=1&pageNo=1&pageSize=${limit}&searchSwitch={%22song%22:1}&sort=0&text=${encodeURIComponent(keywords)}`;
  const body = await fetchJson(url, { headers: { 'Referer': 'https://m.music.migu.cn/' } });
  if (body.body.code !== '000000') return [];
  const songs = body.body.songResultData?.resultList?.[0] || [];
  return songs.map(s => {
    const alb = s.albums?.[0] || {};
    const img = s.imgItems?.[1]?.img || s.imgItems?.[0]?.img || '';
    return { id: String(s.copyrightId || s.id || ''), name: s.name || '', singer: (s.singers || []).map(a => a.name).join('、'), album: alb.name || '', duration: 0, img, source: 'mg' };
  });
}

// ============ AGGREGATE ============
async function multiSearch(keywords, limit = 12) {
  const results = await Promise.allSettled([wySearch(keywords, limit), kwSearch(keywords, limit), mgSearch(keywords, limit)]);
  const all = [];
  for (const r of results) { if (r.status === 'fulfilled') all.push(...r.value); }
  return all;
}

// ============ WEBDAV CLIENT (lightweight, no deps) ============
async function webdavRequest(webdavUrl, method, filePath, body, auth) {
  const u = new URL(webdavUrl);
  const fullPath = u.pathname.replace(/\/$/, '') + '/' + filePath.replace(/^\//, '');
  const mod = u.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': UA,
    'Content-Type': body ? 'application/octet-stream' : undefined,
    'Content-Length': body ? Buffer.byteLength(body).toString() : undefined,
  };
  if (auth) {
    const authStr = Buffer.from(auth.user + ':' + auth.pass).toString('base64');
    headers['Authorization'] = 'Basic ' + authStr;
  }
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: fullPath, method, headers,
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ============ HTTP ROUTER ============
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

let customSourceScript = null;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;

  // CORS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  if (p === '/api/sources') return sendJSON(res, {
    sources: [{ id: 'all', name: '聚合' }, { id: 'lx', name: '洛雪' }, { id: 'kw', name: '酷我' }, { id: 'mg', name: '咪咕' }, { id: 'wy', name: '网易云' }],
  });

  // Custom source
  if (p === '/api/custom-source' && req.method === 'POST') {
    try {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          const script = body.script || '';
          if (!script || script.length > 500000) return sendJSON(res, { ok: false, error: '脚本无效或过大' });
          customSourceScript = script;
          const srcMatch = script.match(/MUSIC_SOURCE\s*=\s*\[([^\]]*)\]/);
          let sources = [];
          if (srcMatch) {
            const ids = srcMatch[1].replace(/['"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
            const nameMap = { kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易云', mg: '咪咕', local: '本地' };
            sources = ids.map(id => ({ id, name: nameMap[id] || id.toUpperCase() }));
          }
          new Function('globalThis', script);
          sendJSON(res, { ok: true, name: '自定义音源', sources });
        } catch (e) { sendJSON(res, { ok: false, error: '脚本语法错误: ' + e.message }); }
      });
    } catch (_) { sendJSON(res, { ok: false, error: '服务器错误' }, 500); }
    return;
  }
  if (p === '/api/custom-source/reset' && req.method === 'POST') { customSourceScript = null; return sendJSON(res, { ok: true }); }

  // Search
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

  // Leaderboard
  if (p === '/api/leaderboard') {
    try {
      const { playlist_detail } = require('NeteaseCloudMusicApi');
      const r = await playlist_detail({ id: '3778678', s: 0 });
      const tracks = (r.body?.playlist?.tracks || []).slice(0, 15);
      const list = tracks.map(t => ({ id: String(t.id), name: t.name || '', singer: (t.ar || []).map(a => a.name).join('、'), album: t.al?.name || '', duration: Math.floor((t.dt || 0) / 1000), img: t.al?.picUrl || '', source: 'wy' }));
      sendJSON(res, { list, name: '热歌榜' });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  // Recommend
  if (p === '/api/recommend') {
    try {
      const { personalized } = require('NeteaseCloudMusicApi');
      const r = await personalized({ limit: 8, cookie: '' });
      const list = (r.body?.result || []).map(p => ({ id: String(p.id), name: p.name || '', desc: p.copywriter || '', img: p.picUrl || '', count: p.trackCount || 0 }));
      sendJSON(res, { list });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  // Song URL
  if (p === '/api/song/url') {
    const id = u.searchParams.get('id'), src = u.searchParams.get('source') || 'wy', quality = u.searchParams.get('quality') || '128k';
    const name = u.searchParams.get('name') || '', singer = u.searchParams.get('singer') || '';
    if (!id) return sendJSON(res, { url: '' }, 400);
    try {
      let url = '';
      if (src === 'wy') url = await wyUrl(id, quality);
      else if (src === 'lx') url = await lxUrl(id, 'kw', quality);
      if (!url && (src === 'kw' || src === 'mg')) url = await lxUrl(id, src, quality);
      if (!url && (src === 'kw' || src === 'mg') && name) {
        const wyResults = await wySearch(`${name} ${singer}`, 3);
        if (wyResults[0]) url = await wyUrl(wyResults[0].id, quality);
      }
      sendJSON(res, { url, playable: !!url });
    } catch (e) { sendJSON(res, { url: '', error: e.message }, 500); }
    return;
  }

  // Lyrics
  if (p === '/api/lyrics') {
    const id = u.searchParams.get('id'), src = u.searchParams.get('source') || 'wy';
    if (!id) return sendJSON(res, { lrc: '' });
    try {
      let lrc = '';
      if (src === 'wy') lrc = await wyLyric(id);
      sendJSON(res, { lrc });
    } catch (e) { sendJSON(res, { lrc: '', error: e.message }, 500); }
    return;
  }

  // Audio proxy
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

  // ============ Open API v1 ============
  if (p === '/api/v1/player/status') {
    return sendJSON(res, { status: 'ok', version: '2.0', sources: ['wy', 'kw', 'mg'], customSource: !!customSourceScript });
  }
  if (p === '/api/v1/search') {
    const q = u.searchParams.get('q') || '';
    const limit = Math.min(50, parseInt(u.searchParams.get('limit') || '20'));
    if (!q) return sendJSON(res, { list: [] });
    try {
      const list = await multiSearch(q, limit);
      sendJSON(res, { list });
    } catch (e) { sendJSON(res, { list: [], error: e.message }, 500); }
    return;
  }

  // ============ WebDAV ============
  if (p === '/api/webdav/test' && req.method === 'POST') {
    try {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const { url, user, pass } = JSON.parse(Buffer.concat(chunks).toString());
          if (!url) return sendJSON(res, { ok: false, error: '地址为空' });
          const r = await webdavRequest(url, 'PROPFIND', '', null, { user, pass });
          sendJSON(res, { ok: r.status >= 200 && r.status < 300 });
        } catch (e) { sendJSON(res, { ok: false, error: e.message }); }
      });
    } catch (_) { sendJSON(res, { ok: false, error: '请求错误' }, 500); }
    return;
  }

  if (p === '/api/webdav/backup' && req.method === 'POST') {
    try {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const { url, user, pass, data } = JSON.parse(Buffer.concat(chunks).toString());
          if (!url || !data) return sendJSON(res, { ok: false, error: '参数不足' });
          const r = await webdavRequest(url, 'PUT', 'musicplay-settings.json', data, { user, pass });
          sendJSON(res, { ok: r.status >= 200 && r.status < 300 });
        } catch (e) { sendJSON(res, { ok: false, error: e.message }); }
      });
    } catch (_) { sendJSON(res, { ok: false, error: '请求错误' }, 500); }
    return;
  }

  if (p === '/api/webdav/restore' && req.method === 'POST') {
    try {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const { url, user, pass } = JSON.parse(Buffer.concat(chunks).toString());
          if (!url) return sendJSON(res, { ok: false, error: '参数不足' });
          const r = await webdavRequest(url, 'GET', 'musicplay-settings.json', null, { user, pass });
          if (r.status >= 200 && r.status < 300) sendJSON(res, { ok: true, data: r.body });
          else sendJSON(res, { ok: false, error: '文件不存在或权限不足 (HTTP ' + r.status + ')' });
        } catch (e) { sendJSON(res, { ok: false, error: e.message }); }
      });
    } catch (_) { sendJSON(res, { ok: false, error: '请求错误' }, 500); }
    return;
  }

  // Static files
  let filePath = p === '/' ? '/index.html' : p;
  filePath = path.join(__dirname, 'public', filePath);
  const ext = path.extname(filePath);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
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
