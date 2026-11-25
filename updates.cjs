const { createHash } = require('node:crypto');
const { createWriteStream, promises: fs } = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'XingchengH/desktop-snow';
const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/;
const releaseApi = `https://api.github.com/repos/${repository}/releases?per_page=20`;

function compareVersions(left, right) {
  const a = left.match(versionPattern).slice(1).map(Number);
  const b = right.match(versionPattern).slice(1).map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function selectUpdate(releases, current, platform, arch) {
  const target = platform === 'darwin' && ['arm64', 'x64'].includes(arch)
    ? `mac-${arch}.zip` : platform === 'win32' && arch === 'x64' ? 'windows-x64.exe' : null;
  if (!target || !versionPattern.test(current)) return null;
  for (const release of releases.filter(entry => !entry.draft && versionPattern.test(entry.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))) {
    if (compareVersions(release.tag_name, current) <= 0) break;
    const version = release.tag_name.replace(/^v/, '');
    const name = `Desktop-Snow-${version}-${target}`;
    const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
    const asset = release.assets?.find(file => file.name === name && file.browser_download_url === url &&
      /^sha256:[a-f0-9]{64}$/i.test(file.digest ?? '') &&
      Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 512 * 1024 * 1024);
    if (asset) return { version, name, url, size: asset.size, digest: asset.digest.slice(7).toLowerCase() };
  }
  return null;
}

async function downloadUpdate(fetch, update, downloads) {
  const folder = await fs.mkdtemp(path.join(downloads, `Desktop Snow ${update.version}-`));
  const target = path.join(folder, update.name);
  const partial = `${target}.partial`;
  const hash = createHash('sha256');
  let size = 0;
  try {
    const response = await fetch(update.url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw Error(`下载失败（HTTP ${response.status}）`);
    const verify = new Transform({
      transform(chunk, _, done) {
        size += chunk.length;
        if (size > update.size) return done(Error('下载文件超过发布包的大小'));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), verify, createWriteStream(partial, { flags: 'wx' }));
    if (size !== update.size || hash.digest('hex') !== update.digest) throw Error('下载包校验失败');
    await fs.rename(partial, target);
    return target;
  } catch (error) {
    await fs.unlink(partial).catch(() => {});
    await fs.rmdir(folder).catch(() => {});
    throw error;
  }
}

function createUpdateChecker({ app, dialog, net, shell }) {
  let running = false;
  return async function check() {
    if (running) return;
    running = true;
    try {
      const current = app.getVersion();
      const response = await net.fetch(releaseApi, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw Error(`GitHub 返回 HTTP ${response.status}`);
      const update = selectUpdate(await response.json(), current, process.platform, process.arch);
      if (!update) {
        await dialog.showMessageBox({ type: 'info', message: '没有找到适用于此设备的更新', detail: `当前版本：${current}` });
        return;
      }
      const { response: choice } = await dialog.showMessageBox({
        type: 'info', message: `Desktop Snow ${update.version} 可下载`,
        detail: `当前版本：${current}。下载后会显示经过校验的发布包。`,
        buttons: ['下载更新', '稍后'], defaultId: 0, cancelId: 1,
      });
      if (choice !== 0) return;
      const file = await downloadUpdate(net.fetch.bind(net), update, app.getPath('downloads'));
      shell.showItemInFolder(file);
      await dialog.showMessageBox({
        type: 'info', message: '更新已下载并校验',
        detail: process.platform === 'darwin'
          ? '退出当前版本，解压后用新版 Desktop Snow 替换「应用程序」里的旧版。'
          : '退出当前版本，再双击下载的新版便携程序。',
      });
    } catch (error) {
      await dialog.showMessageBox({ type: 'error', message: '无法完成更新', detail: error.message });
    } finally {
      running = false;
    }
  };
}

module.exports = { createUpdateChecker, selectUpdate, downloadUpdate };
