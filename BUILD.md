# 打包 & 发布流程

## 1. 更新版本号

修改 `package.json` 的 `version` 字段，例如 `"1.5.0"` → `"1.6.0"`

## 2. 打包

```powershell
# 先关掉正在运行的 NetPet
# 清理旧 dist（如果报"文件被占用"就重启电脑）
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue

# 设置国内镜像加速（每次新终端都要设）
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/

# 打包 zip 便携版
npm run dist
```

产物：`dist/NetPet-x.x.x-win.zip`（约 150MB）

## 3. 发布到 GitHub Release

### 方式一：网页上传

1. 打开 https://github.com/nanayadove/nanayapet/releases/new
2. Tag → 新建 `v1.5.0`（和 package.json 版本号对应）
3. Title → `v1.5.0 — 简短描述`
4. 正文贴更新内容
5. 上传 `dist/NetPet-1.5.0-win.zip`
6. 点 Publish

### 方式二：gh CLI（需先装 gh）

```bash
# Windows CMD
%LOCALAPPDATA%\gh-cli\bin\gh release create v1.5.0 dist/NetPet-1.5.0-win.zip --title "v1.5.0" --notes "更新内容"

# Git Bash / MINGW
"$LOCALAPPDATA/gh-cli/bin/gh" release create v1.5.0 dist/NetPet-1.5.0-win.zip --title "v1.5.0" --notes "更新内容"
```

## 4. 代码推送

```bash
git add .
git commit -m "v1.6.0: 简短描述"
git push
```

## 常见问题

| 问题 | 解决 |
|------|------|
| `dist/win-unpacked` 文件被占用 | 关掉 NetPet、关掉资源管理器中的 dist 窗口、或重启电脑 |
| `electron-v42.2.0-win32-x64.zip` 下载超时 | 设镜像 `set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| `winCodeSign` 报 `Cannot create symbolic link` | 删缓存 `rd /s /q %LOCALAPPDATA%\electron-builder\Cache\winCodeSign` |
| gh 不是内部命令 | 安装 https://cli.github.com 或用方式一手动上传 |
| zip 太大上传慢 | 正常，约 150MB，等几分钟 |

## 注意事项

- `config.json` 和 `memory.db` 不会打进包（已在 .gitignore）
- `config.example.json` 会进包，用户首次启动自动复制为 config.json
- 没有代码签名证书，Windows 会弹"未知发布者"警告——正常，点"仍要运行"即可
