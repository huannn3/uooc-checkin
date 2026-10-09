const assert = require('node:assert/strict');
const { courseUrl, visitCourse, signinResult, signinCounts, checkLogin, siteState, playwright } = require('./uooc');

async function main() {
  const state = siteState({
    cookies: [
      { domain: '.uooc.net.cn', name: 'session', value: 'test-session', expires: -1 },
      { domain: 'www.uooc.net.cn', name: 'remember', value: 'test-only', expires: 9999999999 },
      { domain: 'evil-uooc.net.cn', name: 'other', value: 'excluded' },
    ],
    origins: [
      { origin: 'https://uooc.net.cn', localStorage: [{ name: 'token', value: 'test-only' }] },
      { origin: 'https://example.com', localStorage: [] },
    ],
  });
  assert.equal(state.cookies.length, 2);
  assert.equal(state.cookies[0].expires, -1, '必须保留会话 Cookie 供下次运行恢复');
  assert.equal(state.origins.length, 1);
  assert.equal(state.origins[0].localStorage[0].value, 'test-only');
  assert.equal(courseUrl('http://www.uooc.net.cn/home/course/123/?a=1#foo'),
    'http://www.uooc.net.cn/home/course/123');
  assert.equal(courseUrl('http://uooc.net.cn/home/learn/new/466490612#/466490612/63971989/1639840758/278902284/section'),
    'http://uooc.net.cn/home/learn/new/466490612#/466490612/63971989/1639840758/278902284/section');
  assert.equal(courseUrl('https://www.uooc.net.cn/home/learn/123#/456'),
    'https://www.uooc.net.cn/home/learn/123#/456');
  for (const url of ['https://evil.test/home/course/123', 'https://www.uooc.net.cn/course/123',
    'https://www.uooc.net.cn/home/course/signin', 'ftp://www.uooc.net.cn/home/course/123',
    'https://user:pass@www.uooc.net.cn/home/course/123', 'https://www.uooc.net.cn:8443/home/course/123']) {
    assert.throws(() => courseUrl(url));
  }
  const response = (data, status = 200) => ({
    url: () => 'https://www.uooc.net.cn/home/course/info?cid=123',
    request: () => ({ method: () => 'GET' }),
    ok: () => status === 200, status: () => status,
    json: async () => data,
  });
  function pageFor(result, navOK = true, progress) {
    let waiting = false;
    return {
      waitForResponse: predicate => {
        waiting = true;
        assert.equal(predicate(response({ code: 1 })), true);
        assert.equal(predicate({ ...response({}), url: () => 'https://uooc.net.cn/home/course/info?cid=123' }), true);
        assert.equal(predicate({ ...response({}), url: () => 'http://uooc.net.cn/home/course/info?cid=123' }), true);
        assert.equal(predicate({ ...response({}), url: () => 'https://evil.test/home/course/info?cid=123' }), false);
        assert.equal(predicate({ ...response({}), url: () => 'https://www.uooc.net.cn/home/course/info?cid=456' }), false);
        assert.equal(predicate({ ...response({}), request: () => ({ method: () => 'POST' }) }), false);
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      goto: async () => {
        assert.equal(waiting, true, '签到响应监听必须先于页面导航');
        return { ok: () => navOK };
      },
      waitForTimeout: async () => {},
      request: { get: async (url, options) => {
        assert.equal(new URL(url).pathname, '/home/course/progress');
        assert.equal(options.params.cid, '123');
        if (progress instanceof Error) throw progress;
        const value = typeof progress === 'function' ? progress() : progress;
        return value && value.json ? value : response({ code: 1, data: value });
      } },
    };
  }
  const url = courseUrl('https://www.uooc.net.cn/home/course/123');
  assert.equal((await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } })), url)).status, 'signed');
  assert.equal((await visitCourse(pageFor(response({ code: '1', data: { is_sign: '1' } })), url)).status, 'signed');
  assert.equal((await visitCourse(pageFor(response({ code: 1,
    data: { is_sign: 1, parent_name: '高等数学A(1)', course_name: '2026年秋季学期' } })), url)).title, '高等数学A(1)');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  assert.equal((await visitCourse(pageFor(response({ code: 1, data: { is_sign: 2 } }), true,
    { signin_time: today + ' 20:30:37', signin_cnt: '2' }), url)).status, 'already');
  assert.equal(signinResult({}, { signin_cnt: '30', signin_total: '30', signin_time: '2020-01-01' }, today).status, 'complete');
  assert.throws(() => signinResult({}, { signin_time: '2020-01-01', signin_cnt: '1', signin_total: '30' }, today), /未确认今日签到/);
  assert.throws(() => signinResult({}, { signin_total: '0' }, today), /未确认今日签到/);
  await assert.rejects(visitCourse(pageFor(response({ code: 401 })), url), error => error.code === 'LOGIN_EXPIRED');
  await assert.rejects(visitCourse(pageFor(response({}, 401)), url), error => error.code === 'LOGIN_EXPIRED');
  assert.deepEqual(signinCounts({ signin_cnt: '3', signin_total: '30' }), { count: 3, total: 30 });
  assert.deepEqual(signinCounts({ signin_cnt: '0', signin_total: '0' }), { count: 0, total: 0 });
  for (const value of [null, '', -1, 'abc', 1.5]) {
    assert.deepEqual(signinCounts({ signin_cnt: value, signin_total: '30' }), {});
  }
  const counted = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true,
    { signin_cnt: '3', signin_total: '30' }), url);
  assert.equal(counted.count, 3);
  assert.equal(counted.total, 30);
  let queries = 0;
  const delayed = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true, () => {
    queries++;
    return { signin_cnt: queries === 1 ? '5' : '6', signin_total: '20', signin_time: queries === 1 ? '2000-01-01' : today };
  }), url, 30000, { count: 5, total: 20, checkedAt: '2000-01-01T00:00:00Z' });
  assert.equal(queries, 2);
  assert.equal(delayed.count, 6);
  assert.equal(delayed.countPending, undefined);
  queries = 0;
  const timeAheadOfCount = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true, () => {
    queries++;
    return { signin_cnt: queries < 3 ? '5' : '6', signin_total: '20', signin_time: today };
  }), url, 30000, { count: 5, total: 20, checkedAt: '2000-01-01T00:00:00Z' });
  assert.equal(queries, 3);
  assert.equal(timeAheadOfCount.count, 6);
  const pending = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true,
    { signin_cnt: '5', signin_total: '20', signin_time: '2000-01-01' }), url);
  assert.equal(pending.status, 'signed');
  assert.equal(pending.count, 5, 'Never invent a +1 when the platform has not returned it.');
  assert.equal(pending.countPending, true);
  const countFailed = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true, new Error('network')), url);
  assert.equal(countFailed.status, 'signed');
  assert.equal(countFailed.countError, 'network');
  const countExpired = await visitCourse(pageFor(response({ code: 1, data: { is_sign: 1 } }), true, response({ code: 401 })), url);
  assert.equal(countExpired.status, 'signed');
  assert.equal(countExpired.loginExpired, true);
  const redirected = pageFor(response({ code: 1 }));
  redirected.url = () => 'https://www.uooc.net.cn/index/login';
  await assert.rejects(visitCourse(redirected, url), error => error.code === 'LOGIN_EXPIRED');
  const redirectedNetwork = pageFor(response({ code: 1 }), false);
  redirectedNetwork.url = redirected.url;
  await assert.rejects(visitCourse(redirectedNetwork, url), error => error.code !== 'LOGIN_EXPIRED' && /请求失败/.test(error.message));
  const login502 = { ...response({}, 502), url: redirected.url };
  await assert.rejects(checkLogin({ get: async () => login502 }, 'https://www.uooc.net.cn'),
    error => error.code !== 'LOGIN_EXPIRED' && /HTTP 502/.test(error.message));
  for (const data of [{ code: 401 }, { code: 0, msg: '请先登陆' }]) {
    await assert.rejects(checkLogin({ get: async () => response(data) }, 'https://www.uooc.net.cn'), error => error.code === 'LOGIN_EXPIRED');
  }
  await assert.rejects(checkLogin({ get: async () => { throw new Error('network'); } }, 'https://www.uooc.net.cn'), error => error.code !== 'LOGIN_EXPIRED');
  await assert.rejects(visitCourse(pageFor(response({ code: 0, msg: '失败' })), url), /未返回成功/);
  await assert.rejects(visitCourse(pageFor(response({ code: 1 }, 500)), url), /HTTP 500/);
  await assert.rejects(visitCourse(pageFor(new Error('timeout')), url), /未收到课程信息响应/);
  await assert.rejects(visitCourse(pageFor(response({ code: 1 }), false), url), /课程页面请求失败/);
  const nonJSON = { ...response({}), json: async () => { throw new Error('not JSON'); } };
  await assert.rejects(visitCourse(pageFor(nonJSON), url), /非 JSON/);
  console.log('通过：课程地址校验、响应监听顺序、成功、登录过期、错误返回和超时处理。');
  require('./test-state')();
  require('./test-relogin')();
  await require('./test-status')();
  await require('./test-login')();
  if (process.argv.includes('--browser')) {
    const browser = await playwright().chromium.launch({ channel: 'msedge', headless: true, chromiumSandbox: true });
    try {
      const first = await browser.newContext();
      await first.route('https://www.uooc.net.cn/**', route => route.fulfill({
        status: 200, contentType: 'text/html',
        headers: { 'set-cookie': 'test-session=fixture; Path=/; HttpOnly; Secure' },
        body: '<script>localStorage.setItem("test-storage", "fixture")</script>',
      }));
      const page = await first.newPage();
      await page.goto('https://www.uooc.net.cn/');
      const saved = siteState(await first.storageState());
      await first.close();
      const second = await browser.newContext({ storageState: saved });
      assert.equal((await second.cookies()).find(cookie => cookie.name === 'test-session').value, 'fixture');
      await second.route('https://www.uooc.net.cn/**', route => route.fulfill({ status: 200, body: 'test' }));
      const restored = await second.newPage();
      await restored.goto('https://www.uooc.net.cn/');
      assert.equal(await restored.evaluate(() => localStorage.getItem('test-storage')), 'fixture');
      await second.close();
      console.log('通过：真实 Edge 的会话 Cookie 和 localStorage 在关闭上下文后成功恢复（模拟网页，无真实登录请求）。');
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
