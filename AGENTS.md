# ComfyUI 插件的固定规则

- 左侧栏必须移除 **Motions（角色动作库，`motion`）** 入口。以后升级、同步或重建上游编辑器时也必须保留此限制。
- **Camera moves（相机运镜，`cameraMotion`）** 保留；不要误删时间轴、关键帧或已有场景的动画数据。
- 此规则由 `scripts/build-editor.mjs` 的左侧栏适配强制执行。上游结构变化导致适配失败时，应修复适配，不能跳过检查或恢复 Motions。
- 更新完成后确认左侧栏无 Motions 入口，并保留 ComfyUI 的离线素材、场景保存和媒体导出功能。
