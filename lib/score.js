/**
 * dsh-plugin-chooser — 评分引擎
 *
 * 多维评分模型（总分 100）：
 *   1. 安全分（20）：风险扫描结果、来源可信度、是否官方
 *   2. 质量分（20）：star 数、license、描述完整度、有无 installNote
 *   3. 活跃分（20）：最近提交、版本更新、维护状态
 *   4. 兼容分（20）：DSH 版本兼容、compat 状态、验证级别
 *   5. 生态分（20）：是否官方/精选、社区信任、sourceNote
 */

// 各维度权重（合计 100）
const WEIGHTS = { security: 20, quality: 20, activity: 20, compat: 20, ecosystem: 20 };

/**
 * 综合评分一个插件
 * @param {object} p - 插件元数据（来自市场目录 / inventory）
 * @param {object} opts - { riskFindings: [], conflictCount: 0 }
 * @returns {object} - { total, breakdown, level, reasons }
 */
export function scorePlugin(p, opts = {}) {
  const s = {
    security: scoreSecurity(p, opts),
    quality: scoreQuality(p),
    activity: scoreActivity(p),
    compat: scoreCompat(p),
    ecosystem: scoreEcosystem(p),
  };

  const total = Math.round(
    s.security * (WEIGHTS.security / 20) +
    s.quality * (WEIGHTS.quality / 20) +
    s.activity * (WEIGHTS.activity / 20) +
    s.compat * (WEIGHTS.compat / 20) +
    s.ecosystem * (WEIGHTS.ecosystem / 20)
  );

  return {
    total,
    breakdown: s,
    level: levelOf(total),
    reasons: buildReasons(p, s, opts),
  };
}

/** 安全分（0-20）：风险发现 + 来源可信度 */
function scoreSecurity(p, opts = {}) {
  let score = 14; // 基础分
  const reasons = [];
  const risk = p.risk || {};
  if (risk.installScript) { score -= 5; reasons.push('含安装脚本（installScript）'); }
  if (risk.networkEgress) { score -= 4; reasons.push('存在网络外发（networkEgress）'); }
  if (risk.shellAccess) { score -= 4; reasons.push('存在 Shell 访问（shellAccess）'); }
  if (risk.noLicense) { score -= 2; reasons.push('无许可证'); }
  if (p.isOfficialBeta) { score += 3; reasons.push('官方 Beta'); }
  if (p.isOfficial) { score += 5; reasons.push('官方插件'); }
  if (opts.riskFindings && opts.riskFindings.length) {
    score -= Math.min(8, opts.riskFindings.length * 2);
    reasons.push(`风险扫描发现 ${opts.riskFindings.length} 项`);
  }
  return clamp(score, 0, 20);
}

/** 质量分（0-20）：star / license / 描述完整度 */
function scoreQuality(p) {
  let score = 0;
  const stars = p.stars || 0;
  score += Math.min(10, Math.log10(stars + 1) * 3.3); // star 对数映射（0→10）
  if (p.license && p.license !== 'unknown' && p.license !== 'NOASSERTION') score += 4;
  else score += 1;
  const desc = `${p.description?.en || ''}${p.description?.zh || ''}`;
  if (desc.length > 60) score += 3;
  else if (desc.length > 20) score += 2;
  else score += 1;
  if (!p.installNote) score += 3; // 无风险提示则加信任分
  return clamp(Math.round(score), 0, 20);
}

/** 活跃分（0-20）：最近推送 + 版本 */
function scoreActivity(p) {
  let score = 8; // 基础
  const lastPush = p.last_push || '';
  if (lastPush) {
    const days = daysSince(lastPush);
    if (days <= 7) score += 8;        // 一周内活跃
    else if (days <= 30) score += 5;  // 一月内
    else if (days <= 90) score += 3;  // 三月内
    else score += 1;                  // 较久未更新
  } else {
    score += 2;
  }
  if (p.dsh?.minVersion) score += 2;   // 声明了 DSH 版本要求 = 更规范
  if (p.language && p.language !== 'unknown') score += 2;
  return clamp(score, 0, 20);
}

/** 兼容分（0-20）：compat 状态 + 验证级别（修正：避免 compat-ok 一刀切满分） */
function scoreCompat(p) {
  const compat = p.compat || {};
  const status = compat.status || 'unknown';
  let score = 6;
  if (status === 'ok') score += 8;
  else if (status === 'warning') score += 4;
  else if (status === 'error') score += 0;
  else score += 3;
  const evidence = p.evidence?.level || 0;
  score += Math.min(4, evidence * 2); // L1=2, L2=4, L3=6(封顶4)
  if (p.dsh?.peerCordis) score += 2;
  // 兼容分封顶 18（避免 compat-ok + L2 拿满 20，压过真正的质量差异）
  return clamp(Math.min(score, 18), 0, 20);
}

/** 生态分（0-20）：featured / 社区信任 / 来源 */
function scoreEcosystem(p) {
  let score = 8;
  if (p.featured) score += 6;
  const sourceNote = p.sourceNote || '';
  if (sourceNote.includes('内测') || sourceNote.includes('官方')) score += 3;
  const stars = p.stars || 0;
  if (stars >= 100) score += 3;
  else if (stars >= 30) score += 2;
  else if (stars >= 10) score += 1;
  if (p.installNote) score -= 3;
  return clamp(score, 0, 20);
}

function levelOf(total) {
  if (total >= 80) return 'A+';
  if (total >= 70) return 'A';
  if (total >= 60) return 'B';
  if (total >= 45) return 'C';
  return 'D';
}

function buildReasons(p, s, opts) {
  const reasons = [];
  if (s.security >= 16) reasons.push('安全风险低');
  if (s.security < 10) reasons.push('安全风险需关注');
  if (s.quality >= 16) reasons.push('质量优秀');
  if (s.activity >= 16) reasons.push('维护活跃');
  if (s.activity < 6) reasons.push('维护不活跃');
  if (s.compat >= 16) reasons.push('兼容性已验证');
  if (s.compat < 8) reasons.push('兼容性未验证');
  if (opts.conflictCount > 0) reasons.push(`存在 ${opts.conflictCount} 个潜在冲突`);
  return reasons;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function daysSince(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 999;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  } catch { return 999; }
}

/**
 * 批量评分 + 排序 + 推荐
 * @param {Array} plugins - 插件数组
 * @param {object} opts
 * @returns {Array} 按总分降序的评分结果
 */
export function rankPlugins(plugins, opts = {}) {
  return plugins
    .map((p) => ({ ...p, score: scorePlugin(p, opts) }))
    .sort((a, b) => b.score.total - a.score.total);
}

/** 格式化为人类可读的推荐报告 */
export function formatRanking(ranked, { top = 10, category } = {}) {
  const filtered = category ? ranked.filter((p) => p.category === category) : ranked;
  const lines = [];
  lines.push(`📊 插件推荐榜${category ? `（类别: ${category}）` : ''}`);
  lines.push('='.repeat(50));
  lines.push(`共评估 ${ranked.length} 个插件${category ? `，${category} 类 ${filtered.length} 个` : ''}`);
  lines.push('');
  filtered.slice(0, top).forEach((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const sc = p.score;
    lines.push(`${medal} ${p.id} — ${sc.total}分 [${sc.level}] ⭐${p.stars || 0}`);
    lines.push(`   安全${sc.breakdown.security}/20 质量${sc.breakdown.quality}/20 活跃${sc.breakdown.activity}/20 兼容${sc.breakdown.compat}/20 生态${sc.breakdown.ecosystem}/20`);
    if (sc.reasons.length) lines.push(`   理由: ${sc.reasons.join('；')}`);
    lines.push('');
  });
  return lines.join('\n');
}
