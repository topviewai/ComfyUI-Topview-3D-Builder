<p align="center">
  <img src="docs/images/icon.png" alt="Topview 3D Builder" width="150" height="150">
</p>

<h1 align="center">Topview 3D Builder for ComfyUI</h1>

[English](README.md) · **简体中文**

通过顶部 **使用 AI Agent** 打开引导卡片，查看 [Topview 3D Builder 仓库](https://github.com/topviewai/topview-3d-builder) 并复制安装指令。插件已移除内置聊天和 API Key 设置，详见 [Agent 使用指南](docs/AGENT.md)。

该项目基于我们的另一个项目 [Topview 3D Builder](https://github.com/topviewai/topview-3d-builder) 开发，支持接入任意 Agent 工具，生成 3D 场景动画。

在 ComfyUI 中搭建 3D 场景、调整机位，并将图片或白模动画视频直接导出到画布，再使用视频模型渲染为真实视频。

支持 3D 场景搭建、角色与物体摆放、角色姿势调节、相机运镜、时间轴和关键帧动画。

节点外部提供与内部导出同步的参数表单，以及 **image / video** 两个可连接输出。选择「图片」时 VIDEO 分支停用，选择「视频」时 IMAGE 分支停用。保存场景后运行工作流即可自动渲染；运行时需保持浏览器打开。可导入 [双输出示例](examples/topview-image-video.json) 验证连接方式。更新后重启 ComfyUI 并刷新浏览器。

## 安装和更新

**方法一：Git 安装（推荐）**

在 `ComfyUI/custom_nodes` 目录打开终端，执行：

```sh
git clone https://github.com/gyx85542-dot/ComfyUI-Topview-3D-Builder.git
```

**方法二：下载 ZIP**

点击仓库页面的 **Code → Download ZIP**，将插件文件夹解压到 `ComfyUI/custom_nodes`。确认 `__init__.py` 直接位于插件文件夹内，不要多嵌套一层目录。目录结构如下：

```text
ComfyUI/
└── custom_nodes/
    └── ComfyUI-Topview-3D-Builder/
        ├── __init__.py
        ├── backend.py
        ├── assets/
        ├── editor/
        └── web/
```

安装后重启 ComfyUI 并刷新浏览器。

### 更新

通过 Git 安装的用户，在 `ComfyUI/custom_nodes` 目录打开终端，依次执行以下命令，进入插件目录并拉取最新版本：

```sh
cd ComfyUI-Topview-3D-Builder
git pull --ff-only origin main
```

## 功能介绍

内置编辑器已同步到 **@topview/3d-builder 1.0.15**，包含时间轴分组编辑、场景灯光控制、路径绑定修复及成片剪辑界面。后续同步方法见[上游更新说明](docs/UPSTREAM.md)。

- **3D 场景搭建**：放置角色与物体，调整姿势、位置和构图。
- **内置素材**：4 个角色、121 个静态姿势、5 种基础几何体、15 个机位选项（含当前视角）、24 个运镜预设。
- **机位与运镜**：设置相机角度、预览镜头，使用运镜预设和时间轴编排动画。
- **图片与视频导出**：选择机位、帧范围、分辨率和画幅，下载到本地或直接导出到 ComfyUI 画布。
- **多语言**：跟随 ComfyUI 语言设置，支持 15 种语言。

![Topview 3D Builder 场景编辑器](docs/images/editor.png)

### 使用流程

1. 从节点菜单 **Topview → Topview 3D Builder** 添加节点，或搜索 **Topview 3D Builder**。

   https://github.com/user-attachments/assets/0a73724f-d75e-4f62-acef-ac1c4d1b27bd

2. 点击 **打开 3D Builder**，添加角色与物体、调整姿势、设置相机，并添加时间轴动画。

   https://github.com/user-attachments/assets/0b66c435-75dd-4bd6-8efe-86ca57b2cd6e

3. 点击中间的 **导出**，选择图片或视频，并设置输出参数。

   https://github.com/user-attachments/assets/724a4556-249e-46e8-bf8a-daa5b9f1234d

4. 点击 **导出到 ComfyUI 画布**。导出和保存成功后，浮窗自动关闭，画布中出现对应的原生媒体节点。
5. 如只需保存场景，点击 **保存并退出**，即可更新 Builder 节点预览并关闭浮窗。
6. **保存 ComfyUI 工作流**，以保留可编辑场景。编辑器里的保存不会代替工作流文件保存。

## 效果示例

<table>
  <tr>
    <th width="50%" align="center">3D 场景<br><sub>由 3D Builder 创建</sub></th>
    <th width="50%" align="center">生成视频<br><sub>由 Topview.ai 渲染</sub></th>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/26108771-b47f-4e14-ac65-605329030369" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/78aaa908-a3bf-4d4e-a0a3-172aa460c76d" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/623c3610-0eb1-4f66-a1bf-ef1b28a2e360" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/aca8255e-e22c-4e47-b55a-4cf614d067a2" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/a6e689bb-d059-4eec-a06c-94db098796b9" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/8e25b621-e1cd-47cf-ada1-a960163b0e86" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/fd32e367-c9a6-4111-bd8f-bae8b0a7d568" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/71559885-aea2-40f3-b824-de0cd7ec06cf" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/bc00daca-e8e6-469b-a3a2-cf34b6395826" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/955dae4e-dc87-4448-9f4d-219789dc441f" width="100%" controls muted playsinline></video></td>
  </tr>
</table>

<details>
<summary>更多示例</summary>

<table>
  <tr>
    <th width="50%" align="center">3D 场景<br><sub>由 3D Builder 创建</sub></th>
    <th width="50%" align="center">生成视频<br><sub>由 Topview.ai 渲染</sub></th>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/a8d96386-3908-43c7-bf44-42256995714b" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/53dc49f2-5e3a-4519-9af7-cd152ad3aaf4" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/04bb3fa8-98fa-40bf-89f3-8caeb621958d" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/6d5feedb-e532-4840-b25d-2776f934d512" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/32e485e7-7a25-4036-bce3-afb634669c1c" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/d6076569-dc82-44e1-97ac-df7a57cdcfd8" width="100%" controls muted playsinline></video></td>
  </tr>
  <tr>
    <td align="center"><video src="https://github.com/user-attachments/assets/8ad22506-637f-483f-a37c-ff6ebcc494fc" width="100%" controls muted playsinline></video></td>
    <td align="center"><video src="https://github.com/user-attachments/assets/23ba9945-f92f-470e-895b-2d5638ada379" width="100%" controls muted playsinline></video></td>
  </tr>
</table>

</details>

## 教学

[3D Builder 教学：搭建场景、编排动作与运镜](https://www.topview.ai/academy/spatial-control#3-1-3d-builder-build-scenes-stage-action-and-move-the-camera)

## 许可证

- 代码：[Apache-2.0](LICENSE)、[NOTICE](NOTICE)。
- 内置素材：[assets/LICENSE](assets/LICENSE)、[assets/NOTICE](assets/NOTICE)。
- 字体：[Darker Grotesque OFL](licenses/OFL.txt)、[Instrument Sans OFL](licenses/OFL-instrument-sans.txt)。
- 前端依赖：[JavaScript 声明](editor/main.js.LEGAL.txt)、[CSS 声明](editor/main.css.LEGAL.txt)。

---

支持我们的另一个项目：[Topview 3D Builder](https://github.com/topviewai/topview-3d-builder)，支持通过 Agent 创建 3D 场景。
