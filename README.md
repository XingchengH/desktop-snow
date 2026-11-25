# Desktop Snow

桌面飘雪、窗沿积雪和鼠标玩雪。保留系统壁纸，观赏模式下雪景层可穿透点击。

## 下载

从 [GitHub Releases](https://github.com/XingchengH/desktop-snow/releases) 下载与你的系统匹配的测试包。

- Apple Silicon Mac 下载 `mac-arm64.zip`，Intel Mac 下载 `mac-x64.zip`。解压，把 Desktop Snow 拖到「应用程序」，再双击打开。
- Windows x64 下载 `windows-x64.exe`，双击启动便携版。

测试版尚未完成 Apple 公证或 Windows 代码签名，首次启动可能出现系统拦截。Finder 桌面文件积雪需要单独授权辅助功能。窗沿、小组件和 Dock 的基础积雪不需要这项授权。

在 Mac 上，打开菜单栏雪花菜单或 App 的「玩雪」菜单，选择「桌面图标积雪」查看当前权限状态、请求授权或打开辅助功能设置。升级后如果系统开关已开、App 仍显示需要授权，请移除旧条目，再添加当前的 Desktop Snow.app。

点击桌面雪花图标展开玩雪工具。图标默认在左下角，可拖到该屏幕内的其他位置，工具栏会随之移动。沿底部雪带推雪或滚雪球，把小雪球拖到大雪球上方叠起来，再点击雪人给它换装。再次点击雪花图标或点工具栏的关闭按钮可恢复观赏模式。

## 开发

运行 `npm ci` 和 `npm start`。在 macOS 开发模式下，窗口追踪需要 Swift 工具链。发行包包含编译好的追踪器。
