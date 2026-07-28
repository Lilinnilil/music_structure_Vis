/**
 * View B: Dynamics Stream (能量河流图)
 *
 * 1. Data Infrastructure (Binning, Stacking)
 * 2. Harmonic Glow (Ambience, Filters)
 * 3. Dynamic Texture (Sliced Rendering)
 * 4. Particle System (Percussion)
 * 5. Interaction Hub (Brush, Click)
 * 6. Entrance Animation & Optimization
 */

(function () {
    // --- 1. 内部配置与常量 ---
    const CONFIG_B = {
        // 环节一：数据基础
        BIN_SIZE_SEC: 0.2, // 时间切片粒度：200ms
        Y_SCALE_EXPONENT: 0.6, // Y轴幂指数
        STREAM_CURVE: d3.curveCatmullRom.alpha(0.5), // 曲线类型：CatmullRom（更自然的流动感）
        PAD_ZERO_BINS: 2, // 首尾填充的零值 Bin 数量
        FAMILY_ORDER: [
            // 堆叠顺序：从下到上 (低音 -> 高音)
            "Bass",
            "Guitar",    // [新增] 放在 Bass 上面
            "Strings",
            "Keyboards",
            "Brass",
            "Woodwinds",
            "Voice",
            "Synth",
            "Other",     // 确保在最后
        ],

        // 环节二：和声光场
        AMBIENT_COLORS: {
            CALM: "#0f172a", // 深蓝/岩石色 (低复杂度)
            WARM: "#450a0a", // 深红/岩浆色 (高复杂度)
            NEUTRAL: "#1a1a1a", // 中性黑
        },
        GLOW_INTENSITY_BASE: 0.3, // 基础发光强度
        BREATH_SPEED: 0.05, // 呼吸动画速度系数

        // 环节三：动态纹理
        TEXTURE_SLICE_SEC: 2.0, // 纹理切片长度：每 2 秒作为一个纹理单元
        DENSITY_THRESHOLDS: {
            LOW: 2, // < 2 notes/sec = Smooth
            MID: 8, // 2-8 notes/sec = Textured
            HIGH: 15, // > 15 notes/sec = Intense
        },

        // 环节四：打击乐粒子系统
        PARTICLE_LIFETIME: 0.6, // 粒子存活时间 (秒)
        PARTICLE_OFFSET_Y: 20, // 粒子Y轴随机偏移量
        DRUM_MAPPING: {
            LOW: [35, 36, 41, 43, 45, 47], // Kick, Low Tom
            MID: [38, 40, 37, 39, 48, 50], // Snare, Clap, Mid Tom
            HIGH: [42, 44, 46, 49, 51, 52, 53, 55, 57, 59], // Hi-hat, Cymbal, Ride
        },

        // 环节五：交互
        DEFAULT_ZOOM_WINDOW: 10, // 默认缩放窗口大小 (秒)

        // 环节六：性能优化
        MAX_PARTICLES: 800, // 性能保护：最大粒子数
        ENTRANCE_DURATION: 1500, // 进场动画时长 (ms)
    };

    // --- 0. 样式注入 (新增) ---
    function injectStyles() {
        const styleId = "view-b-styles";
        if (document.getElementById(styleId)) return;

        const css = `
            /* 确保容器定位上下文 */
            #view-B-container { position: relative !important; }
            
            /* 图例容器：绝对定位在右上角，水平排列 */
            .view-b-legend-container {
                position: absolute;
                top: 8px; /* 与标题对齐 */
                right: 15px;
                z-index: 20;
                display: flex;
                flex-wrap: wrap; /* 小屏幕允许换行 */
                gap: 12px;
                align-items: center;
                background: rgba(0, 0, 0, 0.4); /* 半透明背景增强可读性 */
                padding: 3px 8px;
                border-radius: 4px;
                backdrop-filter: blur(2px);
            }

            /* 单个图例项 */
            .vb-legend-item {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                transition: all 0.2s;
                opacity: 0.7;
            }
            .vb-legend-item:hover { opacity: 1; transform: scale(1.05); }
            
            /* 激活状态（用于 Hover 高亮逻辑） */
            .vb-legend-item.active { opacity: 1; font-weight: bold; }
            .vb-legend-item.dimmed { opacity: 0.2; }

            /* 色块 */
            .vb-color-box {
                width: 10px; height: 10px;
                border-radius: 2px;
                border: 1px solid rgba(255,255,255,0.3);
            }

            /* 文字 */
            .vb-label {
                font-size: 11px;
                color: #ddd;
                font-family: 'Segoe UI', sans-serif;
                user-select: none;
            }
        `;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // --- 2. 全局变量声明 ---
    let svg, chartGroup, axisGroup, backgroundLayer, particleLayer, interactionLayer;
    let xScale, yScale, colorScale;
    let width, height, trackInfo;
    let percussionEvents = [];

    // --- 3. 辅助函数：乐器家族映射 ---
    function getInstrumentFamily(trackName) {
        if (!trackName) return "Other";
        const name = trackName.toLowerCase();

        // 打击乐单独处理（不参与河流堆叠，环节四处理）
        if (
            name.includes("drum") ||
            name.includes("percussion") ||
            name.includes("kit")
        )
            return "Percussion";

        // 核心家族映射逻辑
        if (name.includes("bass")) return "Bass";
        if (
            name.includes("violin") ||
            name.includes("viola") ||
            name.includes("cello") ||
            name.includes("contrabass") ||
            name.includes("strings")
        )
            return "Strings";
        if (
            name.includes("piano") ||
            name.includes("organ") ||
            name.includes("harpsichord") ||
            name.includes("keyboard")
        )
            return "Keyboards";
        if (
            name.includes("flute") ||
            name.includes("oboe") ||
            name.includes("clarinet") ||
            name.includes("bassoon") ||
            name.includes("sax") ||
            name.includes("piccolo")
        )
            return "Woodwinds";
        if (
            name.includes("trumpet") ||
            name.includes("trombone") ||
            name.includes("tuba") ||
            name.includes("horn") ||
            name.includes("brass")
        )
            return "Brass";
        if (
            name.includes("choir") ||
            name.includes("voice") ||
            name.includes("vocal")
        )
            return "Voice";
        if (name.includes("synth") || name.includes("pad") || name.includes("lead"))
            return "Synth";
        if (name.includes("guitar")) return "Guitar";

        return "Other";
    }

    // --- 4. 环节一：核心数据处理：分箱与堆叠准备 (包含密度计算) ---
    function processDataForStream(notes, maxTime) {
        const numBins =
            Math.ceil(maxTime / CONFIG_B.BIN_SIZE_SEC) + CONFIG_B.PAD_ZERO_BINS;

        // 初始化 Bins，新增 count 字段用于计算密度 (环节三)
        const bins = new Array(numBins).fill(0).map((_, i) => ({
            time: i * CONFIG_B.BIN_SIZE_SEC,
            total: 0,
            counts: {}, // 记录每个 Family 在该 bin 内的音符数量
        }));

        const activeFamilies = new Set();

        notes.forEach((note) => {
            const family = getInstrumentFamily(note.track_new);

            // 关键：跳过打击乐（将在环节四作为粒子系统独立渲染）
            if (family === "Percussion") return;

            activeFamilies.add(family);

            const startBin = Math.floor(note.time_start_sec / CONFIG_B.BIN_SIZE_SEC);
            // 音符只贡献给它"开始"所在的那个 Bin 的密度（攻击密度）
            if (startBin >= 0 && startBin < bins.length) {
                if (!bins[startBin].counts[family]) bins[startBin].counts[family] = 0;
                bins[startBin].counts[family]++;
            }

            // Velocity 依然累加到持续时间段内（能量）
            const timeEndSec = note.time_start_sec + (note.duration_sec || 0);
            const endBin = Math.floor(timeEndSec / CONFIG_B.BIN_SIZE_SEC);
            for (let b = startBin; b <= endBin; b++) {
                if (b >= 0 && b < bins.length) {
                    if (!bins[b][family]) bins[b][family] = 0;
                    bins[b][family] += note.velocity;
                    bins[b].total += note.velocity;
                }
            }
        });

        const keys = Array.from(activeFamilies);

        // 数据补全：确保每个 Bin 都有所有 Key 的字段
        bins.forEach((bin) => {
            keys.forEach((k) => {
                if (bin[k] === undefined) bin[k] = 0;
                if (bin.counts[k] === undefined) bin.counts[k] = 0;
            });
        });

        // 排序 Keys：确保堆叠顺序符合音乐逻辑
        keys.sort((a, b) => {
            // 强制 Other 永远沉底 (在图例中最右，在河流堆叠中最上或最下)
            if (a === "Other") return 1;
            if (b === "Other") return -1;

            const idxA = CONFIG_B.FAMILY_ORDER.indexOf(a);
            const idxB = CONFIG_B.FAMILY_ORDER.indexOf(b);
            // 未知乐器排在 Other 之前，已知乐器之后
            const valA = idxA === -1 ? 998 : idxA;
            const valB = idxB === -1 ? 998 : idxB;

            return valA - valB;
        });

        // === 新增：数据平滑逻辑 ===
        const SMOOTHING_WINDOW = 5; // 窗口大小，越大越平滑（3->5，增强平滑力度）

        // 深拷贝一份 bins 用于计算，避免引用问题
        const smoothedBins = JSON.parse(JSON.stringify(bins));

        for (let i = 0; i < bins.length; i++) {
            keys.forEach((key) => {
                let sum = 0;
                let count = 0;

                // 计算前后窗口的平均值
                for (let j = -SMOOTHING_WINDOW; j <= SMOOTHING_WINDOW; j++) {
                    if (bins[i + j]) {
                        sum += bins[i + j][key] || 0;
                        count++;
                    }
                }

                // 更新当前点的值
                smoothedBins[i][key] = count > 0 ? sum / count : 0;

                // 可选：应用非线性映射，放大能量感（让宽的地方更宽，窄的地方更窄）
                // smoothedBins[i][key] = Math.pow(smoothedBins[i][key], 1.2);
            });
        }

        // 使用平滑后的数据
        return { bins: smoothedBins, keys };
    }

    // --- 5. 环节二：光场与滤镜初始化 ---
    function setupAmbienceAndFilters(defs) {
        // 1. 定义高斯模糊滤镜 (用于河流本身的柔光)
        const streamFilter = defs
            .append("filter")
            .attr("id", "stream-glow")
            .attr("x", "-20%")
            .attr("y", "-20%")
            .attr("width", "140%")
            .attr("height", "140%");

        streamFilter
            .append("feGaussianBlur")
            .attr("stdDeviation", "3") // 适度模糊，产生光晕感
            .attr("result", "coloredBlur");

        const feMerge = streamFilter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic"); // 叠加原图，保持清晰边缘

        // 2. 定义背景呼吸光晕 (Ambient Glow)
        const ambientGradient = defs
            .append("radialGradient")
            .attr("id", "ambient-gradient")
            .attr("cx", "50%")
            .attr("cy", "50%")
            .attr("r", "80%"); // 增大半径，让光晕充满画面

        ambientGradient
            .append("stop")
            .attr("class", "ambient-stop-center")
            .attr("offset", "0%")
            .attr("stop-color", CONFIG_B.AMBIENT_COLORS.NEUTRAL)
            .attr("stop-opacity", 0.6);

        ambientGradient
            .append("stop")
            .attr("class", "ambient-stop-edge")
            .attr("offset", "100%")
            .attr("stop-color", "#000") // 边缘渐变到黑
            .attr("stop-opacity", 0);

        // 3. 定义粒子模糊滤镜（用于顶部粒子的"星空化"效果）
        const particleFilter = defs
            .append("filter")
            .attr("id", "particle-glow")
            .attr("x", "-50%")
            .attr("y", "-50%")
            .attr("width", "200%")
            .attr("height", "200%");

        particleFilter
            .append("feGaussianBlur")
            .attr("stdDeviation", "1.5") // 轻微模糊，产生星尘光晕
            .attr("result", "blur");

        const particleMerge = particleFilter.append("feMerge");
        particleMerge.append("feMergeNode").attr("in", "blur");
        particleMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // 4. [新增] Playhead 渐变 (复用 View D)
        const playheadGradient = defs
            .append("linearGradient")
            .attr("id", "playheadGradientB") // 给个新 ID 防止冲突
            .attr("x1", "0%")
            .attr("y1", "0%")
            .attr("x2", "0%")
            .attr("y2", "100%");

        const highlightColor = (window.CONFIG && window.CONFIG.HIGHLIGHT_COLOR) || "#FFD700";

        playheadGradient
            .append("stop")
            .attr("offset", "0%")
            .attr("stop-color", highlightColor)
            .attr("stop-opacity", 0.1);

        playheadGradient
            .append("stop")
            .attr("offset", "50%") // 中间亮一点
            .attr("stop-color", "#fff")
            .attr("stop-opacity", 0.8);

        playheadGradient
            .append("stop")
            .attr("offset", "100%")
            .attr("stop-color", highlightColor)
            .attr("stop-opacity", 0.1);
    }

    // --- 6. 环节三：纹理定义 ---
    function setupTextures(defs) {
        // 1. 斜线纹理 (Stripe) - 用于中等密度（极度弱化）
        const stripePattern = defs
            .append("pattern")
            .attr("id", "pattern-stripe")
            .attr("width", 8) // 拉大间距 (6->8)
            .attr("height", 8)
            .attr("patternUnits", "userSpaceOnUse")
            .attr("patternTransform", "rotate(45)");

        stripePattern
            .append("rect")
            .attr("width", 0.5) // 线条变得极细 (1->0.5)
            .attr("height", 16)
            .attr("fill", "#fff")
            .attr("fill-opacity", 0.08); // 透明度极低 (0.1->0.08)

        // 2. 点阵纹理 (Dot) - 用于高密度（极度弱化）
        const dotPattern = defs
            .append("pattern")
            .attr("id", "pattern-dot")
            .attr("width", 4) // 稍微拉开间距
            .attr("height", 4)
            .attr("patternUnits", "userSpaceOnUse");

        dotPattern
            .append("circle")
            .attr("cx", 2)
            .attr("cy", 2)
            .attr("r", 0.5) // 半径极小
            .attr("fill", "#fff")
            .attr("fill-opacity", 0.1); // 透明度降低 (0.15->0.1)
    }

    // --- 7. 环节四：粒子数据预处理 ---
    function processPercussionData(notes) {
        const events = [];
        notes.forEach((note) => {
            // 检查是否为打击乐
            if (getInstrumentFamily(note.track_new) === "Percussion") {
                let type = "MID"; // 默认中频
                const p = note.pitch;

                if (CONFIG_B.DRUM_MAPPING.LOW.includes(p)) type = "LOW";
                else if (CONFIG_B.DRUM_MAPPING.HIGH.includes(p)) type = "HIGH";

                events.push({
                    time: note.time_start_sec,
                    velocity: note.velocity,
                    type: type,
                    id: `p-${note.time_start_sec}-${note.pitch}`,
                    active: false, // 标记是否已被激活渲染
                });
            }
        });
        // 按时间排序
        events.sort((a, b) => a.time - b.time);
        return events;
    }

    // --- 8. 环节四：粒子绘制逻辑 (静态) ---
    function drawParticlesStatic() {
        // 清理旧粒子
        particleLayer.selectAll(".particle").remove();

        // 绑定数据
        const particles = particleLayer
            .selectAll(".particle")
            .data(percussionEvents)
            .enter()
            .append("path") // 使用 Path 可以绘制不同形状
            .attr("class", (d) => `particle particle-${d.type}`)
            .attr("transform", (d) => {
                const x = xScale(d.time);
                let y = height / 2; // 默认中心

                // 空间分层逻辑
                if (d.type === "LOW") y = height * 0.85; // 底部
                else if (d.type === "HIGH") y = height * 0.15; // 顶部
                else y = height * 0.5; // 中部

                // 增加一点随机偏移，避免排成直线
                y += (Math.random() - 0.5) * CONFIG_B.PARTICLE_OFFSET_Y;

                return `translate(${x}, ${y})`;
            })
            .attr("d", (d) => {
                const size = (d.velocity / 127) * 5; // 基础大小
                if (d.type === "LOW")
                    return d3
                        .symbol()
                        .type(d3.symbolCircle)
                        .size(size * 10)();
                if (d.type === "MID")
                    return d3
                        .symbol()
                        .type(d3.symbolDiamond)
                        .size(size * 8)();
                return d3
                    .symbol()
                    .type(d3.symbolStar)
                    .size(size * 3)(); // High 用星形
            })
            .attr("fill", "#fff")
            .attr("fill-opacity", (d) => {
                // 静态时透明度较低，不抢戏
                return 0.3 + (d.velocity / 127) * 0.3;
            })
            .style("mix-blend-mode", "overlay"); // 叠加模式，产生高光感
    }

    // --- 9. 环节五：交互处理函数已移至 drawViewB 内部（updateProgressFromEvent）---

    // --- 10. [Stage 6+] 图例绘制函数 (HTML版) ---
    function drawLegend(keys, colorScale, containerSelector) {
        // 1. 找到父容器 (main-view-box)
        const vizNode = d3.select(containerSelector).node();
        if (!vizNode) return;
        const mainBox = d3.select(vizNode.parentNode);

        // 2. 清除旧图例
        mainBox.select(".view-b-legend-container").remove();

        // 3. 创建新容器
        const legendContainer = mainBox.append("div")
            .attr("class", "view-b-legend-container");

        // 4. 排序 keys (低音在左，高音在右，符合直觉)
        // 这里使用原始 keys 顺序 (Bass -> ... -> Other)
        // 如果你喜欢反过来，可以用 keys.slice().reverse()
        const legendKeys = keys;

        // 5. 生成图例项
        legendKeys.forEach(key => {
            const item = legendContainer.append("div")
                .attr("class", "vb-legend-item")
                .on("mouseover", () => {
                    // 高亮逻辑
                    // 1. 图例自身变化
                    legendContainer.selectAll(".vb-legend-item").classed("dimmed", true);
                    item.classed("dimmed", false).classed("active", true);

                    // 2. 河流图变化
                    chartGroup.selectAll(".layer-group").transition().duration(200).style("opacity", 0.1);
                    chartGroup.select(`.layer-${key}`).transition().duration(200).style("opacity", 1);
                })
                .on("mouseout", () => {
                    // 恢复逻辑
                    legendContainer.selectAll(".vb-legend-item").classed("dimmed", false).classed("active", false);
                    chartGroup.selectAll(".layer-group").transition().duration(200).style("opacity", 1);
                });

            // 色块
            item.append("div")
                .attr("class", "vb-color-box")
                .style("background-color", colorScale(key));

            // 文字
            item.append("span")
                .attr("class", "vb-label")
                .text(key);
        });
    }

    // --- 11. 主绘制函数：整合所有环节 ---
    function drawViewB(notes, maxTime, containerSelector, infoData) {
        console.log("🌊 View B (Dynamics Stream) Final Build...");

        // [新增] 注入样式
        injectStyles();

        trackInfo = infoData || {}; // 保存元数据供后续使用

        const container = d3.select(containerSelector);
        if (container.empty()) return;

        const margin = { top: 10, right: 30, bottom: 20, left: 50 };
        const clientWidth = container.node().clientWidth || 800;
        const clientHeight = container.node().clientHeight || 200;
        width = clientWidth - margin.left - margin.right;
        height = clientHeight - margin.top - margin.bottom;

        container.selectAll("svg").remove();
        svg = container
            .append("svg")
            .attr("width", clientWidth)
            .attr("height", clientHeight);

        // 环节六：定义进场动画的 ClipPath
        const defs = svg.append("defs");
        setupAmbienceAndFilters(defs);
        setupTextures(defs);

        defs
            .append("clipPath")
            .attr("id", "stream-entrance-clip")
            .append("rect")
            .attr("width", 0) // 初始宽度为0
            .attr("height", height)
            .attr("x", 0)
            .attr("y", 0)
            .transition()
            .duration(CONFIG_B.ENTRANCE_DURATION)
            .ease(d3.easeCubicOut)
            .attr("width", width); // 动画至全宽

        // 环节二：背景层 (最底层)
        backgroundLayer = svg.append("g").attr("class", "background-layer");
        backgroundLayer
            .append("rect")
            .attr("width", clientWidth)
            .attr("height", clientHeight)
            .attr("fill", "#000");

        // 环节二：根据 Harmonic Complexity 决定背景基调
        const complexity = trackInfo.harmonic_complexity || 5;
        const normalizedComplexity = Math.min(Math.max(complexity / 15, 0), 1);

        // 插值颜色：低复杂度->冷蓝，高复杂度->暖红
        const baseColor = d3.interpolateRgb(
            CONFIG_B.AMBIENT_COLORS.CALM,
            CONFIG_B.AMBIENT_COLORS.WARM
        )(normalizedComplexity);

        // 更新渐变颜色
        svg.select(".ambient-stop-center").attr("stop-color", baseColor);

        // 叠加呼吸光晕（确保在所有内容的最底层）
        backgroundLayer
            .append("rect")
            .attr("class", "ambient-light")
            .attr("width", clientWidth)
            .attr("height", clientHeight)
            .attr("fill", "url(#ambient-gradient)")
            .style("mix-blend-mode", "screen") // 关键：混合模式产生发光感
            .attr("opacity", 0.5); // 初始给一个可见的透明度

        // 内容层组
        const contentGroup = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // 层级顺序：河流 -> 粒子 -> 交互层 -> 轴
        chartGroup = contentGroup
            .append("g")
            .attr("class", "stream-layers")
            .attr("clip-path", "url(#stream-entrance-clip)"); // 环节六：应用进场遮罩

        particleLayer = contentGroup.append("g").attr("class", "particle-layer");
        interactionLayer = contentGroup
            .append("g")
            .attr("class", "interaction-layer");
        axisGroup = contentGroup.append("g").attr("class", "axis-group");

        // 环节一：数据处理
        const { bins, keys } = processDataForStream(notes, maxTime);
        if (keys.length === 0) {
            svg
                .append("text")
                .text("No melodic content to display")
                .attr("x", width / 2)
                .attr("y", height / 2)
                .attr("fill", "#888");
            return;
        }

        // 堆叠计算
        const stack = d3
            .stack()
            .keys(keys)
            .offset(d3.stackOffsetSilhouette)
            .order(d3.stackOrderNone);
        const series = stack(bins);

        // 比例尺定义
        xScale = d3.scaleLinear().domain([0, maxTime]).range([0, width]); // 确保展示全曲
        const maxY = d3.max(series, (layer) => d3.max(layer, (d) => d[1]));
        const minY = d3.min(series, (layer) => d3.min(layer, (d) => d[0]));
        const maxAbsY = Math.max(Math.abs(maxY), Math.abs(minY));
        // 优化 Y 轴比例：扩大 domain 范围，让河流在视觉上变窄一点，留出上下空间给粒子
        yScale = d3.scaleLinear()
            .domain([-maxAbsY * 1.5, maxAbsY * 1.5]) // 乘以 1.5 倍
            .range([height, 0]);

        // [Stage 6++] 精良霓虹配色 - 赛博流动调色板
        const neonColors = d3
            .scaleOrdinal()
            .domain(CONFIG_B.FAMILY_ORDER)
            .range([
                "#4a90e2", // Bass (深蓝: 稳重的根基色)
                "#f5a623", // Guitar (琥珀金: 亮眼不土，替代褐色)
                "#ff7f0e", // Strings (鲜橙: 丝滑的织体)
                "#f32f30", // Keyboards (活力红: 核心旋律色，富有能量)
                "#4db6ac", // Brass (青翠: 清脆、穿透力强)
                "#7ed321", // Woodwinds (嫩绿: 自然、清新)
                "#f8e71c", // Voice (明黄: 整个光谱中最亮的点)
                "#bd10e0", // Synth (电光紫: 充满未来感)
                "#9b9b9b", // Other (灰: 辅助，低调不干扰)
            ]);
        colorScale = neonColors;

        const area = d3
            .area()
            .x((d) => xScale(d.data.time))
            .y0((d) => yScale(d[0]))
            .y1((d) => yScale(d[1]))
            .curve(CONFIG_B.STREAM_CURVE);

        // 环节三：分段渲染逻辑 (Sliced Rendering)
        series.forEach((layerData) => {
            const familyKey = layerData.key;
            const baseColor = colorScale(familyKey);
            const layerGroup = chartGroup
                .append("g")
                .attr("class", `layer-group layer-${familyKey}`)
                .attr("filter", "url(#stream-glow)"); // 环节二：应用发光滤镜

            // 策略：每 N 个 bins 作为一个 Slice
            const binsPerSlice = Math.floor(
                CONFIG_B.TEXTURE_SLICE_SEC / CONFIG_B.BIN_SIZE_SEC
            );

            for (let i = 0; i < layerData.length; i += binsPerSlice) {
                // 获取当前切片的数据子集
                const sliceData = layerData.slice(
                    i,
                    Math.min(i + binsPerSlice + 1, layerData.length)
                );
                if (sliceData.length < 2) continue;

                // 计算该切片内的平均密度
                let totalNotes = 0;
                sliceData.forEach((d) => {
                    totalNotes += d.data.counts[familyKey];
                });
                const density = totalNotes / CONFIG_B.TEXTURE_SLICE_SEC;

                // 绘制基础色块 (底色)
                layerGroup
                    .append("path")
                    .attr("d", area(sliceData))
                    .attr("fill", baseColor)
                    .attr("stroke", "none");

                // 绘制纹理叠加层
                if (density > CONFIG_B.DENSITY_THRESHOLDS.LOW) {
                    let textureUrl = "";
                    if (density > CONFIG_B.DENSITY_THRESHOLDS.HIGH) {
                        textureUrl = "url(#pattern-dot)";
                    } else if (density > CONFIG_B.DENSITY_THRESHOLDS.MID) {
                        textureUrl = "url(#pattern-stripe)";
                    }

                    if (textureUrl) {
                        layerGroup
                            .append("path")
                            .attr("d", area(sliceData))
                            .attr("fill", textureUrl)
                            .attr("stroke", "none")
                            .style("pointer-events", "none");
                    }
                }
            }

            // 绘制描边 - 柔化边缘（降低视觉噪点）
            layerGroup
                .append("path")
                .attr("d", area(layerData))
                .attr("fill", "none")
                .attr("stroke", baseColor) // 使用基础色，不要提亮太多
                .attr("stroke-width", 0.5) // 变细 (0.8->0.5)
                .attr("stroke-opacity", 0.3) // 降低不透明度 (0.4->0.3)
                .style("mix-blend-mode", "overlay"); // 叠加模式提升质感
        });

        // 环节四：粒子系统初始化
        percussionEvents = processPercussionData(notes);

        // 环节六：粒子降采样 (性能保护)
        if (percussionEvents.length > CONFIG_B.MAX_PARTICLES) {
            percussionEvents = percussionEvents
                .filter((d) => d.velocity > 60) // 只保留力度大的
                .sort((a, b) => b.velocity - a.velocity)
                .slice(0, CONFIG_B.MAX_PARTICLES)
                .sort((a, b) => a.time - b.time);
        }

        // 绘制静态粒子（优化：增加随机性，打破僵硬的"细线"）
        particleLayer
            .selectAll(".particle")
            .data(percussionEvents)
            .enter()
            .append("path")
            .attr("class", (d) => `particle particle-${d.type}`)
            .attr("transform", (d) => {
                const x = xScale(d.time);
                let y = height / 2;

                // 增加随机性 (Randomness)，打破直线感
                const jitter = (Math.random() - 0.5) * 30; // 增加抖动范围

                if (d.type === "LOW") {
                    // 让底鼓浮在河流底部边缘，而不是死板的直线
                    y = height * 0.9 + jitter;
                } else if (d.type === "HIGH") {
                    y = height * 0.1 + jitter;
                } else {
                    y = height * 0.5 + jitter;
                }

                return `translate(${x}, ${y})`;
            })
            .attr("d", (d) => {
                const size = (d.velocity / 127) * 3; // 整体缩小尺寸 (5->3)
                if (d.type === "LOW")
                    return d3
                        .symbol()
                        .type(d3.symbolCircle)
                        .size(size * 10)();
                if (d.type === "MID")
                    return d3
                        .symbol()
                        .type(d3.symbolDiamond)
                        .size(size * 8)();
                return d3
                    .symbol()
                    .type(d3.symbolStar)
                    .size(size * 3)();
            })
            .attr("fill", (d) => {
                // 顶部粒子（HIGH）使用冷色（极淡的青色），其他保持白色
                return d.type === "HIGH" ? "#e0f7fa" : "#fff";
            })
            .attr("fill-opacity", (d) => {
                // 顶部粒子（HIGH）极度降低不透明度，营造星尘感
                if (d.type === "HIGH") {
                    return 0.05 + (d.velocity / 127) * 0.05; // 0.05-0.1 范围
                }
                // 其他粒子保持原有透明度
                return 0.1 + (d.velocity / 127) * 0.2;
            })
            .attr("filter", (d) => {
                // 只对顶部粒子应用模糊滤镜，产生星尘光晕
                return d.type === "HIGH" ? "url(#particle-glow)" : null;
            })
            .style("mix-blend-mode", "screen") // 增加混合模式，让粒子发光而不是实色
            .style("opacity", 0) // 初始隐藏
            .transition()
            .delay((d) => (d.time / maxTime) * CONFIG_B.ENTRANCE_DURATION)
            .duration(500)
            .style("opacity", 1); // 随流体显现

        // 环节五：交互层实现 - 点击或拖拽跳转（Scrubbing）
        // 节流变量：限制拖动时的更新频率
        let lastUpdateTime = 0;
        const UPDATE_THROTTLE_MS = 16; // 约 60fps

        // 定义拖拽行为
        const scrubber = d3
            .drag()
            .on("start", (event) => {
                // 如果正在播放，先暂
                if (window.Tone && window.Tone.Transport && window.Tone.Transport.state === 'started') {
                    // 禁用后续的 drag 和 end 事件，避免在播放时拖动
                    event.on("drag", null).on("end", null);
                    // 暂停播放 - 通过触发点击事件来暂停（因为 togglePlayback 可能不在全局作用域）
                    const playPauseBtn = document.getElementById('playPauseBtn');
                    if (playPauseBtn) {
                        playPauseBtn.click();
                    }
                } else {
                    // 如果不在播放，正常处理
                    updateProgressFromEvent(event);
                }
            })
            .on("drag", (event) => {
                // 只在非播放状态下拖动
                if (window.Tone && window.Tone.Transport && window.Tone.Transport.state !== 'started') {
                    // 节流更新，避免过于频繁
                    const now = Date.now();
                    if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
                        updateProgressFromEvent(event);
                        lastUpdateTime = now;
                    }
                }
            })
            .on("end", (event) => {
                // 只在非播放状态下处理结束事件
                if (window.Tone && window.Tone.Transport && window.Tone.Transport.state !== 'started') {
                    updateProgressFromEvent(event);
                    lastUpdateTime = 0; // 重置节流
                }
            });

        // 创建一个透明的交互盖板，覆盖整个图表
        interactionLayer
            .append("rect")
            .attr("class", "scrub-surface")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "transparent")
            .style("cursor", "crosshair") // 鼠标变成十字准星，提示可点击
            .call(scrubber) // 绑定拖拽行为
            .on("click", (event) => {
                // 点击跳转 (作为 Drag 的补充)
                updateProgressFromEvent(event);
            });

        // 辅助函数：根据鼠标位置更新全局进度
        function updateProgressFromEvent(event) {
            // 获取鼠标相对于 interactionLayer 的 X 坐标
            // 对于 drag 事件，使用 event.x（相对于被拖拽元素）
            // 对于 click 事件，使用 d3.pointer 获取相对于容器的坐标
            let x;
            if (event.type === 'drag' || event.type === 'start' || event.type === 'end') {
                // D3 drag 事件提供相对于被拖拽元素的坐标
                // 由于我们拖拽的是 interactionLayer 内的 rect，坐标已经是相对于 interactionLayer 的
                x = event.x;
            } else {
                // 对于 click 事件，使用 d3.pointer
                [x] = d3.pointer(event, interactionLayer.node());
            }

            // 转换为时间
            // 限制范围在 [0, width] 之间，防止拖出界
            const clampedX = Math.max(0, Math.min(width, x));
            const targetTime = xScale.invert(clampedX);

            // 限制时间范围在有效区间内（使用 xScale 的 domain 获取最大时间）
            const maxTimeValue = xScale.domain()[1];
            const clampedTime = Math.max(0, Math.min(maxTimeValue, targetTime));

            console.log(`📍 Scrub to: ${clampedTime.toFixed(2)}s`);

            // 直接设置 Transport.seconds，然后更新视图，最后触发事件
            if (window.Tone && window.Tone.Transport) {
                // 直接设置 Transport.seconds（避免通过事件循环）
                window.Tone.Transport.seconds = clampedTime;

                // 更新 View B 的 playhead（跳过 glow 更新以提高性能）
                if (typeof updateVizB === 'function') {
                    updateVizB(clampedTime, false, true);
                }

                // 触发全局事件，通知其他视图（View D, View C 等）
                // 注意：这是在设置完 Transport.seconds 之后，所以不会形成循环
                window.dispatchEvent(
                    new CustomEvent("timejump", { detail: { time: clampedTime } })
                );
            }
        }

        // 环节一：绘制时间轴
        const xAxis = d3
            .axisBottom(xScale)
            .tickFormat(
                (d) => `${Math.floor(d / 60)}:${(d % 60).toFixed(0).padStart(2, "0")}`
            )
            .tickSize(0)
            .tickPadding(10);
        axisGroup
            .append("g")
            .attr("transform", `translate(0, ${height})`)
            .call(xAxis)
            .select(".domain")
            .remove();
        axisGroup.selectAll("text").attr("fill", "#666");

        // [修改] 绘制图例 (传入 containerSelector 以便定位父容器)
        drawLegend(keys, colorScale, containerSelector);

        // 环节六：背景光已在上面设置为 0.5，这里保持固定值
        // 如果需要淡入效果，可以取消下面的注释
        // svg.select(".ambient-light")
        //     .transition()
        //     .delay(500)
        //     .duration(2000)
        //     .attr("opacity", 0.5);
    }

    // --- 12. 动画更新接口：整合所有环节的更新逻辑 ---
    function updateVizB(currentTime, isStopping, skipGlow) {
        // 1. 确保 svg 和 interactionLayer 存在
        if (!svg || !interactionLayer || !xScale) return;

        // 2. 获取或创建 Playhead（使用 ID 避免选择器失效）
        let playhead = interactionLayer.select("#viewb-playhead");

        if (playhead.empty()) {
            playhead = interactionLayer
                .append("rect")
                .attr("id", "viewb-playhead")
                .attr("width", 2) // 宽度 2px
                .attr("y", 0)
                .attr("height", height)
                .attr("fill", "url(#playheadGradientB)") // 使用渐变
                .style("pointer-events", "none");
        }

        if (isStopping) {
            playhead.attr("opacity", 0);
            svg
                .select(".ambient-light")
                .transition()
                .duration(500)
                .attr("opacity", 0.6); // 恢复默认亮度

            // 重置粒子状态
            particleLayer
                .selectAll(".particle")
                .transition()
                .duration(200)
                .attr("transform", function (d) {
                    return (
                        d3.select(this).attr("transform").split(" scale")[0] + " scale(1)"
                    );
                })
                .attr("fill", "#fff");
        } else {
            // 3. 关键：确保 xScale 可用且正确
            if (!xScale) return;

            const x = xScale(currentTime);

            // 4. 边界检查与移动
            if (x >= 0 && x <= width) {
                playhead
                    .attr("x", x - 1) // 居中
                    .attr("opacity", 1);
            } else {
                // 如果超出了（理论上 View B 是全曲，不应超出，除非 scale 错了）
                playhead.attr("opacity", 0);
            }

            // 环节二：呼吸光晕（如果未跳过）
            if (!skipGlow) {
                const breath = 0.6 + 0.2 * Math.sin(currentTime * 3);
                svg.select(".ambient-light").attr("opacity", breath);
            }

            // 环节四：粒子爆发逻辑
            const HIT_WINDOW = 0.1;
            particleLayer.selectAll(".particle").each(function (d) {
                const el = d3.select(this);
                if (d.time >= currentTime - HIT_WINDOW && d.time <= currentTime) {
                    if (!d.active) {
                        d.active = true;
                        el.interrupt()
                            .attr("fill", "#FFD700")
                            .attr("transform", function () {
                                return el.attr("transform").split(" scale")[0] + " scale(2.0)";
                            })
                            .transition()
                            .duration(300)
                            .ease(d3.easeQuadOut)
                            .attr("transform", function () {
                                return el.attr("transform").split(" scale")[0] + " scale(1)";
                            })
                            .attr("fill", "#fff")
                            .on("end", () => {
                                d.active = false;
                            });
                    }
                }
            });
        }
    }

    // --- 13. 暴露全局接口 ---
    window.drawViewB = drawViewB;
    window.updateVizB = updateVizB;
})();

