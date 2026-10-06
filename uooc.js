const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const CONFIG = path.join(ROOT, 'config.json');
const PROFILE = path.join(ROOT, '.uooc-profile');
const AUTH = path.join(ROOT, '.uooc-auth.json');
const ORIGIN = 'https://www.uooc.net.cn';
const HOSTS = ['www.uooc.net.cn', 'uooc.net.cn'];

function courseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.includes(url.hostname)
      || url.port || url.username || url.password
      || !/^\/home\/(?:course|learn(?:\/new)?)\/\d+\/?$/.test(url.pathname)) {
    throw new Error('请使用点击继续学习后的 Uooc 地址（/home/course/数字 或 /home/learn/new/数字）。');
  }
  const route = url.pathname.replace(/\/$/, '');
  return url.origin + route + (route.includes('/learn/') ? url.search + url.hash : '');
}

function readCourses() {
  if (!fs.existsSync(CONFIG)) return [];
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(config.courses)) throw new Error('config.json 的 courses 必须是数组。');
  return [...new Set(config.courses.map(courseUrl))];
}

function saveCourses(courses, names = {}) {
  const config = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8').replace(/^\uFEFF/, '')) : {};
  fs.writeFileSync(CONFIG, JSON.stringify({ ...config, courses,
    courseNames: { ...config.courseNames, ...names } }, null, 2) + '\n', 'utf8');
}

function log(message) {
  const time = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const line = `[${time}] ${message}\n`;
  process.stdout.write(line);
  fs.appendFileSync(path.join(ROOT, 'uooc.log'), line, 'utf8');
}

function playwright() {
  try { return require('playwright'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // 这台电脑已有 Codex 提供的 Playwright，无需重复安装。
    const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes',
      'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright');
    if (fs.existsSync(bundled)) return require(bundled);
    throw new Error('缺少 Playwright，请先运行 npm install。');
  }
}

function siteState(state) {
  return {
    cookies: state.cookies.filter(cookie => HOSTS.includes(cookie.domain.replace(/^\./, ''))),
    origins: state.origins.filter(origin => HOSTS.includes(new URL(origin.origin).hostname)),
  };
}

async function openSetupBrowser() {
  const candidates = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map(base => path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  const executable = candidates.find(file => fs.existsSync(file));
  if (!executable) throw new Error('未找到 Microsoft Edge。');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  // 普通 Edge 启动；只在本机开放调试连接，用户手动完成登录和验证码。
  const child = spawn(executable, [
    `--user-data-dir=${PROFILE}`, '--profile-directory=Default',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
    '--no-first-run', '--new-window', ORIGIN + '/league/union',
  ], { stdio: 'ignore' });
  let launchError;
  child.once('error', error => { launchError = error; });
  child.unref();
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    try {
      const result = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1000) });
      if (result.ok) return await playwright().chromium.connectOverCDP(endpoint);
    } catch { /* 浏览器启动中，稍后重试。 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('无法连接配置窗口。请关闭之前脚本打开的所有 Edge 窗口，再运行 setup。');
}

function signinResult(info, progress, today) {
  if (String(info.is_sign) === '1') return { status: 'signed' };
  if (String(progress.signin_time || '').slice(0, 10) === today) {
    return { status: 'already', count: progress.signin_cnt };
  }
  const count = Number(progress.signin_cnt);
  const total = Number(progress.signin_total);
  if (Number.isFinite(count) && total > 0 && count >= total) return { status: 'complete', count, total };
  throw new Error(`已进入课程，但未确认今日签到；最近记录：${progress.signin_time || '无'}。`);
}

async function responseData(response) {
  if (!response.ok()) throw new Error(`课程接口 HTTP ${response.status()}。`);
  let data;
  try { data = await response.json(); } catch { throw new Error('课程接口返回了非 JSON 内容。'); }
  if (String(data.code) === '401') throw new Error('登录已过期，请重新运行 setup。');
  if (String(data.code) !== '1') {
    const message = String(data.msg || '未知错误').replace(/[\r\n]/g, ' ').slice(0, 160);
    throw new Error(`网站接口未返回成功（code=${data.code}）：${message}`);
  }
  return data.data || {};
}

async function visitCourse(page, url, timeout = 30000) {
  const cid = new URL(url).pathname.match(/\d+\/?$/)[0].replace(/\/$/, '');
  // 当前页面通过 /home/course/info 的 is_sign 字段返回签到结果。
  // 必须先监听再进入页面，响应可能早于页面加载完成。
  const receipt = page.waitForResponse(response => {
    const endpoint = new URL(response.url());
    return ['http:', 'https:'].includes(endpoint.protocol) && HOSTS.includes(endpoint.hostname)
      && !endpoint.port && endpoint.pathname === '/home/course/info'
      && endpoint.searchParams.get('cid') === cid && response.request().method() === 'GET';
  }, { timeout }).then(response => ({ response }), () => ({ response: null }));
  const navigation = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  if (!navigation || !navigation.ok()) throw new Error('课程页面请求失败，请检查网络和登录状态。');
  const { response } = await receipt;
  if (!response) throw new Error('未收到课程信息响应，请检查页面是否正常加载。');
  const info = await responseData(response);
  const title = info.parent_name || info.name || info.course_name || `课程 ${cid}`;
  if (String(info.is_sign) === '1') return { status: 'signed', title };
  // 今日已签到时页面不再返回“新签到”标记，读取成绩中的签到日期核实。
  const progressResponse = await page.request.get(new URL('/home/course/progress', url).href, {
    params: { cid }, timeout,
  });
  const progress = await responseData(progressResponse);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return { ...signinResult(info, progress, today), title };
}

async function main() {
  const mode = process.argv[2] || 'run';
  if (!['login', 'setup', 'run'].includes(mode) || process.argv.slice(3).some(x => x !== '--visible')) {
    throw new Error('用法：node uooc.js setup | node uooc.js run [--visible]');
  }
  const courses = readCourses();
  const setup = mode === 'setup' || mode === 'login';
  if (!setup && (!courses.length || !fs.existsSync(AUTH))) {
    throw new Error('请先运行 setup，在浏览器中登录并逐个进入需要签到的课程。');
  }
  const browser = setup ? await openSetupBrowser() : await playwright().chromium.launch({
    channel: 'msedge', headless: !process.argv.includes('--visible'), chromiumSandbox: true,
  });
  const context = setup ? browser.contexts()[0] : await browser.newContext({ storageState: AUTH });
  try {
    if (setup) {
      let saving = Promise.resolve();
      let savePending = false;
      let savedLogin = false;
      const saveLogin = sourceUrl => {
        if (savePending) return;
        savePending = true;
        saving = (async () => {
          const check = await context.request.get(new URL(sourceUrl).origin + '/home/member/user', { timeout: 10000 });
          if (!check.ok() || String((await check.json()).code) !== '1') return;
          const state = siteState(await context.storageState({ indexedDB: true }));
          if (!state.cookies.length && !state.origins.length) return;
          fs.writeFileSync(AUTH, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
          if (!savedLogin) log('已验证登录，并保存可供下次运行使用的登录状态。');
          savedLogin = true;
        })().catch(() => {}).finally(() => { savePending = false; });
      };
      let finish;
      const closed = new Promise(resolve => { finish = resolve; browser.once('disconnected', resolve); });
      const remember = page => {
        page.once('close', () => { if (!context.pages().length) finish(); });
        page.on('framenavigated', frame => {
          if (frame !== page.mainFrame()) return;
          let url;
          try { url = courseUrl(frame.url()); } catch { return; }
          saveLogin(url);
          if (courses.some(saved => new URL(saved).hostname === new URL(url).hostname
              && new URL(saved).pathname === new URL(url).pathname)) return;
          courses.push(url);
          saveCourses(courses);
          log(`已保存课程 ${url}`);
        });
      };
      context.pages().forEach(remember);
      context.on('page', remember);
      context.on('response', response => {
        const url = new URL(response.url());
        if (HOSTS.includes(url.hostname) && url.pathname.startsWith('/home/')) saveLogin(response.url());
      });
      log('请在 Edge 中登录，逐个进入需要签到的课程；完成后关闭这个 Edge 窗口。');
      log('课程和登录状态在同一个窗口记录，请勿分享 .uooc-auth.json 或 .uooc-profile。');
      await closed;
      await saving;
      log(`配置完成，共 ${courses.length} 门课程；本次登录状态${savedLogin ? '已保存' : '未验证成功，请重新配置'}。`);
      if (!savedLogin || !courses.length) process.exitCode = 1;
    } else {
      let failures = 0;
      for (const url of courses) {
        const page = await context.newPage();
        try {
          const result = await visitCourse(page, url);
          const label = { signed: '今日签到成功', already: '今日已签到', complete: '签到次数已满' }[result.status];
          log(`${label}：${result.title}（${url}）`);
          saveCourses(courses, { [url]: result.title });
          fs.writeFileSync(AUTH, JSON.stringify(siteState(await context.storageState({ indexedDB: true }))), 'utf8');
        } catch (error) {
          failures++;
          log(`失败：${url}；${error.message}`);
        } finally { await page.close(); }
      }
      log(`运行完成：成功 ${courses.length - failures}，失败 ${failures}。签到次数以成绩页为准。`);
      if (failures) process.exitCode = 1;
    }
  } finally { await browser.close(); }
}

module.exports = { courseUrl, readCourses, visitCourse, signinResult, siteState, playwright };
if (require.main === module) main().catch(error => {
  log(`错误：${error.message}`);
  process.exitCode = 1;
});
