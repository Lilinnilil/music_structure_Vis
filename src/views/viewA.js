/**
 * View A: 全量曲目二维散点图
 * - X: avg_velocity
 * - Y: timbre_complexity
 * - Color: genre
 * - Size: harmonic_complexity
 * - Hover: 放大 + tooltip (title, artist, genre, duration)
 * - Click: 触发回调 onSelect(trackMeta)
 */

(function() {
    // 新配色方案：三种固定色（新版）
    const DEFAULT_COLORS = {
        Classical: "#7fc97f",
        Rock: "#beaed4",
        Minimalism: "#fdc086",
        default: "#7fc97f"
    };

    let cachedSelectionId = null;

    function getGenreColor(genre) {
        if (!genre) return DEFAULT_COLORS.default;
        const key = genre.trim();
        return DEFAULT_COLORS[key] || DEFAULT_COLORS.default;
    }

    function formatDuration(sec) {
        if (!isFinite(sec)) return "N/A";
        return Number(sec).toFixed(2);
    }

    function ensureTooltip() {
        let tooltip = d3.select("#viewA-tooltip");
        if (tooltip.empty()) {
            tooltip = d3.select("body")
                .append("div")
                .attr("id", "viewA-tooltip")
                .style("position", "absolute")
                .style("pointer-events", "none")
                .style("padding", "8px 10px")
                .style("background", "rgba(0,0,0,0.85)")
                .style("color", "#fff")
                .style("font-size", "12px")
                .style("border-radius", "4px")
                .style("box-shadow", "0 2px 8px rgba(0,0,0,0.5)")
                .style("display", "none");
        }
        return tooltip;
    }

    function drawViewA(tracks, containerSelector, options = {}) {
        const onSelect = typeof options.onSelect === "function" ? options.onSelect : () => {};
        const container = d3.select(containerSelector);
        if (container.empty()) return;

        const tooltip = ensureTooltip();
        cachedSelectionId = null;

        const width = container.node().clientWidth || 280;
        const height = container.node().clientHeight || 360;
        const margin = { top: 20, right: 20, bottom: 45, left: 55 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        container.selectAll("svg").remove();
        const svg = container.append("svg")
            .attr("width", width)
            .attr("height", height);
        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        const xExtent = d3.extent(tracks, d => d.avg_velocity || 0);
        const yExtent = d3.extent(tracks, d => d.timbre_complexity || 0);
        const sizeExtent = d3.extent(tracks, d => d.harmonic_complexity || 0);

        const xScale = d3.scaleLinear()
            .domain([Math.max(0, xExtent[0] || 0), Math.max(1, xExtent[1] || 1)])
            .nice()
            .range([0, innerW]);
        const yScale = d3.scaleLinear()
            .domain([Math.max(0, yExtent[0] || 0), Math.max(0.1, yExtent[1] || 0.1)])
            .nice()
            .range([innerH, 0]);
        const sizeScale = d3.scaleSqrt()
            .domain([Math.max(0, sizeExtent[0] || 0), Math.max(1, sizeExtent[1] || 1)])
            .range([6, 22]);

        const xAxis = d3.axisBottom(xScale).ticks(6);
        const yAxis = d3.axisLeft(yScale).ticks(6);

        g.append("g")
            .attr("transform", `translate(0, ${innerH})`)
            .attr("class", "axis axis-x")
            .call(xAxis)
            .call(g => g.append("text")
                .attr("fill", "#fff")
                .attr("x", innerW)
                .attr("y", 35)
                .attr("text-anchor", "end")
                .style("font-size", "12px")
                .text("Average velocity"));

        g.append("g")
            .attr("class", "axis axis-y")
            .call(yAxis)
            .call(g => g.append("text")
                .attr("fill", "#fff")
                .attr("x", 0)
                .attr("y", -12)
                .attr("text-anchor", "start")
                .style("font-size", "12px")
                .text("Timbre complexity"));

        g.append("g")
            .attr("class", "grid-x")
            .attr("transform", `translate(0, ${innerH})`)
            .call(d3.axisBottom(xScale).tickSize(-innerH).tickFormat(""))
            .selectAll("line")
            .attr("stroke", "rgba(255,255,255,0.06)");

        g.append("g")
            .attr("class", "grid-y")
            .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat(""))
            .selectAll("line")
            .attr("stroke", "rgba(255,255,255,0.06)");

        const dots = g.selectAll(".track-dot")
            .data(tracks, d => d.id || d.baseName)
            .join("circle")
            .attr("class", "track-dot")
            .attr("cx", d => xScale(d.avg_velocity || 0))
            .attr("cy", d => yScale(d.timbre_complexity || 0))
            .attr("r", d => sizeScale(d.harmonic_complexity || 0))
            .attr("fill", d => getGenreColor(d.genre))
            .attr("fill-opacity", 0.9)
            .attr("stroke", "#111")
            .attr("stroke-width", 1.2)
            .style("cursor", "pointer")
            .on("mouseenter", function(event, d) {
                d3.select(this).transition().duration(150).attr("r", sizeScale(d.harmonic_complexity || 0) * 1.15);
                tooltip.style("display", "block")
                    .html(`
                        <div><strong>${d.title || d.baseName || "Untitled"}</strong></div>
                        <div>Artist: ${d.artist || "Unknown"}</div>
                        <div>Genre: ${d.genre || "N/A"}</div>
                        <div>Duration: ${formatDuration(d.duration_sec)}s</div>
                    `);
            })
            .on("mousemove", function(event) {
                tooltip
                    .style("left", (event.pageX + 12) + "px")
                    .style("top", (event.pageY + 12) + "px");
            })
            .on("mouseleave", function(event, d) {
                const isSelected = cachedSelectionId === (d.id || d.baseName);
                d3.select(this).transition().duration(150).attr("r", sizeScale(d.harmonic_complexity || 0) * (isSelected ? 1.15 : 1));
                tooltip.style("display", "none");
            })
            .on("click", function(event, d) {
                cachedSelectionId = d.id || d.baseName;
                dots.classed("selected", t => (t.id || t.baseName) === cachedSelectionId)
                    .transition().duration(120)
                    .attr("stroke", t => (t.id || t.baseName) === cachedSelectionId ? "#fff" : "#111")
                    .attr("stroke-width", t => (t.id || t.baseName) === cachedSelectionId ? 2 : 1.2)
                    .attr("r", t => sizeScale(t.harmonic_complexity || 0) * ((t.id || t.baseName) === cachedSelectionId ? 1.15 : 1));
                onSelect(d);
            });

        // 1. 清除旧HTML图例
        // 1. 清除旧HTML图例
        d3.select('#view-A-container').selectAll('.viewA-legend-html').remove();
        // 2. 构建新HTML图例，插入A视图顶部右侧，Data标题下方
        // 查找Data标题h2
        const titleNode = d3.select('#view-A-container').select('h2.view-title').node();
        let legendDiv;
        if (titleNode) {
            legendDiv = d3.select(titleNode.parentNode)
                .insert('div', function() { return titleNode.nextSibling; })
                .attr('class', 'viewA-legend-html');
        } else {
            legendDiv = d3.select('#view-A-container')
                .insert('div', ':first-child')
                .attr('class', 'viewA-legend-html');
        }
        legendDiv
            .style('margin', '0 0 10px 0')
            .style('background', 'rgba(0,0,0,0.72)')
            .style('border-radius', '6px')
            .style('padding', '7px 14px 8px 12px')
            .style('box-shadow', '0 2px 8px rgba(0,0,0,0.18)')
            .style('display', 'inline-block')
            .style('font-size', '12px')
            .style('float', 'right');
        // 3. 颜色图例
        const legendData = Array.from(new Set(tracks.map(d => d.genre || "Other")));
        const colorRow = legendDiv.append('div').style('display', 'flex').style('gap', '16px').style('align-items', 'center');
        legendData.forEach(d => {
            const item = colorRow.append('div').style('display', 'flex').style('align-items', 'center').style('gap', '5px');
            item.append('span')
                .style('display', 'inline-block')
                .style('width', '12px')
                .style('height', '12px')
                .style('border-radius', '2px')
                .style('background', getGenreColor(d));
            item.append('span')
                .style('color', '#fff')
                .style('font-size', '12px')
                .text(d);
        });
        // 4. Size图例
        const sizeMin = sizeScale.domain()[0];
        const sizeMax = sizeScale.domain()[1];
        const legendSizes = [sizeMin, (sizeMin + sizeMax) / 2, sizeMax];
        // Harmonic Complexity标题，左对齐
        legendDiv.append('div')
            .style('text-align', 'left')
            .style('color', '#fff')
            .style('font-size', '11px')
            .style('margin', '7px 0 2px 0')
            .text('Harmonic Complexity');
        const sizeRow = legendDiv.append('div').style('display', 'flex').style('align-items', 'flex-end').style('gap', '12px');
        legendSizes.forEach((d, i) => {
            const group = sizeRow.append('div').style('display', 'flex').style('flex-direction', 'column').style('align-items', 'center');
            group.append('svg')
                .attr('width', sizeScale(sizeMax) * 1.1)
                .attr('height', sizeScale(sizeMax) * 1.1)
                .append('circle')
                .attr('cx', sizeScale(sizeMax) * 0.55)
                .attr('cy', sizeScale(sizeMax) * 0.55)
                .attr('r', sizeScale(d) * 0.55)
                .attr('fill', '#fff')
                .attr('fill-opacity', 0.18)
                .attr('stroke', '#fff')
                .attr('stroke-width', 1);
            group.append('span')
                .style('color', '#fff')
                .style('font-size', '10px')
                .style('margin-top', '2px')
                .text(i === 0 ? 'Low' : (i === 2 ? 'High' : 'Med'));
        });
    }

    // View A 不随时间更新，这里保留空实现以兼容 main.js 回调
    function updateVizA() {}

    window.drawViewA = drawViewA;
    window.updateVizA = updateVizA;
})();
