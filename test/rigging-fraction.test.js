// 吊挂载荷核算「多件互质分母分数叠加」回归测试：
// 同一左吊点连接 140+ 个间距各异的质数厘米右吊点，每件 1kg、重心距右吊点 1cm
// 且同时生效时，累计载荷的约分分子 / 分母可达数百位，Number(bigint) 会溢出成 Infinity，
// 旧实现 Infinity / Infinity = NaN，JSON 序列化为 null，页面显示 NaN。
//
// 约束：两位小数必须从精确分数（BigInt）四舍五入得到，不得先把巨大分子 / 分母转浮点；
// 半开时段与严格超额判定仍按分数执行，恰好等于额定载荷不报超额。
//
// 运行：node --test（Node >= 18）。
const test = require('node:test');
const assert = require('node:assert');

const { analyzeRigging } = require('../src/rigging');

/** 前 n 个质数（作为各右吊点与前一吊点之间的间距，全部互质） */
function firstPrimes(n) {
  const out = [];
  for (let k = 2; out.length < n; k++) {
    let prime = true;
    for (const p of out) {
      if (p * p > k) break;
      if (k % p === 0) {
        prime = false;
        break;
      }
    }
    if (prime) out.push(k);
  }
  return out;
}

/**
 * 构造同一左吊点 L（x=0）连接 n 个质数间距右吊点、每件 1kg 且同时生效的数据集。
 * 右吊点横坐标为前 n 个质数的前缀和；重心距右吊点 1cm，故左吊点分担 1/前缀和、
 * 右吊点分担 (前缀和−1)/前缀和。各左分担分母（前缀和）互素程度很高，
 * 通分约分后分母仍达数百位，而左分担之和收敛在 1 附近（约 1.02），便于同时考察超额判定。
 */
function buildPrimeOverlap(n, leftRatedLoad) {
  const points = [{ id: 'L', name: '左吊点', x: 0, ratedLoad: leftRatedLoad }];
  const items = [];
  let x = 0;
  firstPrimes(n).forEach((p, i) => {
    x += p; // 右吊点横坐标 = 前 n 个质数的前缀和
    points.push({ id: `R${i}`, name: `右吊点${i}`, x, ratedLoad: 1000000 });
    // 重心距右吊点 1cm：左吊点分担 1/x，右吊点分担 (x-1)/x
    items.push({
      id: `I${i}`,
      name: `布景${i}`,
      weight: 1,
      cogX: x - 1,
      leftPointId: 'L',
      rightPointId: `R${i}`,
      start: 0,
      end: 10,
    });
  });
  return analyzeRigging({ rigPoints: points, rigItems: items });
}

test('140 个质数间距吊挂件同时叠加：峰值 / 超额量 / 逐件分担的 kg 均为有限数值', () => {
  const r = buildPrimeOverlap(140, 1);
  const left = r.points.find((p) => p.id === 'L');
  assert.strictEqual(r.summary.items, 140);

  // 约分分母远超安全整数（此处达数百位），精确分数仍完整保留
  assert.ok(left.peak.den.length > 200, `分母位数应很大，实际 ${left.peak.den.length}`);
  assert.ok(Number.isFinite(Number(left.peak.den)), '分母字符串本身不参与浮点转换即可解析');

  // 峰值略大于 1（各件左分担 (p-1)/p < 1，140 件之和约 1.02）
  assert.ok(Number.isFinite(left.peak.kg), '峰值 kg 不得为 NaN/null');
  assert.strictEqual(left.peak.kg, 1.02);
  assert.strictEqual(left.overloaded, true, '峰值严格大于额定载荷 1 应判超额');

  const iv = left.intervals[0];
  assert.ok(iv, '应有一条超额区间');
  assert.ok(Number.isFinite(iv.peakLoad.kg), '区间峰值 kg 必须有限');
  assert.ok(Number.isFinite(iv.excess.kg), '超额量 kg 必须有限');
  assert.strictEqual(iv.excess.kg, 0.02);

  // 逐件分担：质数跨度下分母较小（首件跨度 2，分担 1/2），同样必须有限
  for (const it of r.items) {
    assert.ok(Number.isFinite(it.leftShare.kg), `件 ${it.id} 左分担 kg 必须有限`);
    assert.ok(Number.isFinite(it.rightShare.kg), `件 ${it.id} 右分担 kg 必须有限`);
    assert.match(it.leftShare.num, /^\d+$/);
    assert.match(it.leftShare.den, /^\d+$/);
  }
  assert.strictEqual(r.items[0].leftShare.kg, 0.5);
});

test('更多件（160 件，分母 300+ 位必然超出浮点范围）依然不出现 NaN/null', () => {
  const r = buildPrimeOverlap(160, 1);
  const left = r.points.find((p) => p.id === 'L');
  assert.ok(left.peak.den.length > 300);
  assert.ok(Number.isFinite(left.peak.kg));
  assert.ok(Number.isFinite(left.intervals[0].peakLoad.kg));
  assert.ok(Number.isFinite(left.intervals[0].excess.kg));

  // 完整响应可被 JSON 序列化（NaN 会被序列化成 null，这里递归确认无 null 的 kg 字段）
  const json = JSON.stringify(r);
  const reparsed = JSON.parse(json);
  const walk = (v) => {
    if (v && typeof v === 'object') {
      if ('kg' in v) assert.notStrictEqual(v.kg, null);
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(reparsed);
});

test('累计载荷恰好等于额定载荷（三件各 1/3）不判超额', () => {
  const r = analyzeRigging({
    rigPoints: [
      { id: 'L', name: '左吊点', x: 0, ratedLoad: 1 },
      { id: 'R', name: '右吊点', x: 3, ratedLoad: 9 },
    ],
    rigItems: [0, 1, 2].map((i) => ({
      id: `i${i}`,
      name: `件${i}`,
      weight: 1,
      cogX: 2, // 左分担 (3-2)/3 = 1/3
      leftPointId: 'L',
      rightPointId: 'R',
      start: 0,
      end: 5,
    })),
  });
  const left = r.points.find((p) => p.id === 'L');
  assert.strictEqual(left.peak.num, '1');
  assert.strictEqual(left.peak.den, '1');
  assert.strictEqual(left.peak.kg, 1);
  assert.strictEqual(left.overloaded, false, '严格大于才算超额，相等不报');
  assert.strictEqual(left.intervals.length, 0);
});

test('半开时段：t 秒结束先于 t 秒开始，两件左分担 2/3 在 t 秒不叠加', () => {
  const r = analyzeRigging({
    rigPoints: [
      { id: 'L', name: '左吊点', x: 0, ratedLoad: 1 },
      { id: 'R', name: '右吊点', x: 3, ratedLoad: 9 },
    ],
    rigItems: [
      { id: 'a', name: 'a', weight: 1, cogX: 1, leftPointId: 'L', rightPointId: 'R', start: 0, end: 5 },
      { id: 'b', name: 'b', weight: 1, cogX: 1, leftPointId: 'L', rightPointId: 'R', start: 5, end: 10 },
    ],
  });
  const left = r.points.find((p) => p.id === 'L');
  // 左分担 (3-1)/3 = 2/3，两件首尾相接但不叠加，峰值 2/3 < 1
  assert.strictEqual(left.peak.num, '2');
  assert.strictEqual(left.peak.den, '3');
  assert.strictEqual(left.peak.kg, 0.67);
  assert.strictEqual(left.overloaded, false);
});

test('kg 两位小数按精确分数四舍五入（1475/3 → 491.67，而非先转浮点）', () => {
  const r = analyzeRigging({
    rigPoints: [
      { id: 'L', name: '左吊点', x: 0, ratedLoad: 1 },
      { id: 'R', name: '右吊点', x: 3, ratedLoad: 1000000 },
    ],
    rigItems: [
      { id: 'a', name: 'a', weight: 1475, cogX: 2, leftPointId: 'L', rightPointId: 'R', start: 0, end: 5 },
    ],
  });
  const left = r.points.find((p) => p.id === 'L');
  assert.strictEqual(left.peak.num, '1475');
  assert.strictEqual(left.peak.den, '3');
  assert.strictEqual(left.peak.kg, 491.67);
});
