/**
 * 运营商识别。
 *
 * 根据 Cloudflare 请求的 cf 属性（ASN、组织名称、国家代码）
 * 判断用户所属运营商，用于后续按运营商下发优选 IP。
 *
 * 返回值：'ct' 电信 | 'cu' 联通 | 'cmcc' 移动 | 'cf' Cloudflare/其他
 */

const ASN_MAP = {
  '4134': 'ct', '4809': 'ct', '4811': 'ct', '4812': 'ct', '4815': 'ct',
  '4837': 'cu', '4814': 'cu', '9929': 'cu', '17623': 'cu', '17816': 'cu',
  '9808': 'cmcc', '24400': 'cmcc', '56040': 'cmcc', '56041': 'cmcc', '56044': 'cmcc',
};

const KEYWORD_RULES = [
  { code: 'ct', pattern: /chinanet|chinatelecom|china telecom|cn2|shtel/ },
  { code: 'cmcc', pattern: /cmi|cmnet|chinamobile|china mobile|cmcc|mobile communications/ },
  { code: 'cu', pattern: /china169|china unicom|chinaunicom|cucc|cncgroup|cuii|netcom/ },
];

/**
 * 识别运营商。
 * @param {object} cf - request.cf 对象，至少包含 country, asn, asOrganization
 * @returns {'ct'|'cu'|'cmcc'|'cf'}
 */
export function identifyOperator(cf) {
  if (!cf || typeof cf !== 'object') return 'cf';

  if (String(cf.country || '').toLowerCase() !== 'cn') return 'cf';

  const org = String(cf.asOrganization || '').toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(org)) return rule.code;
  }

  return ASN_MAP[String(cf.asn || '')] || 'cf';
}