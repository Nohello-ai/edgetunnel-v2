// subscription/subscription.js — 订阅生成（全部走远端转换后端）

import { md5md5, base64SecretEncode, replaceStars, randomPath } from '../utils.js';
import { FINGERPRINT_DICT } from '../context.js';
import { readConfigKV } from '../admin/config.js';

export async function handleSubscription(request, env, ctx, ctx_, host, UA) {
  const url = new URL(request.url);
  const userID = ctx_.userID;
  const subToken = await md5md5(host + userID);
  const isBestSub = ['1', 'true'].includes(env.BEST_SUB)
    && url.searchParams.get('host') === 'example.com'
    && url.searchParams.get('uuid') === '00000000-0000-4000-8000-000000000000'
    && UA.toLowerCase().includes('tunnel (https://github.com/' + FINGERPRINT_DICT[1] + '/edge');

  const reqToken = url.searchParams.get('token');
  const isClient = reqToken === subToken;
  const daySeq = Math.floor(Date.now() / 86400000);
  const backendSeed = base64SecretEncode(subToken, userID);
  const [todayToken, yesterdayToken] = await Promise.all([
    md5md5(backendSeed + daySeq),
    md5md5(backendSeed + (daySeq - 1)),
  ]);
  const isBackend = reqToken === todayToken || reqToken === yesterdayToken;

  if (!isClient && !isBackend && !isBestSub) return null;

  const config = await readConfigKV(env, host, userID, UA);

  const ua = UA.toLowerCase();
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'Profile-Update-Interval': String(config.优选订阅生成?.SUBUpdateTime || 6),
    'Profile-web-page-url': url.protocol + '//' + url.host + '/admin',
    'Cache-Control': 'no-store',
  };

  if (config.CF?.Usage?.success) {
    const pages = config.CF.Usage.pages;
    const workers = config.CF.Usage.workers;
    const max = Number.isFinite(config.CF.Usage.max) ? (config.CF.Usage.max / 1000) * 1024 : 102400;
    headers['Subscription-Userinfo'] = `upload=${pages}; download=${workers}; total=${max}; expire=4102329600`;
  }

  const isSubConverter = url.searchParams.has('b64')
    || url.searchParams.has('base64')
    || request.headers.get('subconverter-request')
    || request.headers.get('subconverter-version')
    || ua.includes('subconverter')
    || ua.includes('cf-workers-sub')
    || isBestSub;

  const subType = isSubConverter ? 'mixed'
    : url.searchParams.has('target') ? url.searchParams.get('target')
    : url.searchParams.has('clash') || ua.includes('clash') || ua.includes('meta') || ua.includes('mihomo') ? 'clash'
    : url.searchParams.has('sb') || url.searchParams.has('singbox') || ua.includes('singbox') || ua.includes('sing-box') ? 'singbox'
    : url.searchParams.has('surge') || ua.includes('surge') ? 'surge&ver=4'
    : url.searchParams.has('quanx') || ua.includes('quantumult') ? 'quanx'
    : url.searchParams.has('loon') || ua.includes('loon') ? 'loon'
    : 'mixed';

  if (!ua.includes('mozilla')) {
    headers['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(config.优选订阅生成?.SUBNAME || 'edgetunnel')}`;
  }

  // 所有订阅类型统一走远端转换后端
  const subConverterUrl = buildSubConverterUrl(config, subType, url, subToken);
  let content = '';
  try {
    const resp = await fetch(subConverterUrl, {
      headers: { 'User-Agent': 'Subconverter for ' + subType + ' edgetunnel (https://github.com/' + FINGERPRINT_DICT[1] + '/edgetunnel)' }
    });
    if (resp.ok) {
      content = await resp.text();
      if (url.searchParams.has('surge') || ua.includes('surge')) {
        content = surgePatch(content, url.protocol + '//' + url.host + '/sub?token=' + subToken + '&surge', config);
      }
    } else {
      return new Response('订阅转换后端异常：' + resp.statusText, { status: resp.status });
    }
  } catch (err) {
    return new Response('订阅转换后端异常：' + err.message, { status: 403 });
  }

  // 替换占位符
  if (!ua.includes('subconverter') && isClient) {
    const shuffledHosts = [...(config.HOSTS || [host])].sort(() => Math.random() - 0.5);
    let count = 0, randomHost = null;
    content = content
      .replace(/00000000-0000-4000-8000-000000000000/g, config.UUID)
      .replace(/MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAw/g, btoa(config.UUID))
      .replace(/example\.com/g, () => {
        if (count % 2 === 0) randomHost = replaceStars(shuffledHosts[Math.floor(count / 2) % shuffledHosts.length]);
        count++;
        return randomHost;
      });
  }

  if (subType === 'mixed' && (!ua.includes('mozilla') || url.searchParams.has('b64') || url.searchParams.has('base64'))) {
    content = btoa(content);
  }
  if (subType === 'singbox') {
    content = singboxPatch(content, config);
    headers['content-type'] = 'application/json; charset=utf-8';
  } else if (subType === 'clash') {
    content = clashPatch(content, config);
    headers['content-type'] = 'application/x-yaml; charset=utf-8';
  }

  return new Response(content, { status: 200, headers });
}
function buildSubConverterUrl(config, subType, url, todayToken) {
  const subapi = config.订阅转换配置?.SUBAPI || 'https://subapi.cmliussss.net';
  const subconfig = config.订阅转换配置?.SUBCONFIG || '';
  const emoji = config.订阅转换配置?.SUBEMOJI || false;
  const list = config.订阅转换配置?.SUBLIST || false;
  return `${subapi}/sub?target=${subType}&url=${encodeURIComponent(url.protocol + '//' + url.host + '/sub?target=mixed&token=' + todayToken)}&config=${encodeURIComponent(subconfig)}&emoji=${emoji}&list=${list}`;
}

// ============================================================
// 客户端 patch（已实现）
// ============================================================
function surgePatch(content, url, config) {
  const lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
  const fullPath = config.随机路径 ? randomPath(config.完整节点路径) : config.完整节点路径;
  let out = '';
  for (const line of lines) {
    if (line.trim().startsWith('#')) { out += line + '\n'; continue; }
    if (line.trim()) out += line.replace(/path=([^&]+)/, 'path=' + encodeURIComponent(fullPath)) + '\n';
    else out += line + '\n';
  }
  return out;
}

function clashPatch(content, config) {
  const uuid = config?.UUID || '';
  const lines = content.split('\n');
  const result = [];
  for (const line of lines) {
    let l = line;
    l = l.replace(/uuid:\s*00000000-0000-4000-8000-000000000000/g, 'uuid: ' + uuid);
    l = l.replace(/server:\s*example\.com/g, 'server: ' + (config.HOSTS?.[0] || config.HOST || ''));
    result.push(l);
  }
  return result.join('\n');
}

function singboxPatch(content, config) {
  const uuid = config?.UUID || '';
  const fp = config?.Fingerprint || 'chrome';
  return content
    .replace(/"uuid":\s*"00000000-0000-4000-8000-000000000000"/g, '"uuid": "' + uuid + '"')
    .replace(/"server":\s*"example\.com"/g, '"server": "' + (config.HOSTS?.[0] || config.HOST || '') + '"')
    .replace(/"utls-fingerprint":\s*"[^"]*"/g, '"utls-fingerprint": "' + fp + '"');
}