/**
 * View C: Repeating Motifs / Texture Visualization
 * ------------------------------------------------
 * 该模块负责渲染音乐的重复结构视图（弧形图）。
 * * 主要功能：
 * 1. 两种模式切换：
 * - Macro (Texture): 基于声学特征（Chroma）的宏观织体重复。
 * - Melodic: 基于音符序列的微观旋律重复。
 * 2. 交互式筛选：
 * - Duration (Dur): 过滤最短时长。
 * - Count (Cnt): 限制显示的弧形数量（动态计算最大值）。
 * 3. 视觉呈现：
 * - 弧形连接重复段落 (Source -> Target)。
 * - 智能分组 (Chaining): 自动关联 A->B->C 的连续重复链条。
 * - 动态高亮：支持鼠标悬浮和播放进度自动高亮。
 * * 依赖库: D3.js
 */

(function() {
    // =========================================================================
    // 1. 模块级变量定义
    // =========================================================================
    let svg, container, width, height;
    let xScale, yScale, colorScale;
    let arcGroup, pianoGroup, highlightGroup, playhead;

    // --- 核心状态变量 ---
    // 当前视图模式: 'macro' (默认) 或 'melodic'
    let currentMode = 'macro';

    // 交互状态锁: 当用户鼠标悬浮时为 true，此时暂停播放进度的自动高亮，避免冲突
    let isUserHovering = false;

    // 颜色缓存: 用于存储弧形的原始颜色，以便在鼠标移出/高亮结束后恢复
    const originalColors = new Map();

    // 数据缓存
    let cachedNotes = [];
    let cachedArcsMelodic = [];
    let cachedArcsMacro = [];
    let isDataLoaded = false;

    // 布局常量
    let pianoHeight = 150;
    const MIN_PIXELS_PER_SECOND = 8;

    // --- 筛选控制变量 ---
    let filterMinDuration = 2.0;
    let filterMaxDuration = 9999; // 保留用于过滤，但UI中只显示最小duration
    let filterTopN = 0; // 初始化为 0，后续由 updateSliderLimits 根据数据动态接管

    // =========================================================================
    // 2. 配色方案
    // =========================================================================

    // 微观/旋律模式：鲜艳、高对比度色板
    const MELODIC_PALETTE = [
        "#C0392B", "#D35400", "#B7950B", "#27AE60", "#2980B9", "#8E44AD"
    ];

    // 宏观/织体模式：低饱和度、莫兰迪色系色板
    const MACRO_PALETTE = [
        "#607D8B", "#7986CB", "#81C784", "#A1887F", "#90A4AE", "#9575CD"
    ];

    // 获取当前模式对应的色盘
    const getCurrentPalette = () => currentMode === 'macro' ? MACRO_PALETTE : MELODIC_PALETTE;

    // =========================================================================
    // 3. 辅助计算函数
    // =========================================================================

    // 弧形排序：按面积（跨度 * 时长）倒序排列，确保小弧形在顶层
    const sortArcsByArea = (a, b) => {
        const areaA = a.span * a.duration;
        const areaB = b.span * b.duration;
        return areaB - areaA;
    };

    // 重要性评分计算
    const calculateScore = (d) => d.duration * Math.sqrt(d.span);

    // 判断是否为打击乐轨道
    function isPercussionTrack(trackName) {
        if (!trackName) return false;
        const t = trackName.toLowerCase();
        const keywords = [
            'drum', 'percussion', 'tinkle bell', 'agogo',
            'steel drums', 'woodblock', 'taiko drum',
            'melodic tom', 'synth drum', 'reverse cymbal', 'kit'
        ];
        return keywords.some(kw => t.includes(kw));
    }

    // 颜色提亮工具函数
    function lightenColor(color, amount = 1.5) {
        const c = d3.color(color);
        if (c) {
            c.opacity = 1;
            return c.brighter(amount).toString();
        }
        return color;
    }

    // =========================================================================
    // 4. 样式注入
    // =========================================================================
    function injectStyles() {
        const styleId = "view-c-rainbow-styles";
        if (document.getElementById(styleId)) return;

        const css = `
            #view-C-container { position: relative !important; overflow: hidden !important; width: 100%; max-width: 100%; }
            #view-C-dataviz {
                position: relative !important; width: 100%; max-width: 100%; height: 100%;
                background: #000; display: block;
                overflow-x: hidden !important; overflow-y: hidden;
            }
            #view-C-dataviz svg { width: 100% !important; height: 100%; display: block; overflow: visible; }
            #view-C-dataviz::-webkit-scrollbar { height: 8px; background-color: #1a1a1a; }
            #view-C-dataviz::-webkit-scrollbar-thumb { background-color: #555; border-radius: 4px; }
            #view-C-dataviz::-webkit-scrollbar-thumb:hover { background-color: #888; }

            .view-c-controls-horiz {
                position: absolute; top: 6px; right: 15px; z-index: 99999;
                display: flex; align-items: center; gap: 6px;
                pointer-events: auto; background: rgba(0, 0, 0, 0.4); 
                padding: 2px 4px; border-radius: 4px;
                backdrop-filter: blur(2px); font-family: 'Segoe UI', sans-serif; height: 20px;
            }

            .vc-btn-group { display: flex; gap: 1px; height: 16px; }
            .vc-btn {
                background: rgba(60, 60, 60, 0.8); border: 1px solid #555;
                color: #aaa; font-size: 9px; font-weight: 600;
                padding: 0 6px; display: flex; align-items: center; justify-content: center;
                border-radius: 2px; cursor: pointer; transition: all 0.2s;
                user-select: none; line-height: 1;
            }
            .vc-btn:hover { background: #666; color: #fff; }
            .vc-btn.active { background: #FFD700; color: #000; border-color: #FFD700; font-weight: 700; }

            .vc-slider-container {
                display: flex; align-items: center; gap: 3px;
                height: 16px; padding-left: 4px; border-left: 1px solid rgba(255,255,255,0.1); 
            }
            .vc-label-text { font-size: 9px; color: #888; white-space: nowrap; line-height: 16px; }
            .vc-val-text { font-size: 9px; color: #FFD700; min-width: 20px; text-align: right; font-variant-numeric: tabular-nums; line-height: 16px; }
            .vc-slider {
                -webkit-appearance: none; width: 50px; height: 2px;
                background: #444; border-radius: 1px; outline: none; margin: 0;
            }
            .vc-slider::-webkit-slider-thumb {
                -webkit-appearance: none; width: 6px; height: 6px;
                border-radius: 50%; background: #aaa; cursor: pointer; border: 1px solid #000;
            }
            .vc-slider:hover::-webkit-slider-thumb { background: #FFD700; transform: scale(1.2); }

            .c-highlight-rect {
                fill: #d62728; opacity: 0.4; stroke: 1px solid #ffaaaa; pointer-events: none;
            }
            .c-tooltip {
                position: absolute; display: none;
                background: rgba(255, 255, 255, 0.95); color: #000;
                border: 1px solid #000; padding: 4px 8px; font-size: 11px;
                border-radius: 2px; pointer-events: none; z-index: 10000;
                box-shadow: 2px 2px 5px rgba(0,0,0,0.5);
            }
            .c-note { shape-rendering: crispEdges; }

            /* 双端滑块：两根重叠的 range，共享同一轨道 */
            .vc-range-dual { display: flex; align-items: center; gap: 4px; }
            .vc-range-dual .track {
                position: relative; width: 90px; height: 6px; margin: 0 2px;
                background: #444; border-radius: 3px;
            }
            .vc-range-dual input[type=range] {
                position: absolute; left: 0; top: -6px; width: 90px;
                -webkit-appearance: none; background: transparent; pointer-events: none;
            }
            .vc-range-dual input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none; width: 10px; height: 10px; border-radius: 50%;
                background: #FFD700; border: 1px solid #000; pointer-events: auto; cursor: pointer;
            }
            .vc-range-dual input[type=range]::-webkit-slider-runnable-track {
                -webkit-appearance: none; height: 6px; background: transparent;
            }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // =========================================================================
    // 5. UI 构建 (按钮与滑块)
    // =========================================================================
    function setupUI(containerSelector) {
        const vizContainer = d3.select(containerSelector);
        const mainBox = d3.select(vizContainer.node().parentNode);

        // 清理旧控件，防止重复渲染
        mainBox.selectAll(".view-c-controls-horiz").remove();

        const panel = mainBox.append("div").attr("class", "view-c-controls-horiz");

        // --- 1. 模式切换按钮组 ---
        const btnGroup = panel.append("div").attr("class", "vc-btn-group");

        const btnMacro = btnGroup.append("div")
            .attr("class", `vc-btn ${currentMode === 'macro' ? 'active' : ''}`)
            .attr("data-mode", "macro").text("Texture");

        const btnMicro = btnGroup.append("div")
            .attr("class", `vc-btn ${currentMode === 'melodic' ? 'active' : ''}`)
            .attr("data-mode", "melodic").text("Melodic");

        // 模式切换处理逻辑
        const handleModeSwitch = (mode) => {
            if (currentMode === mode) return;
            currentMode = mode;
            updateButtons(panel);
            // 切换模式时，重新计算该模式下的滑块上限并重置
            updateSliderLimits();
            renderArcs();
        };

        btnMacro.on("click", (e) => { e.stopPropagation(); handleModeSwitch('macro'); });
        btnMicro.on("click", (e) => { e.stopPropagation(); handleModeSwitch('melodic'); });

        // --- 2. Duration 双滑块（样式与Cnt统一） ---
        const durContainer = panel.append("div").attr("class", "vc-slider-container");
        durContainer.append("span").attr("class", "vc-label-text").text("Dur");

        const durSlider = durContainer.append("input")
            .attr("type", "range")
            .attr("class", "vc-slider vc-slider-dur")
            .attr("min", "0.5")
            .attr("max", "10")
            .attr("step", "0.5")
            .attr("value", filterMinDuration)
            .on("input", function() {
                let v = parseFloat(this.value);
                if (v > filterMaxDuration) v = filterMaxDuration;
                filterMinDuration = v;
                this.value = v;
                durVal.text(`${filterMinDuration.toFixed(1)}-${filterMaxDuration.toFixed(1)}`);
                renderArcs();
            });

        const durMaxSlider = durContainer.append("input")
            .attr("type", "range")
            .attr("class", "vc-slider vc-slider-dur-max")
            .attr("min", "0.5")
            .attr("max", "10")
            .attr("step", "0.5")
            .attr("value", filterMaxDuration)
            .on("input", function() {
                let v = parseFloat(this.value);
                if (v < filterMinDuration) v = filterMinDuration;
                filterMaxDuration = v;
                this.value = v;
                durVal.text(`${filterMinDuration.toFixed(1)}-${filterMaxDuration.toFixed(1)}`);
                renderArcs();
            });

        const durVal = durContainer.append("span")
            .attr("class", "vc-val-text vc-val-dur")
            .text(`${filterMinDuration.toFixed(1)}-${filterMaxDuration.toFixed(1)}`);

        // --- 3. Count (数量) 滑块 ---
        const countContainer = panel.append("div").attr("class", "vc-slider-container");
        countContainer.append("span").attr("class", "vc-label-text").text("Cnt");

        const cntSlider = countContainer.append("input")
            .attr("type", "range")
            .attr("class", "vc-slider vc-slider-cnt") // 添加特定类名以便后续动态更新
            .attr("min", "5")
            .attr("max", "100") // 初始占位值
            .attr("step", "1")
            .attr("value", filterTopN)
            .on("input", function() {
                filterTopN = parseInt(this.value);
                countVal.text(filterTopN);
                renderArcs();
            });

        const countVal = countContainer.append("span")
            .attr("class", "vc-val-text vc-val-cnt")
            .text(filterTopN);

        // 确保 Tooltip 元素存在
        if (d3.select("body").select("#c-tooltip").empty()) {
             d3.select("body").append("div").attr("class", "c-tooltip").attr("id", "c-tooltip");
        }
    }

    // --- 动态更新滑块限制 (Max/Value) ---
    function updateSliderLimits() {
        const panel = d3.select(".view-c-controls-horiz");
        if (panel.empty()) return;

        // 1. 获取当前模式的数据
        const data = currentMode === 'macro' ? cachedArcsMacro : cachedArcsMelodic;

        // 2. 预筛选有效数据 (仅应用基础 span 过滤)
        // 目的：计算该曲目在当前模式下的理论最大数据量
        const validData = data.filter(d => d.span >= 0.5);

        const totalCount = validData.length;
        const maxDur = d3.max(validData, d => d.duration) || 5;

        // --- 更新 Duration 滑块 ---
        const newDurMax = Math.max(5, Math.ceil(maxDur));
        const durSlider = panel.select(".vc-slider-dur");
        const durMaxSlider = panel.select(".vc-slider-dur-max");
        durSlider.attr("max", newDurMax);
        durMaxSlider.attr("max", newDurMax);

        // 调整现有值，确保 min <= max 且不超上限
        filterMinDuration = Math.min(filterMinDuration, newDurMax);
        filterMaxDuration = Math.min(filterMaxDuration, newDurMax);
        if (filterMinDuration > filterMaxDuration) {
            filterMinDuration = filterMaxDuration;
        }
        durSlider.property("value", filterMinDuration);
        durMaxSlider.property("value", filterMaxDuration);
        panel.select(".vc-val-dur").text(`${filterMinDuration.toFixed(1)}-${filterMaxDuration.toFixed(1)}`);

        // --- 更新 Count 滑块 ---
        const newCntMax = Math.max(5, totalCount);
        const cntSlider = panel.select(".vc-slider-cnt");
        const cntValText = panel.select(".vc-val-cnt");

        // 更新滑块属性
        cntSlider.attr("min", 5);
        cntSlider.attr("step", 1);
        cntSlider.attr("max", newCntMax);

        // 默认行为：重置 filterTopN 为全选 (最大值)
        filterTopN = newCntMax;
        cntSlider.property("value", newCntMax);
        cntValText.text(newCntMax);
    }

    function updateButtons(container) {
        container.selectAll(".vc-btn").classed("active", false);
        container.select(`.vc-btn[data-mode="${currentMode}"]`).classed("active", true);
    }

    // =========================================================================
    // 6. 绘图主函数
    // =========================================================================
    async function drawViewC(notes, maxTime, containerSelector) {
        injectStyles();
        container = d3.select(containerSelector);
        if (container.empty()) return;

        cachedNotes = notes;

        // 1. 加载数据
        await loadArcData();

        // 2. 初始化 UI
        setupUI(containerSelector);

        // 3. 根据加载的数据初始化滑块限制
        updateSliderLimits();

        // --- 绘图环境准备 ---
        const rect = container.node().getBoundingClientRect();
        const clientW = rect.width || 800;
        const fullH = rect.height || 250;
        const minRequiredWidth = maxTime * MIN_PIXELS_PER_SECOND;
        const totalWidth = Math.max(clientW, minRequiredWidth);
        const margin = { top: 15, right: 10, bottom: 5, left: 70 };
        width = totalWidth - margin.left - margin.right;
        height = fullH - margin.top - margin.bottom;
        const splitRatio = 0.40;
        const splitY = height * splitRatio;
        const arcHeight = splitY;
        pianoHeight = height - splitY;

        container.select("svg").remove();
        svg = container.append("svg")
            .attr("width", "100%").attr("height", fullH)
            .attr("viewBox", `0 0 ${totalWidth} ${fullH}`)
            .attr("preserveAspectRatio", "none") // 宽度自适应，允许高度保持像素高度
            .style("position", "absolute").style("top", 0).style("left", 0).style("z-index", 1);

        const defs = svg.append("defs");
        defs.append("clipPath").attr("id", "clip-view-c")
            .append("rect").attr("x", -10).attr("y", -arcHeight - 20)
            .attr("width", width + 20).attr("height", height + 40);

        // 播放头渐变
        const playheadGradient = defs.append("linearGradient")
            .attr("id", "playheadGradientC")
            .attr("x1", "0%").attr("y1", "0%").attr("x2", "0%").attr("y2", "100%");
        playheadGradient.append("stop").attr("offset", "0%").attr("stop-color", "#FFD700").attr("stop-opacity", 0);
        playheadGradient.append("stop").attr("offset", "50%").attr("stop-color", "#FFFFFF").attr("stop-opacity", 1);
        playheadGradient.append("stop").attr("offset", "100%").attr("stop-color", "#FFD700").attr("stop-opacity", 0);

        // 图层组
        const mainGroup = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`);
        arcGroup = mainGroup.append("g").attr("class", "arc-group")
            .attr("transform", `translate(0, ${splitY})`).attr("clip-path", "url(#clip-view-c)");
        pianoGroup = mainGroup.append("g").attr("class", "piano-group")
            .attr("transform", `translate(0, ${splitY})`);
        highlightGroup = pianoGroup.append("g").attr("class", "highlight-group");
        playhead = mainGroup.append("rect").attr("class", "c-playhead")
            .attr("width", 2).attr("y", splitY / 2).attr("height", height - (splitY / 2))
            .attr("fill", "url(#playheadGradientC)").style("pointer-events", "none").style("display", "none");

        // 坐标系
        xScale = d3.scaleLinear().domain([0, maxTime]).range([0, width]);
        const minPitch = d3.min(notes, d => d.pitch) || 0;
        const maxPitch = d3.max(notes, d => d.pitch) || 127;
        yScale = d3.scaleLinear().domain([maxPitch + 2, minPitch - 2]).range([0, pianoHeight]);

        // 钢琴卷帘配色
        const allTrackNames = Array.from(new Set(notes.map(d => d.track_new || d.instrument)));
        const melodicTracks = allTrackNames.filter(t => !isPercussionTrack(t));
        colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(melodicTracks);
        const noteH = Math.max(2, pianoHeight / (maxPitch - minPitch + 4));

        // 绘制音符
        pianoGroup.selectAll(".c-note").data(notes).enter().append("rect")
            .attr("class", "c-note")
            .attr("x", d => xScale(d.time_start_sec))
            .attr("y", d => yScale(d.pitch) - noteH/2)
            .attr("width", d => Math.max(1, xScale(d.time_end_sec) - xScale(d.time_start_sec)))
            .attr("height", noteH)
            .each(function(d) {
                const name = d.track_new || d.instrument;
                let baseColor = isPercussionTrack(name) ? "#ffffff" : colorScale(name);
                d3.select(this).attr("fill", baseColor).attr("opacity", 0.7)
                    .attr("data-base-color", baseColor).attr("data-light-color", lightenColor(baseColor, 1.8));
            });

        // 底部时间轴
        const xAxis = d3.axisBottom(xScale).tickFormat(d => d + "s").ticks(Math.max(10, width / 100));
        pianoGroup.append("g").attr("transform", `translate(0, ${pianoHeight})`)
            .call(xAxis).style("color", "#888").select(".domain").remove();

        renderArcs.maxH = arcHeight;
        renderArcs();
    }

    // 数据加载逻辑
    async function loadArcData() {
        let meta = null;
        try { if (typeof sharedState !== 'undefined') meta = sharedState.selectedData; } catch(e) {}
        if (!meta || !meta.baseName) return;

        const baseName = meta.baseName;
        const melodicPath = `./data/processed/${encodeURIComponent(baseName)}_arcs_melodic.json`;
        const macroPath = `./data/processed/${encodeURIComponent(baseName)}_arcs_macro.json`;

        try {
            const [melodic, macro] = await Promise.all([
                d3.json(melodicPath).catch(() => []),
                d3.json(macroPath).catch(() => [])
            ]);
            cachedArcsMelodic = melodic;
            cachedArcsMacro = macro;
            isDataLoaded = true;
        } catch (e) { console.error(e); }
    }

    // =========================================================================
    // 7. 链条计算逻辑 (Chaining)
    // =========================================================================
    function computeChains(arcsData) {
        // 初始化链条 ID
        arcsData.forEach((d, i) => {
            d.chainId = i;
            d.chainColor = null;
        });

        // 参数设置：Macro 模式下允许更宽松的连接条件
        const timeTol = currentMode === 'macro' ? 4.0 : 2.0;
        const durTolRatio = 0.4;

        // 按时间排序以优化查找
        const sorted = [...arcsData].sort((a, b) => a.source_start - b.source_start);

        for (let i = 0; i < sorted.length; i++) {
            const A = sorted[i];
            const A_end = A.target_start;
            for (let j = i + 1; j < sorted.length; j++) {
                const B = sorted[j];
                // 性能优化：超出时间范围则停止内层循环
                if (B.source_start > A_end + timeTol + 5.0) break;

                // 判断 B 是否紧接 A (A -> B)
                const timeMatch = Math.abs(B.source_start - A_end) < timeTol;
                if (timeMatch) {
                    const durRatio = Math.abs(A.duration - B.duration) / Math.max(A.duration, B.duration);
                    if (durRatio < durTolRatio) {
                        // 合并链条 ID
                        const oldId = B.chainId;
                        const newId = A.chainId;
                        if (oldId !== newId) {
                            sorted.forEach(d => { if (d.chainId === oldId) d.chainId = newId; });
                        }
                    }
                }
            }
        }

        // 分配链条颜色
        const activePalette = getCurrentPalette();
        const uniqueIds = Array.from(new Set(sorted.map(d => d.chainId)));
        const colorMap = new Map();
        uniqueIds.forEach((id, index) => {
            colorMap.set(id, activePalette[index % activePalette.length]);
        });

        sorted.forEach(d => {
            d.chainColor = colorMap.get(d.chainId);
        });
        return sorted;
    }

    // =========================================================================
    // 8. 弧形渲染逻辑
    // =========================================================================
    function renderArcs() {
        arcGroup.selectAll(".arc-path").remove();
        highlightGroup.selectAll("*").remove();
        originalColors.clear();
        updateVizC.lastActiveKey = null;

        const data = currentMode === 'melodic' ? cachedArcsMelodic : cachedArcsMacro;
        const maxH = renderArcs.maxH || 100;

        if (!data || data.length === 0) {
            arcGroup.append("text")
                .attr("x", width / 2).attr("y", -maxH / 2).attr("text-anchor", "middle")
                .attr("fill", "#666").style("font-size", "12px")
                .text(isDataLoaded ? "No patterns found" : "Loading...");
            return;
        }

        // 1. 数据过滤
        let filteredData = data.filter(d => {
            const sourceEnd = d.source_start + d.duration;
            if (d.target_start < sourceEnd + 0.5) return false;
            if (d.duration < filterMinDuration) return false;
            if (d.duration > filterMaxDuration) return false;
            // 修正：允许 0.5s 的短跨度，防止过滤紧凑的重复结构
            if (d.span < 0.5) return false;
            return true;
        });

        // 2. 排序与截断
        filteredData.sort((a, b) => calculateScore(b) - calculateScore(a));
        filteredData = filteredData.slice(0, filterTopN); // 使用动态计算的 filterTopN

        // 3. 计算链条与分配颜色
        filteredData = computeChains(filteredData);

        // 4. 视觉排序：小弧形在顶层
        filteredData.sort(sortArcsByArea);

        // 路径生成器
        const drawRibbon = (d) => {
            const x_start = xScale(d.source_start);
            const w = xScale(d.duration) - xScale(0);
            const x_end = xScale(d.target_start);
            const outer_x1 = x_start; const outer_x2 = x_end + w;
            const inner_x1 = x_start + w; const inner_x2 = x_end;
            const rx_outer = (outer_x2 - outer_x1) / 2;
            const availableH = maxH - 5;
            const ry_outer = Math.min(rx_outer, availableH);
            const squashRatio = ry_outer / rx_outer;
            const ry_inner = (inner_x2 - inner_x1) / 2 * squashRatio;
            return `M ${outer_x1},0 A ${rx_outer},${ry_outer} 0 0,1 ${outer_x2},0 L ${inner_x2},0 A ${(inner_x2 - inner_x1)/2},${ry_inner} 0 0,0 ${inner_x1},0 Z`;
        };

        const arcs = arcGroup.selectAll(".arc-path")
            .data(filteredData)
            .enter().append("path")
            .attr("class", d => currentMode === 'macro' ? "arc-path macro" : "arc-path")
            .attr("d", drawRibbon)
            .attr("fill", (d) => {
                const color = d.chainColor;
                originalColors.set(d, color);
                return color;
            })
            .attr("fill-opacity", currentMode === 'melodic' ? 0.5 : 0.45)
            .attr("stroke", "none");

        // --- 交互事件绑定 ---
        arcs.on("mouseover", function(event, d) {
            isUserHovering = true;
            const currentChainId = d.chainId;
            highlightChain(currentChainId);

            const arcType = d.type || (currentMode === 'macro' ? 'macro' : 'melodic');
            const similarity = d.confidence !== undefined ? d.confidence.toFixed(3) : 'N/A';

            d3.select("#c-tooltip").style("display", "block")
                .html(`
                    <strong>${arcType}</strong><br>
                    Duration: ${d.duration.toFixed(2)}s<br>
                    Similarity: ${similarity}
                `)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 15) + "px");
        })
        .on("mousemove", function(event) {
            d3.select("#c-tooltip").style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 15) + "px");
        })
        .on("mouseout", function(event, d) {
            isUserHovering = false;
            resetHighlights();
            d3.select("#c-tooltip").style("display", "none");
        });
    }

    // 辅助高亮函数
    function highlightChain(targetChainId) {
        const relatedArcs = arcGroup.selectAll(".arc-path").filter(p => p.chainId === targetChainId);
        relatedArcs.raise().classed("active", true).attr("fill", "#ffffff").attr("fill-opacity", 0.7);
        arcGroup.selectAll(".arc-path").filter(p => p.chainId !== targetChainId).attr("fill-opacity", 0.1);
        highlightGroup.selectAll("*").remove();

        relatedArcs.each(function(p) {
            const w = xScale(p.duration) - xScale(0);
            let s_y = 0, s_h = pianoHeight, t_y = 0, t_h = pianoHeight;
            if (currentMode === 'melodic' && p.source_max !== undefined) {
                const s_top = yScale(p.source_max); const s_bot = yScale(p.source_min);
                s_y = s_top - 4; s_h = Math.abs(s_bot - s_top) + 8;
                const t_top = yScale(p.target_max); const t_bot = yScale(p.target_min);
                t_y = t_top - 4; t_h = Math.abs(t_bot - t_top) + 8;
            }
            highlightGroup.append("rect").attr("class", "c-highlight-rect")
                .attr("x", xScale(p.source_start)).attr("y", s_y).attr("width", w).attr("height", s_h);
            highlightGroup.append("rect").attr("class", "c-highlight-rect")
                .attr("x", xScale(p.target_start)).attr("y", t_y).attr("width", w).attr("height", t_h);
        });
    }

    function resetHighlights() {
        arcGroup.selectAll(".arc-path")
            .classed("active", false)
            .attr("fill", p => originalColors.get(p))
            .attr("fill-opacity", currentMode === 'melodic' ? 0.5 : 0.45);
        highlightGroup.selectAll(".c-highlight-rect").remove();
    }

    // =========================================================================
    // 9. 播放同步更新函数
    // =========================================================================
    function updateVizC(currentTime) {
        if (!playhead || !xScale) return;

        // 更新播放头位置
        const x = xScale(currentTime);
        if (x >= 0 && x <= width) {
            playhead.attr("x", x - 1).style("display", "block");
            const domContainer = container.node();
            if (domContainer && domContainer.scrollWidth > domContainer.clientWidth) {
                const targetScroll = x - domContainer.clientWidth / 2;
                domContainer.scrollLeft = targetScroll;
            }
        } else {
            playhead.style("display", "none");
        }

        // 更新音符高亮
        if (pianoGroup) {
            pianoGroup.selectAll(".c-note").each(function(d) {
                const el = d3.select(this);
                if (currentTime >= d.time_start_sec && currentTime <= d.time_end_sec) {
                    el.attr("fill", el.attr("data-light-color")).attr("opacity", 1);
                } else {
                    el.attr("fill", el.attr("data-base-color")).attr("opacity", 0.7);
                }
            });
        }

        // 自动高亮活跃的弧形链条 (如果用户未交互)
        if (isUserHovering) return;

        const activeChainIds = new Set();
        arcGroup.selectAll(".arc-path").each(function(d) {
            const inSource = currentTime >= d.source_start && currentTime <= (d.source_start + d.duration);
            const inTarget = currentTime >= d.target_start && currentTime <= (d.target_start + d.duration);
            if (inSource || inTarget) activeChainIds.add(d.chainId);
        });

        // 性能优化：仅当状态变化时操作 DOM
        const activeKey = Array.from(activeChainIds).sort().join(",");
        if (activeKey === updateVizC.lastActiveKey) return;
        updateVizC.lastActiveKey = activeKey;

        if (activeChainIds.size > 0) {
            arcGroup.selectAll(".arc-path").attr("fill-opacity", 0.1);
            highlightGroup.selectAll("*").remove();

            const activeArcs = arcGroup.selectAll(".arc-path").filter(d => activeChainIds.has(d.chainId));
            activeArcs.raise().classed("active", true).attr("fill", "#ffffff").attr("fill-opacity", 0.7);

            activeArcs.each(function(p) {
                const w = xScale(p.duration) - xScale(0);
                let s_y = 0, s_h = pianoHeight, t_y = 0, t_h = pianoHeight;
                if (currentMode === 'melodic' && p.source_max !== undefined) {
                    const s_top = yScale(p.source_max); const s_bot = yScale(p.source_min);
                    s_y = s_top - 4; s_h = Math.abs(s_bot - s_top) + 8;
                    const t_top = yScale(p.target_max); const t_bot = yScale(p.target_min);
                    t_y = t_top - 4; t_h = Math.abs(t_bot - t_top) + 8;
                }
                highlightGroup.append("rect").attr("class", "c-highlight-rect")
                    .attr("x", xScale(p.source_start)).attr("y", s_y).attr("width", w).attr("height", s_h);
                highlightGroup.append("rect").attr("class", "c-highlight-rect")
                    .attr("x", xScale(p.target_start)).attr("y", t_y).attr("width", w).attr("height", t_h);
            });
        } else {
            resetHighlights();
        }
    }

    // 暴露全局接口
    window.drawViewC = drawViewC;
    window.updateVizC = updateVizC;
})();