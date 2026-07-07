import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRepoDir = dirname(appDir);

export const requiredEvidenceFields = [
  'Verification date/time',
  'Git commit',
  'PR range',
  'Firmware build command',
  'App build/run method',
  'Test phone / OS',
  'Board / sensor wiring',
  'Monitor log path',
  'Screen recording path',
  'BLE verification log',
  'Notify-ready evidence',
  'Baseline session id',
  'Measurement session id',
  'Board-button session id',
  'Cancel session id',
  'Cancel latency',
  'Reconnect/reboot result',
  'Result',
  'Follow-up issue / PR',
];

const highRiskEvidence = [
  [
    'Notify subscription race',
    '첫 status notify 전 start 차단, 연결 후 start가 context timeout 없이 시작됨',
  ],
  [
    '측정 중 cancel 지연',
    '측정 취소 후 1초 안에 device_error(cancelled) 수신, 다음 측정 정상 시작',
  ],
  ['Chunk reassembly stale state', 'reconnect 또는 board reboot 후 큰 result notify가 섞이지 않음'],
  ['PPG 실패 시 결과 차단', 'PPG 값이 없거나 불안정해도 알코올 result가 앱/히스토리에 저장됨'],
  ['ZE29 work mode 잔류', 'baseline, 일반 측정, 보드 버튼 측정이 연속 실행됨'],
];

const verificationCommands = [
  ['Git 기준', 'git status --short --branch'],
  ['앱 테스트', 'cd app && pnpm test && pnpm lint && pnpm exec tsc --noEmit'],
  ['앱 iOS 번들', 'cd app && pnpm exec expo export -p ios --no-minify --clear'],
  ['앱 web 번들', 'cd app && pnpm exec expo export -p web --no-minify --clear'],
  ['펌웨어 빌드', 'cd firmware && cargo fmt --check && cargo check'],
  ['펌웨어 flash', 'cd firmware && . ~/export-esp.sh && cargo run --release'],
];

export function collectMvpVerificationRunData({ repoDir = defaultRepoDir, now = new Date() } = {}) {
  const commit = runGit(repoDir, ['rev-parse', 'HEAD']);
  const shortCommit = runGit(repoDir, ['rev-parse', '--short', 'HEAD']);
  const branch = runGit(repoDir, ['branch', '--show-current']);
  const status = runGit(repoDir, ['status', '--short', '--branch']);
  const recentPrCommits = runGit(repoDir, ['log', '--oneline', '--decorate', '-20'])
    .split('\n')
    .filter((line) => /\(#\d+\)/.test(line));

  return {
    branch,
    commit,
    shortCommit,
    createdAt: now.toISOString(),
    fileStamp: now.toISOString().replace(/[:.]/g, '-'),
    status,
    recentPrCommits,
    serialPorts: listSerialPorts(),
    likelyEsp32SerialPorts: listLikelyEsp32SerialPorts(),
  };
}

export function renderMvpVerificationRun(data) {
  return `# MVP 실기기 검증 실행 기록

이 파일은 \`.docs/mvp-verification.md\`의 0-6번 항목을 실제 보드에서 검증할 때 채우는 실행 기록이다.
자동으로 채워진 값은 시작점일 뿐이며, MVP 완료 판정에는 실제 화면 캡처, monitor log, BLE 검증 로그가 필요하다.

## 자동 수집

| 항목 | 값 |
| --- | --- |
| 생성 일시 | ${data.createdAt} |
| Git branch | ${data.branch || '(unknown)'} |
| Git commit | ${data.commit} |
| Short commit | ${data.shortCommit} |
| ESP32 후보 serial port | ${formatPorts(data.likelyEsp32SerialPorts, '(ESP32 후보 port 미감지)')} |
| 전체 serial port | ${formatPorts(data.serialPorts, '(serial port 없음)')} |

### Git 상태

\`\`\`text
${data.status}
\`\`\`

### 최근 main PR commit

${formatList(data.recentPrCommits)}

## 사전 정적 검증

| 완료 | 항목 | 명령 | 증거 |
| --- | --- | --- | --- |
${verificationCommands.map(([label, command]) => `| [ ] | ${label} | \`${command}\` |  |`).join('\n')}

## 실기기 실행 기록

| 항목 | 값 |
| --- | --- |
${requiredEvidenceFields.map((field) => `| ${field} |  |`).join('\n')}

## 세부 증거

### 1. 펌웨어 flash 및 광고

- [ ] ESP32 flash 완료
- [ ] monitor log에 \`Drunksafe firmware started\` 출력
- [ ] monitor log에 \`BLE advertising started\` 출력
- [ ] OLED Home 화면 표시
- [ ] 앱 또는 BLE scanner에서 \`Drunksafe\` 장치 확인

증거:

- Monitor log:
- OLED 사진:
- BLE scanner 또는 앱 스캔 화면:

### 2. 앱 연결 smoke test

- [ ] 실제 iPhone 또는 Android 개발 빌드 실행
- [ ] BLE 권한 허용
- [ ] \`Drunksafe 스캔\` 결과에 실제 장치 표시
- [ ] 연결 후 상태가 \`연결됨\`
- [ ] Context 상태가 \`준비됨\`

증거:

- App platform / OS:
- 연결된 device id/name:
- 연결 화면 캡처:
- BLE 검증 로그 캡처:

### 3. Baseline 측정

- [ ] \`measurement_started.kind=baseline\`
- [ ] progress 7단계 순서 확인
- [ ] baseline 결과 화면 확인
- [ ] 낮은 safe baseline만 sober baseline에 반영
- [ ] baseline 결과가 일반 측정 히스토리 집계에 섞이지 않음

증거:

- Baseline session id:
- 호기 baseline:
- 안정시 BPM:
- sample count 변화:
- 결과 화면 캡처:

### 4. 일반 측정

- [ ] \`measurement_started.kind=measurement\`
- [ ] \`measurement_result.kind=measurement\`
- [ ] \`measurement_result.measured_at_unix_ms\` 채워짐
- [ ] 결과 저장 상태가 \`저장됨\`
- [ ] 히스토리 최신 기록이 결과 화면과 일치
- [ ] 반복 위험 샘플에서 129/109/지역 센터 개선 안내가 표시됨

증거:

- Measurement session id:
- Alcohol mg/L:
- BAC estimate / upper:
- Risk:
- Sober-time estimate:
- History 화면 캡처:
- 반복 위험 샘플 개선 안내 캡처:

### 5. 보드 버튼 시작

- [ ] GPIO0 trigger 버튼으로 측정 시작
- [ ] \`measurement_started.source=board_button\`
- [ ] 같은 session id의 progress/result 표시
- [ ] 일반 측정 히스토리에 저장

증거:

- Board-button session id:
- Progress 화면 캡처:
- Result 또는 history 화면 캡처:

### 6. 실패 케이스

| 완료 | 케이스 | 기대 결과 | 증거 |
| --- | --- | --- | --- |
| [ ] | Context timeout | 앱 연결 없이 보드 버튼 측정 시 \`context_timeout\` 또는 OLED 실패 화면 |  |
| [ ] | Cancel | 측정 취소 후 \`cancelled\` 메시지, stale progress/result 제거 |  |
| [ ] | 연결 해제 | Bluetooth off 또는 disconnect 후 다음 측정을 막지 않음 |  |
| [ ] | 센서 timeout | ZE29 또는 PPG 입력 없이 \`measurement_timeout\` 또는 센서 오류 표시 |  |

## 고위험 항목 재현

| 완료 | 항목 | 통과 증거 |
| --- | --- | --- |
${highRiskEvidence.map(([label, evidence]) => `| [ ] | ${label} | ${evidence} |`).join('\n')}

## 판정

- [ ] PASS: \`.docs/mvp-verification.md\`의 0-6번 항목이 실제 보드에서 모두 통과했다.
- [ ] FAIL: 아래 후속 이슈 또는 PR이 필요하다.

후속 조치:

- 
`;
}

export function outputPathForRun(data, { repoDir = defaultRepoDir } = {}) {
  return join(repoDir, '.docs', 'mvp-runs', `${data.fileStamp}-${data.shortCommit}.md`);
}

function run() {
  const args = new Set(process.argv.slice(2));
  const data = collectMvpVerificationRunData();
  const markdown = renderMvpVerificationRun(data);

  if (args.has('--print')) {
    process.stdout.write(markdown);
    return;
  }

  if (!args.has('--allow-dirty')) {
    assertCleanMainStatus(data.status);
  }

  const outPath = outputPathForRun(data);
  if (existsSync(outPath) && !args.has('--force')) {
    throw new Error(`verification run file already exists: ${outPath}`);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown);
  console.log(outPath);
}

function runGit(repoDir, args) {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim();
}

export function isCleanMainStatus(status) {
  return status.trim() === '## main...origin/main';
}

export function assertCleanMainStatus(status) {
  if (isCleanMainStatus(status)) {
    return;
  }

  throw new Error(
    [
      'MVP evidence run files must be created from a clean main...origin/main checkout.',
      'Use --print to inspect the draft template without writing a file, or --allow-dirty only for non-MVP draft notes.',
      '',
      status,
    ].join('\n')
  );
}

function listSerialPorts() {
  try {
    return readdirSync('/dev')
      .filter((name) => name.startsWith('cu.') || name.startsWith('tty.'))
      .sort()
      .map((name) => `/dev/${name}`);
  } catch {
    return [];
  }
}

function listLikelyEsp32SerialPorts() {
  return listSerialPorts().filter((port) =>
    /(usbserial|usbmodem|SLAB_USBtoUART|wchusbserial|cu\.usb|tty\.usb)/i.test(port)
  );
}

function formatPorts(ports, empty) {
  return ports.length > 0 ? ports.join('<br>') : empty;
}

function formatList(items) {
  if (items.length === 0) {
    return '- (PR 번호가 포함된 최근 commit 없음)';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
