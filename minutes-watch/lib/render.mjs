// 纪要渲染：Markdown（存档）+ 飞书卡片（群内阅读）
// 设计参考：shaowen310/skills meeting-minutes、mohitagw15856/pm-claude-skills meeting-notes、
//          borghei/Claude-Skills summarize-meeting、JakeWhiteArchitecture/Meeting-minutes-claude-skill
// 共同结构：元信息 → 一句话结论 → 决议 → 待办(owner/due) → 议题 → 风险未决 → 解读
// 飞书卡片限制：lark_md 不支持表格；多字段用「｜」拼接；标签用 <text_tag>，不要用反引号。

const CARD_LIMIT = 26000;

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** lark_md 链接：label 里的方括号会把链接截断 */
export function link(label, url) {
  const safe = esc(label).replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return `[${safe}](${url})`;
}

export function tag(text, color = 'neutral') {
  return `<text_tag color='${color}'>${esc(text)}</text_tag>`;
}

const STATUS_COLOR = {
  open: 'orange',
  doing: 'blue',
  done: 'green',
  risk: 'red',
  block: 'red',
  info: 'neutral',
};

export function statusTag(status) {
  const map = {
    open: '待跟进',
    doing: '进行中',
    done: '已完成',
    risk: '风险',
    block: '阻塞',
    info: '知悉',
  };
  const key = String(status || 'open').toLowerCase();
  return tag(map[key] || status, STATUS_COLOR[key] || 'neutral');
}


// ---------------------------------------------------------------- 场景自动分型
export function classifyScene(m) {
  if (m.scene) return m.scene;
  const t = String(m.title || '');
  const topicText = (m.topics || []).map((x) => `${x.title || ''} ${(x.points || []).join(' ')}`).join(' ');
  const nDec = (m.decisions || []).length;
  const nAct = (m.actions || []).length;
  const nOpt = (m.options || []).length;
  if (/复盘|回顾|retro/i.test(t + topicText) && /做得|待改进|改进/.test(topicText)) return 'retro';
  if (nOpt >= 2) return 'decision-focus';
  if (nDec <= 1 && nAct >= 2) return 'action-tracker';
  return 'standard';
}

const SCENE_META = {
  'decision-focus': { label: '决策导向型', header: 'turquoise' },
  'action-tracker': { label: '行动追踪型', header: 'orange' },
  'retro': { label: '复盘型', header: 'green' },
  'standard': { label: '标准型', header: 'blue' },
};

function verdictTag(v) {
  const s = String(v || '');
  if (/采用|优先|主证据|采纳/.test(s)) return tag(s, 'green');
  if (/剔除|不用|否决|放弃/.test(s)) return tag(s, 'red');
  if (/兜底|备用|暂缓/.test(s)) return tag(s, 'orange');
  return tag(s || '—', 'neutral');
}

function optionRow(o, simple) {
  if (simple) {
    const bits = [];
    if (o.pros) bits.push(`优点：${esc(o.pros)}`);
    if (o.cons) bits.push(`缺点：${esc(o.cons)}`);
    if (o.verdict) bits.push(`结论：${esc(o.verdict)}`);
    return mdBlock(`**${esc(o.name)}**${bits.length ? `\n　${bits.join('｜')}` : ''}`);
  }
  return {
    tag: 'column_set',
    flex_mode: 'none',
    background_style: 'grey',
    columns: [
      { tag: 'column', width: 'weighted', weight: 2, vertical_align: 'top',
        elements: [mdBlock(`**${esc(o.name)}**`)] },
      { tag: 'column', width: 'weighted', weight: 5, vertical_align: 'top',
        elements: [mdBlock(`${o.pros ? `优点：${esc(o.pros)}\n` : ''}${o.cons ? `缺点：${esc(o.cons)}` : ''}`)] },
      { tag: 'column', width: 'weighted', weight: 2, vertical_align: 'top',
        elements: [mdBlock(o.verdict ? verdictTag(o.verdict) : '—')] },
    ],
  };
}

// ---------------------------------------------------------------- markdown

export function toMarkdown(m) {
  const out = [];
  out.push(`# ${m.title}`);
  out.push('');
  const meta = [];
  if (m.date) meta.push(`- **时间**：${m.date}${m.duration ? `，时长 ${m.duration}` : ''}`);
  if (m.attendees?.length) meta.push(`- **参会**：${m.attendees.join('、')}`);
  if (m.sourceUrl) meta.push(`- **妙记**：${m.sourceUrl}`);
  if (m.minuteToken) meta.push(`- **minute_token**：\`${m.minuteToken}\``);
  if (m.transcriptPath) meta.push(`- **逐字稿**：\`${m.transcriptPath}\``);
  if (m.artifactsPath) meta.push(`- **原始产物**：\`${m.artifactsPath}\``);
  out.push(...meta);
  out.push('');

  if (m.caveat) {
    out.push(`> ${m.caveat}`);
    out.push('');
  }

  if (m.tldr?.length) {
    out.push('## 一句话结论');
    out.push('');
    for (const line of m.tldr) out.push(`- ${line}`);
    out.push('');
  }

  if (m.decisions?.length) {
    out.push('## 决议');
    out.push('');
    m.decisions.forEach((d, i) => {
      const text = typeof d === 'string' ? d : d.text;
      const extra = typeof d === 'string' ? '' : [d.owner && `owner: ${d.owner}`, d.note].filter(Boolean).join('，');
      out.push(`${i + 1}. ${text}${extra ? `（${extra}）` : ''}`);
    });
    out.push('');
  }

  if (m.actions?.length) {
    out.push('## 待办');
    out.push('');
    out.push('| # | 事项 | 负责人 | 时间 | 状态 |');
    out.push('|---|---|---|---|---|');
    m.actions.forEach((a, i) => {
      out.push(`| ${i + 1} | ${a.action} | ${a.owner || 'TBD'} | ${a.due || 'TBD'} | ${a.status || 'open'} |`);
    });
    out.push('');
  }

  if (m.topics?.length) {
    out.push('## 议题讨论');
    out.push('');
    for (const t of m.topics) {
      out.push(`### ${t.title}`);
      out.push('');
      for (const p of t.points || []) out.push(`- ${p}`);
      out.push('');
    }
  }

  if (m.risks?.length) {
    out.push('## 风险与未决');
    out.push('');
    for (const r of m.risks) out.push(`- ${r}`);
    out.push('');
  }

  if (m.analysis?.length) {
    out.push('## 解读');
    out.push('');
    for (const p of m.analysis) {
      out.push(p);
      out.push('');
    }
  }

  if (m.nextMeeting) {
    out.push('## 下次会议');
    out.push('');
    out.push(m.nextMeeting);
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------------------------------------------------------------- card

function sectionTitle(text) {
  return { tag: 'div', text: { tag: 'lark_md', content: `**${esc(text)}**` } };
}

function mdBlock(content) {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function hr() {
  return { tag: 'hr' };
}

export function toCard(m, opts = {}) {
  const simple = !!opts.simple || process.env.SIMPLE_CARD === '1';
  const scene = classifyScene(m);
  const meta = SCENE_META[scene] || SCENE_META.standard;
  const els = [];

  // 元信息行
  const metaBits = [];
  if (m.date) metaBits.push(`🗓 ${esc(m.date)}`);
  if (m.duration) metaBits.push(`⏱ ${esc(m.duration)}`);
  if (m.attendees?.length) metaBits.push(`👥 ${esc(m.attendees.join('、'))}`);
  if (metaBits.length) els.push(mdBlock(metaBits.join('　·　')));
  if (m.sourceUrl) els.push(mdBlock(`🔗 ${link('飞书妙记原文', m.sourceUrl)}`));

  if (m.keywords?.length) {
    els.push(mdBlock(m.keywords.slice(0, 12).map((k) => tag(k, 'blue')).join(' ')));
  }

  // 统计条：一眼看出这场会的"体量"
  const stats = [];
  if (m.topics?.length) stats.push(tag(`议题 ${m.topics.length}`, 'blue'));
  if (m.decisions?.length) stats.push(tag(`决议 ${m.decisions.length}`, 'green'));
  if (m.actions?.length) stats.push(tag(`待办 ${m.actions.length}`, 'orange'));
  if (m.risks?.length) stats.push(tag(`未决 ${m.risks.length}`, 'red'));
  stats.push(tag(meta.label, 'turquoise'));
  els.push(mdBlock(stats.join(' ')));

  if (m.caveat) {
    els.push({ tag: 'note', elements: [{ tag: 'plain_text', content: esc(m.caveat).slice(0, 800) }] });
  }

  if (m.tldr?.length) {
    els.push(sectionTitle('一句话结论'));
    els.push(mdBlock(m.tldr.map((l) => `· ${esc(l)}`).join('\n')));
  }

  if (m.options?.length) {
    els.push(hr());
    els.push(sectionTitle('🧩 方案对比'));
    if (simple) {
      els.push(mdBlock(m.options.map((o) => {
        const bits = [];
        if (o.pros) bits.push(`优点：${esc(o.pros)}`);
        if (o.cons) bits.push(`缺点：${esc(o.cons)}`);
        if (o.verdict) bits.push(`结论：${esc(o.verdict)}`);
        return `**${esc(o.name)}**${bits.length ? `\n　${bits.join('｜')}` : ''}`;
      }).join('\n\n')));
    } else {
      for (const o of m.options) els.push(optionRow(o, false));
    }
  }

  if (m.decisions?.length) {
    els.push(hr());
    els.push(sectionTitle('✅ 决议'));
    const lines = m.decisions.map((d, i) => {
      const text = typeof d === 'string' ? d : d.text;
      const extra = typeof d === 'string' ? '' : [d.owner && `@${d.owner}`, d.note].filter(Boolean).join('　');
      return `**${i + 1}.** ${esc(text)}${extra ? `\n　${esc(extra)}` : ''}`;
    });
    els.push(mdBlock(lines.join('\n')));
  }

  if (m.reasoning?.length) {
    els.push(sectionTitle('📐 决策依据'));
    els.push(mdBlock(m.reasoning.map((r) => `· ${esc(r)}`).join('\n')));
  }

  if (m.actions?.length) {
    els.push(hr());
    els.push(sectionTitle('📌 待办'));
    const lines = m.actions.map((a, i) => {
      const who = a.owner ? `**${esc(a.owner)}**` : '**TBD**';
      const due = a.due ? `　⏳ ${esc(a.due)}` : '';
      return `${statusTag(a.status)} **${i + 1}.** ${esc(a.action)}\n　${who}${due}`;
    });
    els.push(mdBlock(lines.join('\n')));
  }

  if (m.topics?.length) {
    els.push(hr());
    els.push(sectionTitle('🗂 议题讨论'));
    const blocks = m.topics.map((t) => {
      const points = (t.points || []).map((p) => `· ${esc(p)}`).join('\n');
      return `**${esc(t.title)}**\n${points}`;
    });
    els.push(mdBlock(blocks.join('\n\n')));
  }

  if (m.risks?.length) {
    els.push(hr());
    els.push(sectionTitle('⚠️ 风险与未决'));
    els.push(mdBlock(m.risks.map((r) => `· ${esc(r)}`).join('\n')));
  }

  if (m.analysis?.length) {
    els.push(hr());
    els.push(sectionTitle('🧭 解读'));
    els.push(mdBlock(m.analysis.map((p) => esc(p)).join('\n\n')));
  }

  // 元素数保护：递归计数（含 column_set 内部），超过 32 才退回纯文本
  if (!simple && countEls(els) > 34 && m.options?.length) {
    return toCard(m, { simple: true });
  }

  // 体积保护：超限时按从后往前删减议题细节
  let body = JSON.stringify(els);
  if (body.length > CARD_LIMIT) {
    while (body.length > CARD_LIMIT && els.length > 4) {
      els.splice(Math.max(3, els.length - 2), 1);
      body = JSON.stringify(els);
    }
  }

  const footBits = [];
  if (m.transcriptPath) footBits.push(`逐字稿 ${m.transcriptPath}`);
  if (m.artifactsPath) footBits.push(`原始产物 ${m.artifactsPath}`);
  els.push({ tag: 'note', elements: [{ tag: 'plain_text', content: (footBits.join(' · ') || '飞书妙记 AI 产物').slice(0, 300) }] });

  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      template: m.headerTemplate || meta.header,
      title: { tag: 'plain_text', content: `📋 ${m.title}`.slice(0, 100) },
    },
    elements: els,
  };
}


// 飞书的元素配额把 column_set 内部元素也算进去，必须递归数
function countEls(els) {
  let n = 0;
  for (const e of els) {
    n += 1;
    if (e.tag === 'column_set') for (const c of e.columns || []) n += countEls(c.elements || []);
    if (e.tag === 'collapsible_panel') n += countEls(e.elements || []);
  }
  return n;
}

// 拆成两张卡：决策摘要（带分栏）+ 详情，绕开单卡元素上限
export function toCards(m, opts = {}) {
  const head = { ...m };
  const summaryCard = toCard({ ...head, reasoning: [], topics: [], risks: [], analysis: [], nextMeeting: undefined }, opts);
  const detailCard = toCard({ ...head, tldr: [], options: [], decisions: [], actions: [] }, { ...opts, simple: true });
  const n1 = countEls(summaryCard.elements), n2 = countEls(detailCard.elements);
  summaryCard.header.title.content = `📋 ${String(m.title).slice(0, 80)}（1/2 摘要）`.slice(0, 100);
  detailCard.header.title.content = `📋 ${String(m.title).slice(0, 80)}（2/2 详情）`.slice(0, 100);
  return { cards: [summaryCard, detailCard], counts: [n1, n2] };
}

// ---------------------------------------------------------------- quick card
// 零 LLM 路径：只用妙记 artifacts 自带字段（summary / keywords / chapters / todos）

export function quickData(artifacts, { minuteToken, sourceUrl, transcriptPath, artifactsPath } = {}) {
  const d = artifacts?.data || artifacts || {};
  const summary = String(d.summary || '').trim();
  const bullets = summary
    .split('\n')
    .map((l) => l.replace(/^[-*·]\s*/, '').trim())
    .filter(Boolean);

  const chapters = (d.minute_chapters || []).map((c) => ({
    title: c.title || c.topic || '章节',
    points: [c.summary].filter(Boolean),
  }));

  const actions = (d.minute_todos || []).map((t) => ({
    action: t.content || t.text || String(t),
    owner: t.owner || '',
    due: '',
    status: 'open',
  }));

  return {
    title: d.title || '会议纪要',
    date: '',
    duration: '',
    sourceUrl,
    minuteToken,
    transcriptPath,
    artifactsPath,
    keywords: d.keywords || [],
    tldr: bullets.slice(0, 4),
    actions,
    topics: chapters,
    caveat: '妙记自动生成，尚未人工校对；完整逐字稿见下方路径。',
  };
}
