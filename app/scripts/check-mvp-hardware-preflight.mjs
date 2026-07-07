import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectMvpVerificationRunData,
  isCleanMainStatus,
  listLikelyEsp32SerialPorts,
  listSerialPorts,
} from './create-mvp-verification-run.mjs';

const requiredCommands = ['git', 'pnpm', 'cargo', 'rustup', 'espflash', 'ldproxy'];
const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRepoDir = dirname(appDir);

export function collectHardwarePreflightData({
  env = process.env,
  repoDir = defaultRepoDir,
  commandResolver = (command) => resolveCommand(command, env),
  verificationData = collectVerificationData(repoDir),
  boardInfoProvider = (port, espflashPath) => readEspflashBoardInfo(port, espflashPath),
} = {}) {
  const commands = Object.fromEntries(
    requiredCommands.map((command) => [command, commandResolver(command)])
  );
  const selectedPort = selectSerialPort(
    verificationData.likelyEsp32SerialPorts,
    env.DRUNKSAFE_PORT
  );
  const boardInfo =
    selectedPort && commands.espflash
      ? readBoardInfo(boardInfoProvider, selectedPort, commands.espflash)
      : null;

  return {
    gitStatus: verificationData.status,
    branch: verificationData.branch,
    commit: verificationData.commit,
    likelyEsp32SerialPorts: verificationData.likelyEsp32SerialPorts,
    serialPorts: verificationData.serialPorts,
    explicitPort: env.DRUNKSAFE_PORT ?? null,
    commands,
    selectedPort,
    boardInfo,
    exportEspPath: join(homedir(), 'export-esp.sh'),
    exportEspExists: existsSync(join(homedir(), 'export-esp.sh')),
    rustToolchainSource: readText(join(repoDir, 'firmware', 'rust-toolchain.toml')),
    firmwareCargoConfigSource: readText(join(repoDir, 'firmware', '.cargo', 'config.toml')),
  };
}

function collectVerificationData(repoDir) {
  try {
    return collectMvpVerificationRunData({ repoDir });
  } catch (error) {
    return {
      status: `failed to collect git status: ${error instanceof Error ? error.message : String(error)}`,
      branch: '',
      commit: '',
      likelyEsp32SerialPorts: listLikelyEsp32SerialPorts(),
      serialPorts: listSerialPorts(),
    };
  }
}

export function validateHardwarePreflight(data) {
  const errors = [];
  const warnings = [];

  if (!isCleanMainStatus(data.gitStatus)) {
    errors.push('Git 상태 must be exactly "## main...origin/main".');
  }

  if (data.likelyEsp32SerialPorts.length === 0 && !data.selectedPort) {
    errors.push('ESP32 후보 serial port가 없습니다. 보드를 USB로 연결한 뒤 다시 실행하세요.');
  }

  if (data.likelyEsp32SerialPorts.length > 1 && !data.selectedPort) {
    errors.push('ESP32 후보 serial port가 여러 개입니다. DRUNKSAFE_PORT를 지정하세요.');
  }

  if (
    data.selectedPort &&
    data.serialPorts.length > 0 &&
    !data.serialPorts.includes(data.selectedPort)
  ) {
    errors.push(`선택한 DRUNKSAFE_PORT가 현재 serial port 목록에 없습니다: ${data.selectedPort}`);
  }

  for (const command of requiredCommands) {
    if (!data.commands[command]) {
      errors.push(`Required command is missing from PATH: ${command}`);
    }
  }

  if (!data.exportEspExists) {
    errors.push(
      '~/export-esp.sh가 없습니다. firmware/README.md의 espup 설치 절차를 먼저 수행하세요.'
    );
  }

  if (!/channel\s*=\s*["']esp["']/.test(data.rustToolchainSource)) {
    errors.push('firmware/rust-toolchain.toml must use channel = "esp".');
  }

  for (const pattern of [
    'target = "xtensa-esp32-espidf"',
    'linker = "ldproxy"',
    'runner = "espflash flash --monitor"',
    'MCU = "esp32"',
    'ESP_IDF_VERSION = "v5.5.3"',
  ]) {
    if (!data.firmwareCargoConfigSource.includes(pattern)) {
      errors.push(`firmware/.cargo/config.toml is missing required ESP32 setting: ${pattern}`);
    }
  }

  if (data.selectedPort && data.commands.espflash) {
    if (!data.boardInfo?.ok) {
      errors.push(
        `espflash board-info failed for ${data.selectedPort}: ${data.boardInfo?.error ?? 'unknown error'}`
      );
    } else if (!/\bESP32\b/i.test(data.boardInfo.output)) {
      errors.push(`espflash board-info did not identify an ESP32 on ${data.selectedPort}.`);
    }
  }

  if (
    data.serialPorts.some((port) => /Bluetooth|debug-console/i.test(port)) &&
    data.likelyEsp32SerialPorts.length === 0 &&
    !data.selectedPort
  ) {
    warnings.push(
      'macOS 기본 Bluetooth/debug-console port만 보입니다. ESP32 USB serial port는 아직 보이지 않습니다.'
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function renderHardwarePreflightReport(data, result) {
  return [
    '# MVP hardware preflight',
    '',
    `Git branch: ${data.branch || '(unknown)'}`,
    `Git commit: ${data.commit || '(unknown)'}`,
    `Git status: ${JSON.stringify(data.gitStatus)}`,
    '',
    '## Serial ports',
    `ESP32 candidates: ${formatList(data.likelyEsp32SerialPorts)}`,
    `Selected port: ${data.selectedPort ?? '(none)'}`,
    `All ports: ${formatList(data.serialPorts)}`,
    '',
    '## ESP Rust setup',
    `~/export-esp.sh: ${data.exportEspExists ? data.exportEspPath : '(missing)'}`,
    `firmware/rust-toolchain.toml: ${summarizeCheck(data.rustToolchainSource.includes('channel = "esp"'))}`,
    `firmware/.cargo/config.toml target: ${summarizeCheck(
      data.firmwareCargoConfigSource.includes('target = "xtensa-esp32-espidf"')
    )}`,
    `espflash board-info: ${formatBoardInfo(data.boardInfo)}`,
    '',
    '## Commands',
    ...requiredCommands.map((command) => `${command}: ${data.commands[command] ?? '(missing)'}`),
    '',
    '## Result',
    result.ok ? 'PASS' : 'FAIL',
    ...result.errors.map((error) => `ERROR: ${error}`),
    ...result.warnings.map((warning) => `WARN: ${warning}`),
    '',
  ].join('\n');
}

function run() {
  const data = collectHardwarePreflightData();
  const result = validateHardwarePreflight(data);
  const report = renderHardwarePreflightReport(data, result);
  console.log(report);

  if (!result.ok) {
    process.exitCode = 1;
  }
}

function resolveCommand(command, env) {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);

    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function selectSerialPort(ports, explicitPort) {
  if (explicitPort) {
    return explicitPort;
  }

  return ports.length === 1 ? ports[0] : null;
}

function readBoardInfo(provider, port, espflashPath) {
  try {
    return { ok: true, output: provider(port, espflashPath) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function readEspflashBoardInfo(port, espflashPath) {
  return execFileSync(espflashPath, ['board-info', '--port', port], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function summarizeCheck(ok) {
  return ok ? 'ok' : 'missing';
}

function formatBoardInfo(boardInfo) {
  if (!boardInfo) {
    return '(not run)';
  }

  return boardInfo.ok ? firstLine(boardInfo.output) : `failed: ${boardInfo.error}`;
}

function firstLine(value) {
  return (
    value
      .split('\n')
      .find((line) => line.trim().length > 0)
      ?.trim() ?? '(empty)'
  );
}

function formatList(items) {
  return items.length > 0 ? items.join(', ') : '(none)';
}

function registerTests() {
  test('hardware preflight passes with clean main, ESP32 serial, and required commands', () => {
    const data = collectHardwarePreflightData({
      commandResolver: (command) => `/bin/${command}`,
      verificationData: {
        status: '## main...origin/main',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001'],
        serialPorts: ['/dev/cu.usbserial-0001'],
      },
      boardInfoProvider: () => 'Chip type: ESP32\n',
      repoDir: '/missing-fixture-repo',
    });
    data.exportEspExists = true;
    data.rustToolchainSource = 'channel = "esp"';
    data.firmwareCargoConfigSource = [
      'target = "xtensa-esp32-espidf"',
      'linker = "ldproxy"',
      'runner = "espflash flash --monitor"',
      'MCU = "esp32"',
      'ESP_IDF_VERSION = "v5.5.3"',
    ].join('\n');
    const result = validateHardwarePreflight(data);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });

  test('hardware preflight rejects dirty git, missing ESP32 serial, and missing flash tools', () => {
    const data = collectHardwarePreflightData({
      commandResolver: (command) =>
        ['git', 'pnpm', 'cargo', 'rustup'].includes(command) ? `/bin/${command}` : null,
      verificationData: {
        status: `## feature/test
 M app/file.ts`,
        branch: 'feature/test',
        commit: '0123456789abcdef0123456789abcdef01234567',
        likelyEsp32SerialPorts: [],
        serialPorts: ['/dev/cu.Bluetooth-Incoming-Port'],
      },
      repoDir: '/missing-fixture-repo',
    });
    data.exportEspExists = false;
    data.exportEspPath = '/missing/export-esp.sh';
    const result = validateHardwarePreflight(data);
    const report = renderHardwarePreflightReport(data, result);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('Git 상태')));
    assert.ok(result.errors.some((error) => error.includes('ESP32 후보 serial port')));
    assert.ok(result.errors.some((error) => error.includes('espflash')));
    assert.ok(result.errors.some((error) => error.includes('ldproxy')));
    assert.ok(result.errors.some((error) => error.includes('export-esp.sh')));
    assert.match(report, /WARN: macOS 기본 Bluetooth/);
  });

  test('hardware preflight requires an explicit port when multiple ESP32 candidates exist', () => {
    const data = collectHardwarePreflightData({
      commandResolver: (command) => `/bin/${command}`,
      verificationData: {
        status: '## main...origin/main',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        likelyEsp32SerialPorts: ['/dev/cu.usbserial-0001', '/dev/cu.usbserial-0002'],
        serialPorts: ['/dev/cu.usbserial-0001', '/dev/cu.usbserial-0002'],
      },
      boardInfoProvider: () => 'Chip type: ESP32\n',
      repoDir: '/missing-fixture-repo',
    });
    data.exportEspExists = true;
    data.rustToolchainSource = 'channel = "esp"';
    data.firmwareCargoConfigSource = [
      'target = "xtensa-esp32-espidf"',
      'linker = "ldproxy"',
      'runner = "espflash flash --monitor"',
      'MCU = "esp32"',
      'ESP_IDF_VERSION = "v5.5.3"',
    ].join('\n');
    const result = validateHardwarePreflight(data);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('DRUNKSAFE_PORT')));
  });

  test('hardware preflight accepts an explicit non-candidate serial port after ESP32 board-info', () => {
    const data = collectHardwarePreflightData({
      env: {
        DRUNKSAFE_PORT: '/dev/cu.debug-console',
      },
      commandResolver: (command) => `/bin/${command}`,
      verificationData: {
        status: '## main...origin/main',
        branch: 'main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        likelyEsp32SerialPorts: [],
        serialPorts: ['/dev/cu.debug-console'],
      },
      boardInfoProvider: () => 'Chip type: ESP32\n',
      repoDir: '/missing-fixture-repo',
    });
    data.exportEspExists = true;
    data.rustToolchainSource = 'channel = "esp"';
    data.firmwareCargoConfigSource = [
      'target = "xtensa-esp32-espidf"',
      'linker = "ldproxy"',
      'runner = "espflash flash --monitor"',
      'MCU = "esp32"',
      'ESP_IDF_VERSION = "v5.5.3"',
    ].join('\n');
    const result = validateHardwarePreflight(data);

    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--self-test') {
  registerTests();
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
