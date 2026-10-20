// 直接用已有产物测试结构化，不经过转录步骤
import fs from 'node:fs';
import path from 'node:path';
import { structureMinutes, readSegments } from './lib/structure.mjs';

const dir = process.argv[2];
const base = process.argv[3];
const { segments, from } = readSegments(dir, base);
console.log(`来源 ${from}，${segments.length} 段，${segments.reduce((a,s)=>a+s.text.length,0)} 字`);
const t0 = Date.now();
const data = await structureMinutes({
  segments,
  meta: {
    title: '阿里云知识库测试问题反馈与需求沟通',
    date: '2026-10-19',
    duration: '59 分钟',
  },
  onProgress: (m) => console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${m}`),
});
console.log(`耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log(JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(dir, `${base}.llmtest.json`), JSON.stringify(data, null, 2));
