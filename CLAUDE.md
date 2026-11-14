# CLAUDE.md — LuatOS 烧录器

> 给接手这个仓库的开发者和 AI 助手看：记“为什么这样做”和踩过的坑。功能、编译、使用见 `README.md`。
> 界面文案中英双语（`t('中文', 'English')`），代码注释用中文。

## 是什么

LuatOS 模组的跨平台桌面工具（LuaTools 的替代品）：项目管理、Lua 编辑与语法检查、下载脚本 / 底层、设备日志、串口调试、MQTT 调试、固件资源。Tauri 2（Rust 后端）+ React 19 / Tailwind 4（前端），刷机等由 luatos-cli 完成。

## 架构决定

| 决定 | 原因 |
|---|---|
| Tauri 2（Rust 后端 + React/TS 前端） | Mac/Windows 一套代码、安装包小；Rust 与 luatos-cli 同语言 |
| 刷机、日志解码、量产、FOTA 交给 luatos-cli 附带程序（sidecar，`--format jsonl` 输出） | 它已实现 EC718 下载协议并内置 AgentBoot；Mac 上没有官方 LuaTools |
| 打包用的 luatos-cli 是 v1.11.0 源码 + `scripts/patches/` 补丁自己编译的（`pnpm build:cli`），版本和 commit 固定在 `scripts/build-luatos-cli.mjs` | 官方版有三个问题：① EC718 日志解码按标准 HDLC 还原 `7D XX`，但固件把 0x7D 转成 `7D 01`、0x7E 转成 `7D 02`，`}` 显示成 `!`；② 日志模块名和正文用制表符分隔时（老版本 EC618 固件）整行落进模块名；③ EC618 刷机用错 AgentBoot、CP 写错 flash。补丁按文件名序号依次打，都带单元测试。升级 luatos-cli 时先看上游是否已修：修了就删补丁、改回 `fetch:cli`（版本和 SHA-256 固定在 `scripts/fetch-luatos-cli.mjs`）；没修就把补丁迁到新版本 |
| 编译 luatos-cli 前从 GitHub 下载 `include_bytes!` 引用的 Git LFS 文件并按 SHA-256 核对（`build-luatos-cli.mjs` 第 3 步） | 仓库的 `*.bin` 在 LFS 里，没装 git-lfs 克隆到的是 130 字节的指针。拿指针编译出来的程序把它当 AgentBoot 下载给模组，模组跑飞，写引导区时报 “Broken pipe”（踩过）。补丁 03 另加了运行时检查：AgentBoot 小于 4 KB 或是 LFS 指针就在动设备前报错 |
| EC618 刷机（补丁 03）：AgentBoot 优先用 .soc 自带的 `agentboot_usb.bin`，没有就用内置的 FlashToolCLI ec618 版；BL/AP 写 AP flash 原始地址（0x4000 / 0x24000），CP 写 **CP flash 的 0 地址**，脚本按 flexfile 写 script_addr 原始地址；AgentBoot 波特率用固件包 ini 的 agbaud | 照固件包里的 `config_ec618_usb.ini`（LuaTools 调 FlashToolCLI 用的配置），CP 的写法与 yuzhan-tech/ectool 的 `plan.rs` 一致。ini 里的两份 RF 表（MergeRfTable → CP flash 0xE7000 / 0xCE000）不在 binpkg 里，没写，保留模组上原有的 |
| 语法检查用 mlua 内嵌 Lua 5.3 编译器 | 与 LuatOS 同版本，比前端启发式检查准确；前端 `lib/lua.ts` 只保留“未使用的局部变量”提示 |
| 固件列表直接解析合宙 CDN 目录页 | CDN 上有三种存放方式（每版本一个目录 / 直接放 .soc / 每版本一个 .zip）；zip 用 HTTP Range 只读中央目录就能列出里面的固件 |
| 项目底层按 型号 + 版本 + **固件文件名** 定位（`CoreRef.file`），不是数字编号 | EC618 的固件是 标准/FULL/TTS、Air6208 只有一个、Air780EP 是 `_1`，只有 EC718 有 101~124 号。只存了编号的旧项目用 `catalog.ts` 的 `coreFile()` 推出文件名 |
| 型号按芯片家族分组（`catalog.ts` 的 `MODELS` / `FAMILIES`），`canFlash()` 决定能不能刷 | 目前只支持 USB 直连的 EC718/EC618；其它家族在 `store.tsx` 的 `flashBlocked` 拦下 |
| 项目文件留在原处，只记路径（同 LuaTools） | 能直接打开现有的项目目录 |
| 下载时把脚本拷到暂存目录再交给 luatos-cli | LuaDB 脚本区是扁平的，文件名不能重复、最长 31 字符 |
| 设备日志由 store 统一管理 | 日志口（USB 接口 2）也是 luatos-cli 让模组重启进下载模式的命令口，下载前必须先停日志 |
| 日志行、暂停缓存、识别出的设备信息放在 `src/devlog.tsx` 的 `DevlogProvider`，设备日志页和日志面板 `LogDock`（下方 / 右侧停靠、悬浮窗）共用 | 在 MQTT / 串口调试页同屏看日志；两处各收一份会不同步 |
| 日志面板的开关和位置单独一个 context（`useLogDock()`），窗口外壳、状态栏、工具栏按钮用它，不用 `useDevlog()` | 订阅整个 devlog 时，每批日志（最快 60 ms 一次）都会让所有页面重渲染，代码页滚动会卡 |
| 代码编辑器 `LuaEditor`：滚动位置放 ref，scroll 事件里直接改行号/高亮/装饰/缩略图指示框的 transform；只渲染可见区上下各约 40 行（按 40 行一段，跨段才重渲染）；每行 `CodeLine` / `MiniLine` 按分词内容 memo；diags 按内容比较 | 原来每个 scroll 事件都 setState、整份文件全部重渲染：开发版实测 800 行约 196 ms 一次；改后平滑滚动约 0.5 ms 一次，打字约 21 ms 一个字符 |
| USB 日志静默 10 秒就静默重开（`cli.rs` 的 `spawn_silence_watch`，重开时不发 running 状态、不显示 luatos-cli 提示行） | 实测 EC718 日志口有时把日志攒在模组里不发，直到主机往口里写点东西（探测帧、甚至一个 `AT`）才吐出来；luatos-cli 只在打开时发一次探测帧。什么情况下进入这种状态还没查清 |
| 结束子进程用 `kill_child`（`spawn_blocking`） | tauri-plugin-shell 2.6 的 `CommandChild::kill` 发完信号会阻塞等进程退出，直接在异步任务里调用会卡住工作线程 |
| 日志会话带代号 `log_gen`，旧会话的读取任务结束时不发状态、不碰新会话的子进程 | 否则重开日志时旧任务会把新会话的子进程取走，留下占着端口的孤儿进程 |
| 重启模块期间持有 `port_busy`，打开日志要等它 | 日志口也是命令口；前端自动重开日志会抢口，重启指令报 “Device or resource busy” |
| 应用退出时杀掉日志进程（`lib.rs` 的 `RunEvent::Exit`） | sidecar 不随应用退出，残留的 luatos-cli 会一直占着日志口 |
| 浏览器演示模式（`?demo`，`src/lib/demo.ts`）：`api.ts` 的 `call` / `on` 在演示模式下转给假数据；`hasBackend` 表示“有后端可调” | 改界面不用接模组、不用编译 Rust；README 截图由 `scripts/screenshots.mjs` 用演示数据生成。新增后端命令时最好同时补一份假数据 |
| 应用名「LuatOS 烧录器」（`productName`），可执行文件 `luatos-flasher` | productName 带中文，Windows 打 MSI 时按 WiX 默认代码页会出错，所以 `bundle.windows.wix.language` 设成 zh-CN（未在 Windows 上验证）。`identifier` 决定应用数据目录（项目列表、固件缓存、本地设置），发布后不要再改 |
| 图标原创：紫色圆角方底 + USB 插头（插头上一道闪电）+ 下方 “LuatOS” 字样；字样是 `design/icon-gen/word.py` 用圆头线条画的，不依赖任何字体 | `python3 design/icon-gen/gen_g.py` 输出 `app-icon.svg` 和 `app-mark.svg` → `pnpm tauri icon app-icon.svg` 生成 `src-tauri/icons/`（顺带生成的 android/、ios/ 删掉）；界面里的 `AppMark` 用 `public/app-mark.svg`。不要使用合宙 / Luat 的标志图形 |
| UI 偏好、MQTT 连接、串口快捷指令存 localStorage；项目存后端 JSON | 前者只是偏好，后者要和磁盘文件一致 |

## 约定

- 新增后端命令：在 `src-tauri/src/*.rs` 写 `#[tauri::command]`，在 `lib.rs` 的 `generate_handler!` 登记，在 `src/lib/api.ts` 加类型和包装函数。前端不要直接 `invoke`。
- 后端错误统一返回中文字符串（`util::ErrStr::err_ctx`），前端直接放进 toast。
- 每次改完至少跑：`pnpm typecheck`、`node scripts/smoke-render.mjs`、`cd src-tauri && cargo test`。

## 现状

- 实机验证过（macOS）：Air780EHM（EC718）的下载脚本、下载底层和脚本（运行中的模组会被自动重启进下载模式）、USB 设备日志、重启模块、MQTT 收发；Air780EG（EC618）的下载底层和脚本。
- 没在实机上验证过：清除 fs/kv、量产 / FOTA；EC718 非 M 系列（EC718P/U 等，如 Air780EP）仍用 ec718m 的 AgentBoot，FlashToolCLI 的配置里它们用的是 ec718_products 那一份。
- 待做：CCM4211 / XT804 / BK7258 / UIS8910 的刷机和设备日志（要让用户选串口；日志模式 BK7258 是文本，其它是二进制，CCM4211 要 `--probe`）。
- 没在 Windows 上构建过。
- 「重启模块」走 `luatos-cli device reboot`，它只发一句 `AT+ECRST`；实测从发出到模组真正重启有时 7 秒，有时几分钟。要更可靠可以改发 `AT+ECRST=delay,799`（luatos-cli 进下载模式时用的写法），未验证。
- luatos-cli v1.11.0 在 macOS 上读不到 USB 接口号，会打印 `USB interface number unavailable, falling back to … (may be wrong port)`。它只用来判断是不是 EC718，探测帧发往 `--port` 指定的口，可以忽略。
- 设备信息面板（`devlog.tsx` 的 `sniff`）：固件取 `+FW: LuatOS V2056 112 64bit`；联网看 `IP_READY` / `+PDP: OK`；启动原因取 `pm poweron: Power/Reset`（中文对照表 `BOOT_TEXT`）；看到开机第一行 `main_entry` 就清掉上一轮的联网、信号、脚本、启动原因。
