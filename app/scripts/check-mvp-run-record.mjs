import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  renderMvpVerificationRun,
  requiredEvidenceFields,
} from './create-mvp-verification-run.mjs';

const requiredPassPhrases = [
  '반복 위험 샘플에서 129/109/지역 센터 개선 안내가 표시됨',
  '반복 위험 샘플 개선 안내 캡처',
  'Notify subscription race',
  'ZE29 work mode 잔류',
];

export function validateMvpRunRecord(markdown) {
  const errors = [];
  const gitStatus = extractCodeBlockAfterHeading(markdown, '### Git 상태');
  const fields = extractTwoColumnTable(markdown, '## 실기기 실행 기록');

  if (gitStatus.trim() !== '## main...origin/main') {
    errors.push('Git 상태 must be exactly "## main...origin/main".');
  }

  for (const phrase of requiredPassPhrases) {
    if (!markdown.includes(phrase)) {
      errors.push(`Required MVP evidence phrase is missing: ${phrase}`);
    }
  }

  const resultValue = (fields.get('Result') ?? '').trim().toUpperCase();
  const passLine = findLine(markdown, 'PASS:');
  const failLine = findLine(markdown, 'FAIL:');
  const passChecked = isCheckedLine(passLine);
  const failChecked = isCheckedLine(failLine);

  for (const field of requiredEvidenceFields) {
    if (!fields.has(field)) {
      errors.push(`Required evidence field is missing: ${field}`);
      continue;
    }

    if (field === 'Follow-up issue / PR' && passChecked) {
      continue;
    }

    const value = fields.get(field)?.trim() ?? '';
    if (value.length === 0) {
      errors.push(`Required evidence field is empty: ${field}`);
    }
  }

  if (!passChecked) {
    errors.push('PASS 판정 checkbox must be checked for MVP completion evidence.');
  }

  if (failChecked) {
    errors.push('FAIL 판정 checkbox must not be checked for MVP completion evidence.');
  }

  if (resultValue !== 'PASS') {
    errors.push('Result field must be PASS for MVP completion evidence.');
  }

  for (const line of linesBefore(markdown, '## 판정')) {
    if (isUncheckedLine(line)) {
      errors.push(`Unchecked required item remains: ${line.trim()}`);
    }
  }

  for (const row of extractTableRows(markdown, '## 사전 정적 검증')) {
    if (row.length < 4 || row[0] === '완료' || row[0] === '---') {
      continue;
    }

    if (!isCheckedValue(row[0])) {
      errors.push(`Static verification is not checked: ${row[1]}`);
    }

    if (row[3].trim().length === 0) {
      errors.push(`Static verification evidence is empty: ${row[1]}`);
    }
  }

  for (const match of markdown.matchAll(/^- ([^:\n]+):\s*$/gm)) {
    errors.push(`Detailed evidence bullet is empty: ${match[1]}`);
  }

  return errors;
}

export function assertMvpRunRecordValid(markdown) {
  const errors = validateMvpRunRecord(markdown);
  assert.deepEqual(errors, []);
}

function run() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error('usage: pnpm mvp:evidence-check -- ../.docs/mvp-runs/<run>.md');
  }

  const markdown = readFileSync(filePath, 'utf8');
  const errors = validateMvpRunRecord(markdown);

  if (errors.length > 0) {
    throw new Error(errors.map((error) => `- ${error}`).join('\n'));
  }

  console.log(`MVP evidence run record is complete: ${filePath}`);
}

function extractCodeBlockAfterHeading(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    return '';
  }

  const rest = markdown.slice(start + heading.length);
  const match = rest.match(/```[^\n]*\n([\s\S]*?)\n```/);
  return match?.[1] ?? '';
}

function extractTwoColumnTable(markdown, heading) {
  return new Map(
    extractTableRows(markdown, heading)
      .filter((row) => row.length >= 2 && row[0] !== '항목' && row[0] !== '---')
      .map(([key, value]) => [key, value])
  );
}

function extractTableRows(markdown, heading) {
  const section = extractSection(markdown, heading);
  return section
    .split('\n')
    .filter((line) => line.trim().startsWith('|') && line.trim().endsWith('|'))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
    );
}

function extractSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) {
    return '';
  }

  const rest = markdown.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

function linesBefore(markdown, heading) {
  const index = markdown.indexOf(heading);
  return (index < 0 ? markdown : markdown.slice(0, index)).split('\n');
}

function findLine(markdown, pattern) {
  return markdown.split('\n').find((line) => line.includes(pattern)) ?? '';
}

function isCheckedLine(line) {
  return /\[[xX]\]/.test(line);
}

function isUncheckedLine(line) {
  return /\[ \]/.test(line);
}

function isCheckedValue(value) {
  return /^\[[xX]\]$/.test(value.trim());
}

function completeRecord(markdown) {
  let completed = markdown
    .replace(/^(\| )\[ \]( \|)/gm, '$1[x]$2')
    .replace(/^- \[ \]/gm, '- [x]')
    .replace('- [x] FAIL:', '- [ ] FAIL:')
    .replace(/\| \[x\] \| ([^|\n]+) \| (`[^`]+`) \|  \|/g, '| [x] | $1 | $2 | evidence for $1 |')
    .replace(/\| ([^|\n]+) \|  \|/g, (_, field) => `| ${field} | evidence for ${field} |`)
    .replace(/\| Result \| evidence for Result \|/, '| Result | PASS |')
    .replace(
      /\| Follow-up issue \/ PR \| evidence for Follow-up issue \/ PR \|/,
      '| Follow-up issue / PR |  |'
    )
    .replace(/^- ([^:\n]+):\s*$/gm, '- $1: captured evidence');

  return completed;
}

function registerTests() {
  test('MVP run record validator accepts a fully completed PASS record', () => {
    const markdown = completeRecord(
      renderMvpVerificationRun({
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        shortCommit: '0123456',
        createdAt: '2026-07-07T00:00:00.000Z',
        fileStamp: '2026-07-07T00-00-00-000Z',
        status: '## main...origin/main',
        recentPrCommits: ['0123456 MVP 증거 템플릿 판정 기준 보강 (#61)'],
        serialPorts: ['/dev/cu.usbserial-0001'],
        likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001'],
      })
    );

    assertMvpRunRecordValid(markdown);
  });

  test('MVP run record validator rejects draft template records', () => {
    const markdown = renderMvpVerificationRun({
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      shortCommit: '0123456',
      createdAt: '2026-07-07T00:00:00.000Z',
      fileStamp: '2026-07-07T00-00-00-000Z',
      status: '## main...origin/main',
      recentPrCommits: ['0123456 MVP 증거 템플릿 판정 기준 보강 (#61)'],
      serialPorts: ['/dev/cu.usbserial-0001'],
      likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001'],
    });

    const errors = validateMvpRunRecord(markdown);

    assert.ok(errors.some((error) => error.includes('PASS 판정 checkbox')));
    assert.ok(errors.some((error) => error.includes('Required evidence field is empty')));
    assert.ok(errors.some((error) => error.includes('Unchecked required item remains')));
  });

  test('MVP run record validator rejects dirty provenance and missing safety guidance', () => {
    const markdown = completeRecord(
      renderMvpVerificationRun({
        branch: 'feature/test',
        commit: '0123456789abcdef0123456789abcdef01234567',
        shortCommit: '0123456',
        createdAt: '2026-07-07T00:00:00.000Z',
        fileStamp: '2026-07-07T00-00-00-000Z',
        status: `## feature/test
 M app/file.ts`,
        recentPrCommits: ['0123456 MVP 증거 템플릿 판정 기준 보강 (#61)'],
        serialPorts: ['/dev/cu.usbserial-0001'],
        likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001'],
      })
    ).replace(/^- \[x\] 반복 위험 샘플에서 129\/109\/지역 센터 개선 안내가 표시됨\n/m, '');

    const errors = validateMvpRunRecord(markdown);

    assert.ok(errors.some((error) => error.includes('Git 상태 must be exactly')));
    assert.ok(errors.some((error) => error.includes('129/109/지역 센터')));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--self-test') {
  registerTests();
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
