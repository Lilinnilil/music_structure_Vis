# Music Structure Visualization Project / 音乐结构可视化系统

## 简介 | Introduction

本项目是一个多视图交互式音乐结构可视化平台，支持 MIDI 乐曲的结构分析、节奏探索与可视化教学。系统集成了多种可视化模式，支持 MIDI/MP3 同步播放，适合音乐分析、教学与研究。

This project is a multi-view interactive music structure visualization platform for MIDI music, supporting structure analysis, rhythm exploration, and visualization-based teaching. It features multiple visualization modes and synchronized MIDI/MP3 playback, suitable for analysis, education, and research.

### 🚀 在线演示 | Live Demo

**无需配置本地环境，直接访问：**  
**[https://musicvis.zdev.in](https://musicvis.zdev.in)**

**Access directly without local setup:**  
**[https://musicvis.zdev.in](https://musicvis.zdev.in)**

---

## 功能亮点 | Features

- **多视图联动**：支持乐曲全局分布、动态能量流、重复动机、细节钢琴卷帘等多种可视化模式
- **音画同步**：支持 MIDI 分析各视图变化与音乐播放同步，节奏轮与乐曲结构实时联动
- **丰富的交互**：可切换视图、拖拽调整布局、点击切换曲目、参数调节等
- **数据流**：数据自动发现与处理，支持批量曲目管理

- **Multi-view Coordination**: Supports global distribution, dynamic energy flow, repeating motifs, and detailed piano rolls.
- **Audio-Visual Sync**: Synchronized MIDI/MP3 playback with real-time rhythm wheel linkage.
- **Rich Interaction**: View switching, draggable layout, track selection, and parameter tuning.
- **Automated Pipeline**: Automatic data discovery and processing with batch management.

## 目录结构 | Directory Structure

```
music/
│
├─ src/                  # 前端源码 | Frontend source code
│   ├─ index.html        # 主网页入口 Main HTML entry
│   ├─ main.js           # 前端主控逻辑 Main controller
│   ├─ config.js         # 全局配置参数 Global config
│   ├─ style.css         # 样式表 Stylesheet
│   ├─ views/            # 各视图组件 View modules
│   │   ├─ viewA.js      # 全局曲目分布视图（散点图） Global track scatter view
│   │   ├─ viewB.js      # 动态能量流视图（河流图） Dynamics stream view
│   │   ├─ viewC.js      # 重复动机/织体结构视图（弧形图） Motif/texture arc view
│   │   └─ viewD.js      # 细节钢琴卷帘/节奏分析视图 Details & rhythm view
│   └─ assets/           # 前端用图片/图标等 Assets (images/icons)
│
├─ public/               # 静态资源 Static assets
│   └─ mp3/              # MP3音频文件 MP3 files
│
├─ data/                 # 数据与中间结果 Data & processed results
│   ├─ midi/             # 原始MIDI文件 MIDI files
│   ├─ processed/        # 处理后csv/json数据 Processed data
│   └─ manifest.json     # 曲目索引 Track manifest
│
├─ scripts/              # 预处理与数据生成脚本 Preprocessing & data scripts
│   ├─ midi_to_csv_clean.py
│   └─ function_analysis.py
│
├─ README.md
└─ package.json / config / 文档等
```

## 数据说明 | Data Preparation

项目已内置丰富的 MIDI、MP3 及中间数据。如需添加新曲目，请遵循以下流程：

1. 将 `.mid` 文件放入 `data/midi/`
2. 将对应音频放入 `public/mp3/`
3. 运行 `scripts/midi_to_csv_clean.py` 和 `scripts/process_viewC.py` 生成 csv/json
4. 更新 `data/manifest.json` 以纳入新曲目

The project includes sample MIDI, MP3, and processed data. To add new tracks:

1. Put `.mid` files into `data/midi/`
2. Put audio into `public/mp3/`
3. Run `scripts/midi_to_csv_clean.py` and `scripts/process_viewC.py` to generate csv/json
4. Update `data/manifest.json` to include new tracks

## 使用方法 | Usage

### 方式一：在线访问 (推荐)

直接访问：[https://musicvis.zdev.in](https://musicvis.zdev.in)

### 方式二：本地运行

1. 本地启动支持静态 Web 服务（如 VSCode Live Server, Python `http.server` 等）
2. 浏览器访问 `index.html`，即可交互体验多视图可视化
3. 点击左侧曲目列表切换不同乐曲进行分析
4. 可通过拖拽分隔条自定义各视图布局

**Method 1: Online Access (Recommended)**
Visit: [https://musicvis.zdev.in](https://musicvis.zdev.in)

**Method 2: Local Execution**

1. Start a static web server locally (e.g., VSCode Live Server, Python http.server)
2. Open `index.html` in your browser to interact with the visualizations
3. Click tracks on the left to switch and analyze different music pieces
4. Drag the split bars to customize the layout

### ⚠️ 性能优化与注意事项 | Performance Tips

**如果遇到播放卡顿或掉帧 (Lag / Stuttering)：**
请尝试**拖动左侧面板的分隔条**（View A），调整其宽度，直到左侧列表的**滚动条消失**。这通常能显著提升渲染性能。

**If you experience display lag or stuttering:**
Please try **dragging the resize handle of the left panel** (View A) to adjust its width until the **scrollbar disappears**. This usually improves rendering performance significantly.

## 可视化视图说明 | Visualization Views

- **View A（左侧）**：全曲目分布散点图，展示各曲目风格、复杂度等全局特征
- **View B（右上）**：动态能量流（河流图），展示各乐器组的能量随时间变化
- **View C（右中）**：重复动机/织体结构（弧形图），揭示乐曲中的重复片段与结构
- **View D（右下）**：细节钢琴卷帘/节奏分析/旋律线，支持多种显示模式与节奏轮

- **View A (Left Side)**: Scatterplot showing the overall distribution of the entire piece, displaying the style, complexity, and other global characteristics.
- **View B (Top Right)**: Dynamic energy flow (streamgraph), showing how the energy of each instrument group changes over time.
- **View C (Middle Right)**: Repeated motifs/texture (arc diagram), revealing the repetitive segments and structures in the music.
- **View D (Bottom Right)**: Detailed piano roll/rhythm analysis/melodic line, supporting multiple display modes and rhythm wheel.

## 贡献与协作 | Contribution & Collaboration

- 所有主要 JS、样式、HTML 均纳入版本控制，欢迎直接修改
- 新增可视化建议新建 `viewX.js`，保持结构清晰
- 修改前建议先同步（pull），避免冲突
- 有问题可通过 issue 或 PR 反馈

All main JS, CSS, and HTML files are versioned. Feel free to modify or add new views (suggested: `viewX.js`). Please pull before editing to avoid conflicts. Issues and PRs are welcome.

---

项目适合音乐信息检索、可视化教学、结构分析等多场景。欢迎交流与扩展！

This project is suitable for MIR, visualization teaching, and structure analysis. Contributions and discussions are welcome!
