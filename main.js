const { Plugin } = require('obsidian');

// ======== 全局状态 ========
let activeViewer = null;

function closeViewer() {
    if (activeViewer) {
        const el = activeViewer.el;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        activeViewer.cleanups.forEach(fn => fn());
        activeViewer = null;
    }
}

function filenameFromSrc(src, alt) {
    if (alt && alt.trim()) return alt.trim();
    try {
        const url = new URL(src);
        const name = url.pathname.split('/').pop() || src.split('/').pop();
        return decodeURIComponent(name);
    } catch {
        return src.split('/').pop() || src;
    }
}

// ======== 插件主体 ========
class ImageViewerPlugin extends Plugin {
    async onload() {
        this.registerDomEvent(document, 'click', (e) => {
            const img = e.target.closest(
                '.markdown-reading-view img,' +
                '.markdown-source-view img,' +
                '.internal-embed.image-embed img,' +
                '.cm-editor img'
            );
            if (!img) return;
            // 跳过错题卡片（wrong-card）内的图片，让错题插件自己处理点击翻转
            if (img.closest('.wrong-card, .wrong-card-wrapper')) return;

            const notePane = e.target.closest(
                '.markdown-reading-view,' +
                '.markdown-source-view,' +
                '.cm-editor'
            );
            if (!notePane) return;
            if (img.closest('.image-viewer-overlay')) return;

            e.preventDefault();
            e.stopPropagation();

            const contentRoot = notePane.closest('.markdown-reading-view,.markdown-source-view') || notePane;
            const imageEls = Array.from(contentRoot.querySelectorAll('img'))
                .filter(i => i.src && !i.closest('.image-viewer-overlay'));
            const index = imageEls.indexOf(img);
            if (index === -1) return;

            this.openViewer(
                imageEls.map(i => ({ src: i.src, alt: i.alt || '' })),
                index
            );
        });
    }

    openViewer(imagesData, initialIndex) {
        closeViewer();
        if (!imagesData.length) return;

        const cleanups = [];
        const add = (el, type, fn, opts) => {
            el.addEventListener(type, fn, opts);
            cleanups.push(() => el.removeEventListener(type, fn));
        };

        // ----- 构建 DOM -----
        const overlay = document.createElement('div');
        overlay.className = 'image-viewer-overlay';
        overlay.innerHTML = `
            <div class="image-viewer-backdrop"></div>
            <div class="image-viewer-toolbar">
                <span class="image-viewer-counter"></span>
                <span class="image-viewer-zoom-level">100%</span>
                <button class="image-viewer-btn image-viewer-btn-close" title="关闭 (ESC)">✕</button>
            </div>
            <div class="image-viewer-container">
                <button class="image-viewer-nav image-viewer-nav-prev" title="上一张 (←)">‹</button>
                <div class="image-viewer-stage" style="touch-action:none">
                    <img class="image-viewer-image" alt="预览">
                </div>
                <button class="image-viewer-nav image-viewer-nav-next" title="下一张 (→)">›</button>
            </div>
            <div class="image-viewer-info">
                <span class="image-viewer-filename"></span>
            </div>
        `;
        document.body.appendChild(overlay);

        // ----- DOM 引用 -----
        const imgEl = overlay.querySelector('.image-viewer-image');
        const zoomEl = overlay.querySelector('.image-viewer-zoom-level');
        const filenameEl = overlay.querySelector('.image-viewer-filename');
        const counterEl = overlay.querySelector('.image-viewer-counter');
        const prevBtn = overlay.querySelector('.image-viewer-nav-prev');
        const nextBtn = overlay.querySelector('.image-viewer-nav-next');
        const closeBtn = overlay.querySelector('.image-viewer-btn-close');
        const backdrop = overlay.querySelector('.image-viewer-backdrop');
        const stage = overlay.querySelector('.image-viewer-stage');

        // ----- 状态 -----
        const state = {
            images: imagesData,
            index: initialIndex,
            scale: 1,
            panX: 0,
            panY: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            dragPanX: 0,
            dragPanY: 0,
        };

        // ----- 工具函数 -----
        function setTransform(smooth) {
            if (smooth) imgEl.classList.add('zooming');
            else imgEl.classList.remove('zooming');
            imgEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
        }

        function updateUI() {
            const img = state.images[state.index];
            imgEl.src = img.src;
            imgEl.alt = img.alt;
            filenameEl.textContent = filenameFromSrc(img.src, img.alt);
            counterEl.textContent = `${state.index + 1} / ${state.images.length}`;
            zoomEl.textContent = `${Math.round(state.scale * 100)}%`;
            prevBtn.classList.toggle('hidden', state.index <= 0);
            nextBtn.classList.toggle('hidden', state.index >= state.images.length - 1);
            setTransform();
        }

        function resetTransform() {
            state.scale = 1;
            state.panX = 0;
            state.panY = 0;
            setTransform();
            zoomEl.textContent = '100%';
        }

        function goTo(index) {
            if (index < 0 || index >= state.images.length) return;
            state.index = index;
            resetTransform();
            const img = state.images[state.index];
            imgEl.classList.remove('switching', 'entering');
            imgEl.src = img.src;
            imgEl.alt = img.alt;
            void imgEl.offsetWidth;
            imgEl.classList.add('switching');
            filenameEl.textContent = filenameFromSrc(img.src, img.alt);
            counterEl.textContent = `${state.index + 1} / ${state.images.length}`;
            prevBtn.classList.toggle('hidden', state.index <= 0);
            nextBtn.classList.toggle('hidden', state.index >= state.images.length - 1);
        }

        // ----- 初始化 -----
        (function init() {
            const img = state.images[state.index];
            imgEl.src = img.src;
            imgEl.alt = img.alt;
            filenameEl.textContent = filenameFromSrc(img.src, img.alt);
            counterEl.textContent = `${state.index + 1} / ${state.images.length}`;
            prevBtn.classList.toggle('hidden', state.index <= 0);
            nextBtn.classList.toggle('hidden', state.index >= state.images.length - 1);
            imgEl.classList.add('entering');
            const onEndEnter = () => { imgEl.classList.remove('entering'); imgEl.removeEventListener('animationend', onEndEnter); };
            imgEl.addEventListener('animationend', onEndEnter);
            zoomEl.textContent = '100%';
        })();

        // ============================================================
        //  事件绑定
        // ============================================================

        // 关闭
        add(closeBtn, 'click', (e) => { e.stopPropagation(); closeViewer(); });
        add(backdrop, 'click', () => closeViewer());

        // 键盘
        add(document, 'keydown', (e) => {
            switch (e.key) {
                case 'Escape': e.preventDefault(); closeViewer(); break;
                case 'ArrowLeft': e.preventDefault(); if (state.index > 0) goTo(state.index - 1); break;
                case 'ArrowRight': e.preventDefault(); if (state.index < state.images.length - 1) goTo(state.index + 1); break;
                case '+': case '=': e.preventDefault(); zoomIn(); break;
                case '-': case '_': e.preventDefault(); zoomOut(); break;
            }
        });

        // 滚轮缩放
        const zoomIn = () => zoomAt(1.25);
        const zoomOut = () => zoomAt(0.8);
        const zoomAt = (factor) => {
            const ns = Math.max(0.25, Math.min(10, state.scale * factor));
            if (ns === state.scale) return;
            state.scale = ns;
            setTransform(true);
            zoomEl.textContent = `${Math.round(state.scale * 100)}%`;
        };
        add(stage, 'wheel', (e) => {
            e.preventDefault();
            zoomAt(e.deltaY < 0 ? 1.15 : 0.87);
        }, { passive: false });

        // ---- 拖拽：Pointer Events API（比 mouse 事件更可靠） ----
        add(stage, 'pointerdown', (e) => {
            if (e.button !== 0) return;
            // 锁定指针到 stage，后续 pointermove/pointerup 无论鼠标在哪都发到 stage
            stage.setPointerCapture(e.pointerId);
            state.isDragging = true;
            state.dragStartX = e.clientX;
            state.dragStartY = e.clientY;
            state.dragPanX = state.panX;
            state.dragPanY = state.panY;
            stage.classList.add('dragging');
        });

        add(stage, 'pointermove', (e) => {
            if (!state.isDragging) return;
            state.panX = state.dragPanX + (e.clientX - state.dragStartX);
            state.panY = state.dragPanY + (e.clientY - state.dragStartY);
            imgEl.classList.remove('zooming');
            imgEl.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
        });

        add(stage, 'pointerup', (e) => {
            if (!state.isDragging) return;
            state.isDragging = false;
            stage.classList.remove('dragging');
            // 自动释放指针捕获
        });

        // 逃生门：鼠标离开 stage 也终止拖拽（防止指针捕获意外失效）
        add(stage, 'pointerleave', (e) => {
            if (!state.isDragging) return;
            state.isDragging = false;
            stage.classList.remove('dragging');
        });

        // 双击重置
        add(stage, 'dblclick', (e) => { e.preventDefault(); resetTransform(); });

        // 导航按钮
        add(prevBtn, 'click', (e) => { e.stopPropagation(); goTo(state.index - 1); });
        add(nextBtn, 'click', (e) => { e.stopPropagation(); goTo(state.index + 1); });

        // ---- 保存引用 ----
        activeViewer = { el: overlay, state, cleanups };
    }

    onunload() {
        closeViewer();
    }
}

module.exports = ImageViewerPlugin;
