const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = function testState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-state-'));
  const auth = '{"fixture":"keep this session"}';
  const url = 'https://www.uooc.net.cn/home/course/123';
  try {
    fs.copyFileSync(path.join(__dirname, 'uooc.js'), path.join(root, 'uooc.js'));
    const moduleRoot = path.join(root, 'node_modules', 'playwright');
    fs.mkdirSync(moduleRoot, { recursive: true });
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ courses: [url], customField: 'preserve' }));
    fs.writeFileSync(path.join(moduleRoot, 'index.js'), `
      const response = data => ({ ok: () => true, status: () => 200, json: async () => data });
      const fs = require('node:fs');
      if (process.env.UOOC_TEST_CASE === 'cache-busy') fs.renameSync = () => { throw Object.assign(new Error('fixture busy'), { code: 'EBUSY' }); };
      let queries = 0;
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const request = { get: async url => {
        if (process.env.UOOC_TEST_CASE === 'network') throw new Error('fixture network failure');
        if (url.includes('/member/user')) return response({ code: process.env.UOOC_TEST_CASE === 'expired' ? 401 : 1 });
        if (process.env.UOOC_TEST_CASE === 'count-failed') throw new Error('fixture count query failed');
        const delayed = process.env.UOOC_TEST_CASE === 'delayed' && ++queries === 1;
        return response({ code: 1, data: { signin_cnt: delayed ? '2' : '3', signin_total: '30', signin_time: delayed ? '2000-01-01' : today } });
      } };
      const context = { request, newPage: async () => ({ request,
        waitForResponse: async () => response({ code: 1, data: { is_sign: 1, name: 'fixture course' } }),
        goto: async () => ({ ok: () => true }), close: async () => {}, waitForTimeout: async () => {} }),
        storageState: async () => ({ cookies: [{ domain: '.uooc.net.cn', name: 'fixture', value: 'refreshed' }], origins: [] }) };
      exports.chromium = { launch: async () => ({ newContext: async () => context, close: async () => {} }) };
    `);
    for (const scenario of ['expired', 'network', 'success', 'count-failed', 'delayed', 'cache-busy']) {
      fs.writeFileSync(path.join(root, '.uooc-auth.json'), auth);
      fs.rmSync(path.join(root, '.uooc-status.json'), { force: true });
      fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ courses: scenario === 'cache-busy' ? [url, 'https://www.uooc.net.cn/home/course/456'] : [url], customField: 'preserve' }));
      const oldState = { courses: { [url]: { count: 2, total: 30, checkedAt: '2000-01-01T00:00:00Z' } } };
      if (['delayed', 'cache-busy'].includes(scenario)) fs.writeFileSync(path.join(root, '.uooc-status.json'), JSON.stringify(oldState));
      const child = spawnSync(process.execPath, [path.join(root, 'uooc.js'), 'run'], {
        env: { ...process.env, UOOC_TEST_CASE: scenario }, encoding: 'utf8', timeout: 10000,
      });
      assert.ifError(child.error);
      assert.equal(child.status, scenario === 'expired' ? 2 : scenario === 'network' ? 1 : 0, child.stdout + child.stderr);
      const state = JSON.parse(fs.readFileSync(path.join(root, '.uooc-status.json'), 'utf8'));
      if (scenario === 'cache-busy') {
        assert.deepEqual(state, oldState, 'A locked cache must keep the last valid contents.');
        assert.match(child.stdout, /成功 2，失败 0/);
        assert.match(child.stdout, /显示缓存暂未保存/);
        continue;
      }
      assert.equal(state.loginExpired, scenario === 'expired');
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')).customField, 'preserve');
      if (['expired', 'network'].includes(scenario)) {
        assert.equal(fs.readFileSync(path.join(root, '.uooc-auth.json'), 'utf8'), auth, 'Failed validation must preserve existing credentials.');
      } else {
        assert.equal(state.courses[url].status, 'signed');
        assert.equal(state.courses[url].count, scenario === 'count-failed' ? null : 3);
        assert.equal(state.courses[url].total, scenario === 'count-failed' ? null : 30);
        assert.equal(state.courses[url].countPending, false);
      }
    }
    if (process.platform === 'win32') {
      // Verify the scheduled-run wrapper launches a notice only for a confirmed login expiry.
      fs.copyFileSync(path.join(__dirname, 'run.ps1'), path.join(root, 'run.ps1'));
      fs.mkdirSync(path.join(root, 'runtime'));
      fs.copyFileSync(process.execPath, path.join(root, 'runtime', 'node.exe'));
      fs.writeFileSync(path.join(root, 'wrapper.ps1'), `
        $ErrorActionPreference = 'Stop'
        function Start-Process {
          param($FilePath, $ArgumentList, $WindowStyle)
          @{ FilePath = $FilePath; ArgumentList = $ArgumentList; WindowStyle = $WindowStyle } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'notice.json') -Encoding UTF8
        }
        & (Join-Path $PSScriptRoot 'run.ps1') run -NotifyOnLoginExpiry
        exit $LASTEXITCODE
      `);
      const powershell = path.join(process.env.WINDIR, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      for (const scenario of ['expired', 'network']) {
        fs.writeFileSync(path.join(root, '.uooc-auth.json'), auth);
        const child = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'wrapper.ps1')], {
          env: { ...process.env, UOOC_TEST_CASE: scenario }, encoding: 'utf8', timeout: 15000,
        });
        assert.ifError(child.error);
        assert.equal(child.status, scenario === 'expired' ? 2 : 1, child.stdout + child.stderr);
        assert.equal(fs.readFileSync(path.join(root, '.uooc-auth.json'), 'utf8'), auth);
        if (scenario === 'expired') {
          const notice = JSON.parse(fs.readFileSync(path.join(root, 'notice.json'), 'utf8').replace(/^\uFEFF/, ''));
          assert.match(notice.ArgumentList, /notify\.ps1/);
          assert.equal(notice.WindowStyle, 'Hidden');
          fs.unlinkSync(path.join(root, 'notice.json'));
        } else {
          assert.equal(fs.existsSync(path.join(root, 'notice.json')), false, 'Network failure must not trigger a login-expiry notification.');
          assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.uooc-status.json'), 'utf8')).loginExpired, true,
            'A network error must not clear an earlier confirmed login expiry.');
        }
      }
    }
    console.log('通过：失效退出码、网络错误区分、延迟次数同步、缓存占用不打断其余课程和登录数据保护（模拟账户）。');
  } finally {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('uooc-state-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
};
