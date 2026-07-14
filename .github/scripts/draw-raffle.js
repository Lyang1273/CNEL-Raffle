#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

function writeLines(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`);
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

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    fail(`GitHub API request failed: ${response.status} ${response.statusText}\n${body}`);
  }

  return response.json();
}

function resolveMode() {
  const modeInput = (process.env.MODE_INPUT || '').trim();
  if (modeInput) {
    return modeInput;
  }

  const scheduleCron = (process.env.SCHEDULE_CRON || '').trim();
  if (scheduleCron === '0 7 18 7 *') {
    return 'contributors';
  }

  return 'normal';
}

function getPoolMeta(mode) {
  if (mode === 'contributors') {
    return {
      poolName: '奖池一（方式一）',
      fileSlug: 'pool-1',
      fileEnv: 'POOL_ONE_FILE',
      defaultFile: '.github/raffle/pool-1.txt',
      carryoverFileName: 'pool-2-carryover.txt',
    };
  }

  return {
    poolName: '奖池二（方式二）',
    fileSlug: 'pool-2',
    fileEnv: 'POOL_TWO_FILE',
    defaultFile: '.github/raffle/pool-2.txt',
    carryoverFileName: 'pool-2-carryover.txt',
  };
}

function renderResult({ poolName, source, winners, totalCandidates }) {
  const now = new Date().toISOString();

  return [
    `#### 抽奖结果`,
    '',
    `- 奖池：${poolName}`,
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
  const today = new Date().toISOString().slice(0, 10);
  const mode = resolveMode();
  const winnersCount = Number.parseInt(process.env.WINNERS || '10', 10);
  if (!Number.isInteger(winnersCount) || winnersCount <= 0) {
    fail('WINNERS 必须是大于 0 的整数。');
  }

  const outputDir = (process.env.OUTPUT_DIR || 'results').trim();
  const outputReadme = (process.env.OUTPUT_README || '').trim();
  const repository = (process.env.GITHUB_REPOSITORY || '').trim();
  const { poolName, fileSlug, carryoverFileName, fileEnv, defaultFile } = getPoolMeta(mode);
  const poolFile = (process.env[fileEnv] || defaultFile).trim();
  let candidates = [];
  let source = '';
  let carryoverCandidates = [];
  const carryoverFile = path.join(outputDir, `${today}-${carryoverFileName}`);

  if (!repository.includes('/')) {
    fail('GITHUB_REPOSITORY 未正确设置。');
  }

  if (!fs.existsSync(poolFile)) {
    fail(`名单文件不存在：${poolFile}`);
  }

  candidates = parseEntries(fs.readFileSync(poolFile, 'utf8'));
  source = poolFile;

  if (mode === 'normal' && fs.existsSync(carryoverFile)) {
    carryoverCandidates = parseEntries(fs.readFileSync(carryoverFile, 'utf8'));
    candidates = uniqueEntries([...candidates, ...carryoverCandidates]);
    source = carryoverCandidates.length > 0 ? `${poolFile} + ${carryoverFileName}` : poolFile;
  }

  if (candidates.length === 0) {
    fail('没有可抽取的候选人。');
  }

  const winners = sample(candidates, Math.min(winnersCount, candidates.length));
  const losers = candidates.filter((candidate) => !winners.includes(candidate));
  const resultFileName = `${today}-${fileSlug}.md`;
  const resultPath = path.join(outputDir, resultFileName);
  const resultMarkdown = renderResult({ poolName, source, winners, totalCandidates: candidates.length });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(resultPath, resultMarkdown);

  if (outputReadme) {
    if (!fs.existsSync(outputReadme)) {
      fail(`README 文件不存在：${outputReadme}`);
    }

    const readmeContent = fs.readFileSync(outputReadme, 'utf8');
    const sectionName = mode === 'contributors' ? 'pool-1' : 'pool-2';
    const updatedReadme = replaceSection(readmeContent, sectionName, resultMarkdown);
    fs.writeFileSync(outputReadme, updatedReadme);
  }

  if (mode === 'contributors') {
    if (losers.length > 0) {
      writeLines(carryoverFile, losers);
    } else if (fs.existsSync(carryoverFile)) {
      fs.unlinkSync(carryoverFile);
    }
  }

  console.log(`Pool: ${poolName}`);
  console.log(`Source: ${source}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Winners: ${winners.join(', ')}`);
  if (mode === 'contributors') {
    console.log(`Carryover: ${losers.length}`);
  }
  console.log(`Result file: ${resultPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
