/**
 * dsh-plugin-chooser — 插件评分选择顾问（Host 端入口）
 *
 * 解决"插件太多不知道选哪个"：
 *   1. 读取插件清单（市场目录 / 运行时 inventory / 配置）
 *   2. 多维评分（安全/质量/活跃/兼容/生态）
 *   3. 输出推荐榜 + 每插件理由
 */

import { scorePlugin, rankPlugins, formatRanking } from './score.js';

export const name = 'dsh-plugin-chooser';
export const inject = {
  optional: ['dynamicCordisRunner', 'agent'],
};

/** 从市场目录缓存读取插件（如果可用） */
function readMarketCache() {
  try {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const home = os.homedir();
    const cachePath = path.join(home, '.ohdsh', 'plugin-marketplace', 'catalog-cache.json');
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf-8');
      const data = JSON.parse(raw);
      return (data?.document?.plugins || []).map((p) => ({
        id: p.id,
        name: p.name || p.id,
        stars: p.stars || 0,
        license: p.license,
        category: p.category,
        description: p.description,
        featured: !!p.featured,
        isOfficial: !!p.isOfficial,
        isOfficialBeta: !!p.isOfficialBeta,
        risk: p.risk || {},
        compat: p.compat || {},
        evidence: p.evidence || {},
        dsh: p.dsh || {},
        language: p.language,
        last_push: p.last_push,
        sourceNote: p.sourceNote || '',
        installNote: p.installNote || null,
      }));
    }
  } catch {
    /* 缓存不可读时忽略 */
  }
  return [];
}

export function apply(ctx) {
  const handleRecommend = async (args = {}) => {
    const plugins = readMarketCache();
    const category = args.category || null;
    const top = args.top || 10;

    if (!plugins.length) {
      // 回退到运行时扫描
      const runtime = ctx.dynamicCordisRunner
        ? await ctx.dynamicCordisRunner.inventory().catch(() => [])
        : [];
      if (!runtime.length) {
        return '未能读取插件清单（市场缓存与运行时均不可用）。';
      }
      return formatRanking(rankPlugins(runtime, {}), { top, category });
    }

    const ranked = rankPlugins(plugins, {});
    return formatRanking(ranked, { top, category });
  };

  ctx.tool?.(
    'recommend-plugin',
    {
      description:
        '推荐插件：按安全/质量/活跃/兼容/生态多维评分，从插件市场挑选最值得安装的插件。用户提到"推荐插件"、"哪个插件好"、"插件排行"、"选哪个插件"时调用。参数: category（可选，如 tools/ui/session），top（可选，默认10）。',
    },
    async (args) => handleRecommend(args),
  );

  ctx.command?.('plugin-recommend [category]', '推荐插件（多维评分排行）', async (_, category) => {
    return handleRecommend({ category });
  });
}
