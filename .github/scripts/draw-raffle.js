#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');

function fail(message) {
  throw new Error(message);
}

function uniqueEntries(entries) {
  const seen = new Set();
  const normalized = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);
  }

  return normalized;
}

function parseEntries(rawValue) {
  return uniqueEntries(rawValue.split(/\r?\n/));
}

function sample(entries, count) {
  const picked = entries.slice();

  for (let index = picked.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(0, index + 1);
    [picked[index], picked[randomIndex]] = [picked[randomIndex], picked[index]];
  }

  return picked.slice(0, count);
}

function replaceSection(content, sectionName, replacement) {
  const startMarker = `<!-- raffle:${sectionName}:start -->`;
  const endMarker = `<!-- raffle:${sectionName}:end -->`;
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    fail(`README 中缺少 ${sectionName} 的占位标记。`);
  }

  const before = content.slice(0, startIndex + startMarker.length);
  const after = content.slice(endIndex);
  return `${before}\n\n${replacement}\n\n${after}`;
}

function renderResult({ source, winners, totalCandidates }) {
  const now = new Date().toISOString();

  return [
    '#### 抽奖结果',
    '',
    `- 数据来源：${source}`,
    `- 候选人数：${totalCandidates}`,
    `- 中奖人数：${winners.length}`,
    `- 生成时间：${now}`,
    '',
    '#### 中奖名单',
    '',
    ...winners.map((winner, index) => `${index + 1}. ${winner}`),
    '',
  ].join('\n');
}

async function main() {
  const winnersCount = Number.parseInt(process.env.WINNERS || '25', 10);
  if (!Number.isInteger(winnersCount) || winnersCount <= 0) {
    fail('WINNERS 必须是大于 0 的整数。');
  }

  const today = new Date().toISOString().slice(0, 10);
  const outputDir = (process.env.OUTPUT_DIR || 'results').trim();
  const outputReadme = (process.env.OUTPUT_README || '').trim();
  const repository = (process.env.GITHUB_REPOSITORY || '').trim();
  const poolFile = (process.env.POOL_FILE || '.github/raffle/pool.txt').trim();

  if (!repository.includes('/')) {
    fail('GITHUB_REPOSITORY 未正确设置。');
  }

  if (!fs.existsSync(poolFile)) {
    fail(`名单文件不存在：${poolFile}`);
  }

  const candidates = parseEntries(fs.readFileSync(poolFile, 'utf8'));
  if (candidates.length === 0) {
    fail('没有可抽取的候选人。');
  }

  const winners = sample(candidates, Math.min(winnersCount, candidates.length));
  const resultFileName = `${today}-winners.md`;
  const resultPath = `${outputDir}/${resultFileName}`;
  const resultMarkdown = renderResult({ source: poolFile, winners, totalCandidates: candidates.length });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(resultPath, resultMarkdown);

  if (outputReadme) {
    if (!fs.existsSync(outputReadme)) {
      fail(`README 文件不存在：${outputReadme}`);
    }

    const readmeContent = fs.readFileSync(outputReadme, 'utf8');
    const updatedReadme = replaceSection(readmeContent, 'winners', resultMarkdown);
    fs.writeFileSync(outputReadme, updatedReadme);
  }

  console.log(`名单：中奖名单`);
  console.log(`Source: ${poolFile}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Winners: ${winners.join(', ')}`);
  console.log(`Result file: ${resultPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
