const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
module.exports = async function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uooc-login-test-'));
  const copied = path.join(root, 'uooc.js');
  try {
    fs.copyFileSync(path.join(__dirname, 'uooc.js'), copied);
    const { fillLogin } = require(copied);
    const calls = [];
    let verified = false;
    let ticks = 0;
    const login = { account: 'fixture@example.invalid', password: 'private-fixture-password' };
    const button = { waitFor: async () => {}, isEnabled: async () => true, click: async () => calls.push('submit') };
    const form = { getByRole: () => button, getByText: () => ({ isVisible: async () => verified }) };
    const frame = { url: () => 'https://www.uooc.net.cn/user/login', waitForLoadState: async () => calls.push('frame-loaded'), locator: selector => ({
      click: async () => calls.push(selector),
      fill: async value => { assert.equal(value, selector.includes('手机号/邮箱') ? login.account : login.password); calls.push(selector); },
      locator: () => form,
    }) };
    const page = { url: () => 'https://www.uooc.net.cn/league/union', frames: () => [frame],
      locator: selector => ({ click: async () => calls.push(selector) }),
      waitForTimeout: async () => { assert.ok(!calls.includes('submit'), 'Must wait for the user to complete verification.'); verified = ++ticks >= 2; },
    };
    await fillLogin(page, login, 1000);
    assert.deepEqual(calls, ['#loginBtn', 'frame-loaded', '#passwd_li', 'input[placeholder="手机号/邮箱"]:visible', 'input[placeholder="密码"]:visible', 'submit']);
    assert.equal(ticks, 2);
    assert.ok(!fs.readFileSync(path.join(root, 'uooc.log'), 'utf8').includes(login.password));
    calls.length = 0;
    await assert.rejects(fillLogin({ ...page, url: () => 'https://evil.example/' }, login), /来源/);
    assert.deepEqual(calls, [], 'Never enter credentials on another host.');
    verified = false;
    const idle = { ...page, waitForTimeout: async () => new Promise(resolve => setTimeout(resolve, 5)) };
    await assert.rejects(fillLogin(idle, login, 20), /超时/);
    assert.ok(!calls.includes('submit'), 'An enabled login button alone does not prove verification passed.');
    console.log('通过：账号自动填写、等待人工验证、外站拒绝填写、验证超时不提交及日志不含密码（模拟表单）。');
  } finally {
    delete require.cache[copied];
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('uooc-login-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
};
