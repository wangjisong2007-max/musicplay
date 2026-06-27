# MusicPlay 粒子系统重建方案

**目标**：从零构建高质量音乐可视化粒子系统，5 种视觉形态，音频驱动，不依赖封面图片，性能友好。

**架构**：80×80 网格几何体（6400 粒子），单个 GLSL 顶点着色器负责所有形态切换和位置计算，双层渲染（NormalBlending 主层 + AdditiveBlending 辉光层），JS 侧只负责 FFT 分析和 uniform 推送。

---

## 设计决策

### 保留的 Mineradio 核心能力
| 能力 | 保留方式 |
|------|---------|
| 5 种视觉形态 | GLSL if-else 分支，uniform `uMode` |
| 音频三段 + 节拍 | JS 侧 FFT 分析 → smoothstep 推入 4 个 uniform |
| 双层渲染 | 同几何体，两个 ShaderMaterial，renderOrder 0/1 |
| rim 粒子边缘 | 片元着色器 rim = smoothstep(0.44, 0.94, d) * (1-smoothstep(0.94, 1.08, d)) |
| 暗色粒子保护 | vSourceLum < 0.115 的粒子跳过辉光 |
| 离散/扭曲 | uScatter（每个粒子随机方向位移）、uTwist（z 深度旋转） |
| 大小调制 | size = depthScale * audioBoost * uPointScale |
| 网格几何体 | GPU 端完成全部位置计算，JS 不做 per-frame buffer 更新 |

### 新增/替换
| 项目 | 方案 |
|------|------|
| 颜色系统 | 4 套内置调色板（从封面取色改为预设） |
| 深度 | 3D 噪声场替代 AI 深度分析 |
| 节拍 | JS 侧能量阈值检测替代 Mineradio 的复杂 onset 算法 |
| 鼠标 | 所有形态通用（替代仅 preset 0） |
| 空闲态 | 无音乐时慢速噪声场漂移（替代静态） |
| 过渡 | uMode 切换时 burstAmt 脉冲 + scatter 衰减 |

### 移除
- 封面取色/深度图（需 ML 模型和图片加载，太重）
- 涟漪系统（需封面交互，独立播放器无此场景）
- 手势遮挡/抓握（触屏专用，桌面不需要）
- 加载雾态（可后期加）

---

## 五种视觉形态

### Mode 0: 星球（默认）
球坐标散布 6400 粒子，Y 轴慢自转。bass 膨胀半径，treble 火焰噪点突起。最通用、最好看。

### Mode 1: 隧道
UV.y → 管道深度，bass 收缩半径，自旋滚动。无限循环。

### Mode 2: 波面
xy 平面，3 层不同频率 3D 噪声叠加做 z 位移。bass 低频大波，mid 中频纹理，treble 高频抖动。有空闲漂移。

### Mode 3: 星河
80% 粒子生成螺旋臂极光带（多频 band 噪声 + 旋转流），20% 深度感应微尘。多层深度 parallax。

### Mode 4: 虚空
粒子推到屏幕外，alpha=0。用于纯黑背景。

---

## 着色器设计

### 顶点着色器（~200 行）
```glsl
uniform float uTime, uMode;                    // 时间 + 形态选择
uniform float uBass, uMid, uTreble, uBeat;    // 音频
uniform float uScatter, uTwist, uIntensity;    // 效果
uniform float uPointScale, uSpeed;             // 控制
uniform vec2 uMouse;                           // 鼠标
uniform float uMouseActive, uBurstAmt;         // 交互
uniform vec3 uPalette[5];                      // 5 色调色板
uniform float uPaletteMix;                     // 调色板混合
attribute float aRand;                         // 每粒子随机种子
attribute vec2 aUv;                            // 网格 UV

void main() {
    float t = uTime * uSpeed;
    vec3 pos;
    vec3 col;
    float bright;
    
    if (uMode < 1.0) {
        // 星球 — 球坐标
    } else if (uMode < 2.0) {
        // 隧道
    } else if (uMode < 3.0) {
        // 波面
    } else if (uMode < 4.0) {
        // 星河
    } else {
        // 虚空
    }
    
    // 后处理: 离散、扭曲、鼠标、burst
    // 音频尺寸缩放
    // 投影
}
```

### 片元着色器（~40 行）
```glsl
uniform sampler2D uTex;
uniform float uAlpha, uBloomStrength;
varying vec3 vCol, vColBloom;
varying float vBright, vAlpha, vSourceLum;

void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    vec3 col = vCol * vBright;
    // rim 效果: 边缘变暗(亮粒子)/变亮(暗粒子)
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float rim = smoothstep(0.44, 0.94, d) * (1.0 - smoothstep(0.94, 1.08 ,d));
    float outLum = dot(col, vec3(0.299, 0.587, 0.114));
    float lightP = smoothstep(0.5, 0.82, outLum) * (1.0 - step(outLum, 0.2));
    col = mix(col, vec3(0.0), rim * lightP * 0.35);
    gl_FragColor = vec4(col, tex.a * uAlpha * vAlpha);
}
```

### 辉光片元着色器（~25 行）
与主层相同但用 AdditiveBlending，uBloomStrength 控制强度，暗色粒子跳过。

---

## 文件结构

```
public/particles-new.js   — 新粒子模块（~350 行）
public/index.html         — 替换旧粒子导入
```

### particles-new.js 输出 API
```js
export function createParticleSystem(scene, grid = 80)
// 返回: { uniforms, particles, bloomParticles, setMode(n), setPalette(i) }
```

---

## 实现计划

### 阶段 1：基础着色器 + 星球形态
1. 创建 `particles-new.js` — makeDotTexture / createUniforms / buildGeo
2. 实现星球形态顶点着色器（球坐标 + bass膨胀 + treble火焰 + Y轴自转）
3. 实现片元着色器（rim效果）
4. 实现辉光层
5. 写 index.html 粒子初始化 + 动画循环
6. 启动验证

### 阶段 2：其余形态
7. 隧道形态
8. 波面形态（3 层噪声叠加）
9. 星河形态（螺旋臂 + 微尘）
10. 虚空形态

### 阶段 3：交互 + 效果
11. 鼠标交互（所有形态通用推出）
12. 离散 + 扭曲滑块
13. 节拍脉冲（uBurstAmt）
14. 调色板系统（4 套预设 + 切换）
15. 空闲态噪声漂移

### 阶段 4：接入 MusicPlay
16. 视觉控制台（形态切换 + 调色板 + 滑块）
17. localStorage 持久化
18. 最终验证

---

## 性能预算
- 粒子数：6400（80×80）
- Draw calls：2（主层 + 辉光层）
- JS per-frame：FFT.getByteFrequencyData() + 4 次 smoothstep + uniform 推送
- 目标：60fps @ Intel UHD 620
