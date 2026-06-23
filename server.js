const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const OpenCC = require('opencc-js');

const root = __dirname;
const host = '127.0.0.1';
const port = process.env.PORT ? Number(process.env.PORT) : 4173;
const ffmpegPath = process.env.FFMPEG_PATH || (fs.existsSync(path.join(root, 'bin', 'ffmpeg.exe')) ? path.join(root, 'bin', 'ffmpeg.exe') : 'ffmpeg');
const tempRoot = path.join(root, '.tmp');
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });
const toTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.m4a', 'audio/mp4'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-File-Name',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}`));
    });
  });
}

async function convertToM4A(inputBuffer, extension) {
  await fsp.mkdir(tempRoot, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(tempRoot, 'm4a-'));
  const inputPath = path.join(workDir, `input${extension}`);
  const outputPath = path.join(workDir, 'output.m4a');
  try {
    await fsp.writeFile(inputPath, inputBuffer);
    await runProcess(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map_metadata',
      '0',
      '-vn',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
    return await fsp.readFile(outputPath);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSearchName(fileName) {
  let name = path.basename(fileName, path.extname(fileName));
  name = name
    .replace(/^[\s._-]*\d{1,3}[\s._-]+/, '')
    .replace(/\[[^\]]*(official|audio|video|mv|lyrics?|動態歌詞|歌词|歌詞|高音質|完整版)[^\]]*\]/gi, '')
    .replace(/\([^)]*(official|audio|video|mv|lyrics?|動態歌詞|歌词|歌詞|高音質|完整版)[^)]*\)/gi, '')
    .replace(/[＿_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = name.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  const title = parts.length > 1 ? parts.at(-1) : name;
  const artist = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  return { original: name, title, artist };
}

function scoreResult(result, title, artist) {
  const normalize = (value) => value.toLowerCase().replace(/[\s()[\]（）【】·._-]+/g, '');
  const wantedTitle = normalize(title);
  const wantedArtist = normalize(artist);
  const resultTitle = normalize(result.title);
  const resultArtist = normalize(result.artist);
  let score = 0;
  if (resultTitle === wantedTitle) score += 150;
  else if (resultTitle.includes(wantedTitle) || wantedTitle.includes(resultTitle)) score += 45;
  if (wantedArtist && (resultArtist.includes(wantedArtist) || wantedArtist.includes(resultArtist))) score += 60;

  const wantedArtistParts = artist
    .split(/[\s/,&，、()（）]+/)
    .map(normalize)
    .filter((part) => part.length >= 2);
  if (wantedArtistParts.some((part) => resultArtist.includes(part))) score += 35;
  if (!/\b(?:live|remix|version|伴奏)\b/i.test(title) && /\b(?:live|remix|version|伴奏)\b/i.test(result.title)) {
    score -= 30;
  }
  return score;
}

function buildSearchQueries(title) {
  const queries = [];
  const add = (value) => {
    const cleaned = value.replace(/\s+/g, ' ').trim();
    if (cleaned.length >= 2 && !queries.includes(cleaned)) queries.push(cleaned);
  };

  add(title);
  add(title
    .replace(/\([^)]*(?:prod(?:uced)?\.?|feat(?:uring)?\.?|ft\.?|remix|version|伴奏|製作|制作)[^)]*\)/gi, '')
    .replace(/\[[^\]]*(?:prod(?:uced)?\.?|feat(?:uring)?\.?|ft\.?|remix|version|伴奏|製作|制作)[^\]]*\]/gi, ''));

  const chineseSegments = title.match(/[\u3400-\u9fff]+(?:[\s·・]+[\u3400-\u9fff]+)*/g) || [];
  chineseSegments
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .sort((a, b) => b.length - a.length)
    .forEach(add);

  return queries.slice(0, 5);
}

function parseSearchResults(html) {
  const results = [];
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const song = row.match(/href=["'](?:https:\/\/www\.kugeci\.com)?\/song\/([A-Za-z0-9]+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!song) continue;
    const singerMatches = [...row.matchAll(/href=["'](?:https:\/\/www\.kugeci\.com)?\/singer\/[A-Za-z0-9]+["'][^>]*>([\s\S]*?)<\/a>/gi)];
    const result = {
      id: song[1],
      title: decodeHtml(song[2]),
      artist: singerMatches.map((item) => decodeHtml(item[1])).filter(Boolean).join(' / '),
    };
    if (!results.some((item) => item.id === result.id)) results.push(result);
  }
  return results;
}

async function fetchKugeci(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TrackSplit-Studio/1.0',
      Accept: 'text/html, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`酷歌詞網站回應 ${response.status}`);
  return response;
}

async function searchLyrics(fileName) {
  const cleaned = cleanSearchName(fileName);
  const simplifiedTitle = toSimplified(cleaned.title);
  const simplifiedArtist = toSimplified(cleaned.artist);
  const searchQueries = buildSearchQueries(simplifiedTitle);
  const results = [];

  for (const query of searchQueries) {
    const response = await fetchKugeci(`https://www.kugeci.com/search?q=${encodeURIComponent(query)}`);
    const found = parseSearchResults(await response.text());
    for (const result of found) {
      if (!results.some((item) => item.id === result.id)) results.push(result);
    }
    if (results.length >= 20) break;
  }

  results.forEach((result) => {
    result.score = Math.max(...searchQueries.map((query) => scoreResult(result, query, simplifiedArtist)));
  });
  results.sort((a, b) => b.score - a.score);

  return {
    originalName: cleaned.original,
    searchTitle: cleaned.title,
    simplifiedQuery: searchQueries.join(' → '),
    results: results.slice(0, 20).map(({ score, ...result }) => result),
  };
}

async function downloadTraditionalLrc(songId) {
  if (!/^[A-Za-z0-9]+$/.test(songId)) throw new Error('無效的歌詞編號');
  const response = await fetchKugeci(`https://www.kugeci.com/download/lrc/${songId}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  let text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  if (!/\[\d{1,3}:\d{2}/.test(text)) throw new Error('網站沒有回傳有效的 LRC 歌詞');
  text = toTraditional(text).replace(/\r?\n/g, '\r\n');
  return Buffer.from(`\uFEFF${text}`, 'utf8');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);
    const urlPath = decodeURIComponent(requestUrl.pathname);

    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/convert-m4a') {
      const input = await readBody(req);
      const requestedName = decodeURIComponent(String(req.headers['x-file-name'] || 'input.wav'));
      const requestedExtension = path.extname(requestedName).toLowerCase();
      const extension = /^\.(mp3|wav|m4a|ogg|flac|aac|wma|mp4)$/.test(requestedExtension)
        ? requestedExtension
        : '.bin';
      const output = await convertToM4A(input, extension);
      send(res, 200, output, {
        'Content-Type': 'audio/mp4',
        'Content-Length': output.length,
        'Cache-Control': 'no-store',
      });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/lyrics/search') {
      const fileName = requestUrl.searchParams.get('fileName') || '';
      if (!fileName.trim()) throw new Error('缺少音訊檔名');
      sendJson(res, 200, await searchLyrics(fileName));
      return;
    }

    if (req.method === 'GET' && urlPath.startsWith('/api/lyrics/download/')) {
      const songId = urlPath.split('/').pop();
      const output = await downloadTraditionalLrc(songId);
      send(res, 200, output, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': output.length,
        'Content-Disposition': 'attachment',
        'Cache-Control': 'no-store',
      });
      return;
    }

    const rel = urlPath === '/' ? 'index.html' : path.normalize(urlPath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(root, rel);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      send(res, 403, 'Forbidden');
      return;
    }

    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) {
      send(res, 404, 'Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(port, host, () => {
  console.log(`http://${host}:${port}`);
});

module.exports = server;
