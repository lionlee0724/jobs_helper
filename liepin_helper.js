// ==UserScript==
// @name         猎聘海投助手 (Unified)
// @namespace    https://github.com/yangshengzhou03
// @version      2.0.0
// @description  猎聘网自动投递工具，基于 Boss海投助手架构重构。功能：自动筛选、自动翻页、批量投递、日志监控。
// @author       Yangshengzhou / Refactored by Assistant
// @match        https://*.liepin.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @license      AGPL-3.0-or-later
// ==/UserScript==

(function () {
    'use strict';

    /**
     * 全局配置
     * @description 定义脚本的基础配置参数
     */
    const CONFIG = {
        // 基础间隔 (毫秒)
        BASIC_INTERVAL: 1500,
        // 操作间隔
        OPERATION_INTERVAL: 2000,
        // 详情页停留时间
        DETAIL_STAY_TIME: 3000,

        COLORS: {
            primary: '#ff6600', // 猎聘主色
            secondary: '#fff7f0',
            accent: '#ff8800',
            neutral: '#666666'
        },

        STORAGE_KEYS: {
            SETTINGS: 'lp_unified_settings',
            PROCESSED_JOBS: 'lp_processed_jobs',
            CURRENT_TASK: 'lp_current_task',
            STATS: 'lp_stats'
        },

        STORAGE_LIMITS: {
            PROCESSED_JOBS: 1000, // 记录最近1000个已投递职位ID
        }
    };

    /**
     * 日志级别定义
     * @description 为日志系统提供6个级别的配置，包括颜色和图标
     */
    const LOG_LEVEL = {
        DEBUG: { name: 'DEBUG', color: '#999', icon: '🔍' },
        INFO: { name: 'INFO', color: '#2196F3', icon: 'ℹ️' },
        SUCCESS: { name: 'SUCCESS', color: '#4CAF50', icon: '✅' },
        WARNING: { name: 'WARNING', color: '#FF9800', icon: '⚠️' },
        ERROR: { name: 'ERROR', color: '#F44336', icon: '❌' },
        SKIP: { name: 'SKIP', color: '#9E9E9E', icon: '⏭️' }
    };

    /**
     * 全局状态
     * @description 管理脚本运行时的状态变量
     */
    const state = {
        isRunning: false,
        isMinimized: false,
        currentIndex: 0,

        jobList: [], // 当前页的职位卡片列表

        stats: {
            success: 0,
            fail: 0,
            skip: 0
        },

        // 已处理的职位ID集合 (从Storage加载)
        processedJobs: new Set(),

        settings: {
            keywords: "",              // 职位名关键词
            locationKeywords: "",       // 地点关键词
            jobDescKeywords: "",        // 职位介绍关键字（新增）
            cityKeywords: "",           // 城市限定关键字（新增）
            excludeHeadhunters: false,  // 是否排除猎头
            autoCloseDetail: true,      // 投递后是否自动关闭
            actionDelays: {
                click: 500              // 点击延迟
            }
        },

        ui: {
            theme: 'light'
        }
    };

    /**
     * 核心工具类
     * @description 提供日志、延迟、通用DOM操作
     */
    const Core = {
        /**
         * 增强型日志方法
         * @description 支持6个级别的日志输出，带颜色和图标
         * @param {string} msg 日志内容
         * @param {string} level 日志级别 (DEBUG/INFO/SUCCESS/WARNING/ERROR/SKIP)
         */
        log(msg, level = 'INFO') {
            const time = new Date().toLocaleTimeString();
            const levelInfo = LOG_LEVEL[level] || LOG_LEVEL.INFO;
            const formattedMsg = `[${time}] ${levelInfo.icon} ${msg}`;

            console.log(`[猎聘助手] ${msg}`);

            // 详情页模式：写入共享存储，供列表页读取显示
            if (state.isDetailPage) {
                const sharedLogs = GM_getValue('lp_shared_logs', []);
                sharedLogs.push({ formattedMsg, color: levelInfo.color, time: Date.now() });
                // 保留最近50条
                if (sharedLogs.length > 50) sharedLogs.shift();
                GM_setValue('lp_shared_logs', sharedLogs);
                return;
            }

            // 列表页模式：直接写入UI浮窗
            if (UI && UI.logContainer) {
                const div = document.createElement('div');
                div.style.cssText = `
                    padding: 4px 8px;
                    color: ${levelInfo.color};
                    border-bottom: 1px solid #f0f0f0;
                    font-size: 12px;
                    line-height: 1.5;
                    margin-bottom: 2px;
                `;
                div.textContent = formattedMsg;
                UI.logContainer.appendChild(div);
                UI.logContainer.scrollTop = UI.logContainer.scrollHeight;
            }
        },

        /**
         * 导出日志到剪贴板
         */
        exportLogs() {
            if (UI && UI.logContainer) {
                const logs = UI.logContainer.innerText;
                navigator.clipboard.writeText(logs).then(() => {
                    Core.log('日志已复制到剪贴板', 'SUCCESS');
                }).catch(err => {
                    Core.log(`复制失败: ${err.message}`, 'ERROR');
                });
            }
        },

        /**
         * 清空日志
         */
        clearLogs() {
            if (UI && UI.logContainer) {
                UI.logContainer.innerHTML = '';
                Core.log('日志已清空', 'INFO');
            }
        },

        /**
         * 随机延迟
         * @param {number} ms 基础毫秒数
         * @returns {Promise}
         */
        async delay(ms) {
            const variance = ms * 0.2; // 20% 波动
            const actualMs = ms + (Math.random() * variance * 2 - variance);
            return new Promise(resolve => setTimeout(resolve, actualMs));
        },

        /**
         * 等待元素出现
         * @param {string} selector CSS选择器
         * @param {number} timeout 超时时间
         */
        async waitForElement(selector, timeout = 5000) {
            return new Promise(resolve => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);

                const start = Date.now();
                const timer = setInterval(() => {
                    const el = document.querySelector(selector);
                    if (el) {
                        clearInterval(timer);
                        resolve(el);
                    }
                    if (Date.now() - start > timeout) {
                        clearInterval(timer);
                        resolve(null);
                    }
                }, 100);
            });
        }
    };

    /**
     * 存储管理类
     * @description 封装localStorage操作，支持Set/Limit逻辑
     */
    class StorageManager {
        static get(key, defaultValue) {
            try {
                // 使用 GM_getValue 跨窗口共享
                const val = GM_getValue(key);
                return val ? (typeof val === 'string' ? JSON.parse(val) : val) : defaultValue;
            } catch (e) {
                console.error(`读取存储失败: ${key}`, e);
                return defaultValue;
            }
        }

        static set(key, value) {
            try {
                // 使用 GM_setValue 跨窗口共享
                GM_setValue(key, JSON.stringify(value));
            } catch (e) {
                console.error(`写入存储失败: ${key}`, e);
            }
        }

        /**
         * 加载设置与状态
         */
        static loadState() {
            // 加载设置
            const savedSettings = this.get(CONFIG.STORAGE_KEYS.SETTINGS, {});
            Object.assign(state.settings, savedSettings);

            // 加载已处理记录
            const processed = this.get(CONFIG.STORAGE_KEYS.PROCESSED_JOBS, []);
            state.processedJobs = new Set(processed);

            Core.log(`已加载 ${state.processedJobs.size} 条历史投递记录`);
        }

        /**
         * 保存设置
         */
        static saveSettings() {
            this.set(CONFIG.STORAGE_KEYS.SETTINGS, state.settings);
            Core.log("配置已保存");
        }

        /**
         * 添加已处理记录 (带容量限制)
         * @param {string} jobId 
         */
        static addProcessedJob(jobId) {
            if (state.processedJobs.has(jobId)) return;

            state.processedJobs.add(jobId);

            // 转换为数组保存，并检查长度限制
            let records = Array.from(state.processedJobs);
            if (records.length > CONFIG.STORAGE_LIMITS.PROCESSED_JOBS) {
                // 删除最早的 (简单的FIFO)
                records = records.slice(records.length - CONFIG.STORAGE_LIMITS.PROCESSED_JOBS);
                state.processedJobs = new Set(records);
            }

            this.set(CONFIG.STORAGE_KEYS.PROCESSED_JOBS, records);
        }
    }

    /**
     * UI 管理类
     * @description 负责创建和管理界面元素 (面板、按钮、日志窗口)
     */
    const UI = {
        panel: null,
        logContainer: null,

        init() {
            // 如果已有面板先移除
            const old = document.getElementById('lp-unified-panel');
            if (old) old.remove();

            this.createPanel();
            this.setupListeners();
        },

        createPanel() {
            const panel = document.createElement('div');
            panel.id = 'lp-unified-panel';

            // 从存储读取位置
            const panelState = GM_getValue('lp_panel_state', { top: 100, right: 20 });
            const posStyle = panelState.left
                ? `top: ${panelState.top}px; left: ${panelState.left}px;`
                : `top: ${panelState.top || 100}px; right: ${panelState.right || 20}px;`;

            panel.style.cssText = `
                position: fixed; ${posStyle} width: 320px;
                background: white; border-radius: 8px; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 999999; font-family: sans-serif;
                border: 1px solid ${CONFIG.COLORS.primary};
            `;

            // 1. 标题栏
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 12px; background: ${CONFIG.COLORS.primary}; color: white;
                font-weight: bold; border-radius: 8px 8px 0 0;
                display: flex; justify-content: space-between; align-items: center;
                cursor: move;
            `;

            // 图钉按钮和最小化按钮
            const pinBtn = document.createElement('span');
            pinBtn.id = 'lp-pin-btn';
            pinBtn.style.cssText = 'cursor:pointer; font-size:16px; margin-right:10px;';
            // 从存储读取固定状态
            const pinState = GM_getValue('lp_panel_state', { pinned: false });
            pinBtn.textContent = pinState.pinned ? '📌' : '📍';
            pinBtn.title = pinState.pinned ? '已固定（点击取消）' : '未固定（点击固定）';

            pinBtn.onclick = () => {
                const state = GM_getValue('lp_panel_state', { pinned: false });
                state.pinned = !state.pinned;
                GM_setValue('lp_panel_state', state);
                pinBtn.textContent = state.pinned ? '📌' : '📍';
                pinBtn.title = state.pinned ? '已固定（点击取消）' : '未固定（点击固定）';
                Core.log(state.pinned ? '浮窗已固定' : '浮窗已取消固定', 'INFO');
            };

            header.innerHTML = '<span>猎聘海投助手 2.0</span>';
            const headerBtnGroup = document.createElement('span');
            headerBtnGroup.append(pinBtn);
            const minBtn = document.createElement('span');
            minBtn.id = 'lp-min-btn';
            minBtn.style.cssText = 'cursor:pointer; font-size:18px;';
            minBtn.textContent = '—';
            headerBtnGroup.append(minBtn);
            header.append(headerBtnGroup);

            // 2. 内容区
            const content = document.createElement('div');
            content.id = 'lp-panel-content';
            content.style.padding = '15px';

            // 2.1 控制按钮组
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';
            btnGroup.style.marginBottom = '15px';

            const startBtn = this.createBtn('开始投递', CONFIG.COLORS.primary, 'lp-btn-start');
            const stopBtn = this.createBtn('停止', '#666', 'lp-btn-stop');

            btnGroup.append(startBtn, stopBtn);

            // 2.2 简单的设置输入
            const settingsArea = document.createElement('div');
            settingsArea.innerHTML = `
                <div style="margin-bottom:8px;">
                    <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">职位关键词:</label>
                    <input type="text" id="lp-input-keywords" value="${state.settings.keywords}" 
                        style="width:95%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="多个用逗号分隔">
                </div>
                <div style="margin-bottom:8px;">
                    <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">职位介绍关键字:</label>
                    <input type="text" id="lp-input-job-desc" value="${state.settings.jobDescKeywords || ''}" 
                        style="width:95%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="如: Python,数据分析">
                </div>
                <div style="margin-bottom:8px;">
                    <label style="font-size:12px; font-weight:bold; display:block; margin-bottom:4px;">城市限定:</label>
                    <input type="text" id="lp-input-city" value="${state.settings.cityKeywords || ''}" 
                        style="width:95%; padding:4px; border:1px solid #ddd; border-radius:4px;" placeholder="如: 北京,上海,深圳">
                </div>
                <div style="margin-bottom:8px;">
                     <label style="font-size:12px; font-weight:bold; cursor:pointer;">
                        <input type="checkbox" id="lp-check-hunter" ${state.settings.excludeHeadhunters ? 'checked' : ''}>
                        排除猎头职位
                     </label>
                </div>
                 <div style="margin-bottom:8px;">
                     <label style="font-size:12px; font-weight:bold; cursor:pointer;">
                        <input type="checkbox" id="lp-check-close" ${state.settings.autoCloseDetail ? 'checked' : ''}>
                        投递后自动关闭详情页
                     </label>
                </div>
                <div style="display:flex; gap:5px; margin-top:10px;">
                    <button id="lp-btn-export-log" style="flex:1; padding:6px; background:#2196F3; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px;">导出日志</button>
                    <button id="lp-btn-clear-log" style="flex:1; padding:6px; background:#FF9800; color:white; border:none; border-radius:4px; cursor:pointer; font-size:11px;">清空日志</button>
                </div>
            `;

            // 2.3 日志区
            this.logContainer = document.createElement('div');
            this.logContainer.style.cssText = `
                height: 200px; overflow-y: auto; background: #f9f9f9;
                border: 1px solid #eee; padding: 8px; font-size: 12px; color: #333;
                border-radius: 4px; margin-top: 10px;
            `;

            // 底部版权
            const footer = document.createElement('div');
            footer.style.textAlign = 'center';
            footer.style.fontSize = '10px';
            footer.style.color = '#999';
            footer.style.marginTop = '10px';
            footer.innerText = '© Unified Version';

            content.append(btnGroup, settingsArea, this.logContainer, footer);
            panel.append(header, content);
            document.body.appendChild(panel);

            this.panel = panel;
            this.makeDraggable(panel, header);
        },

        createBtn(text, bgColor, id) {
            const btn = document.createElement('button');
            btn.id = id;
            btn.textContent = text;
            btn.style.cssText = `
                flex: 1; padding: 8px; background: ${bgColor}; color: white;
                border: none; border-radius: 4px; cursor: pointer; font-weight: bold;
                transition: opacity 0.2s;
            `;
            btn.onmouseover = () => btn.style.opacity = 0.8;
            btn.onmouseout = () => btn.style.opacity = 1;
            return btn;
        },

        log(msg) {
            if (!this.logContainer) return;
            const div = document.createElement('div');
            div.textContent = msg;
            div.style.marginBottom = '4px';
            div.style.borderBottom = '1px dashed #eee';
            this.logContainer.appendChild(div);
            // 自动滚动到底部
            this.logContainer.scrollTop = this.logContainer.scrollHeight;
        },

        updateBtnState(isRunning) {
            const startBtn = document.getElementById('lp-btn-start');
            if (startBtn) {
                startBtn.textContent = isRunning ? '运行中...' : '开始投递';
                startBtn.disabled = isRunning;
                startBtn.style.background = isRunning ? '#ccc' : CONFIG.COLORS.primary;
            }
        },

        makeDraggable(panel, handle, storageKey = 'lp_panel_state') {
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            handle.addEventListener('mousedown', e => {
                // 检查是否固定
                const panelState = GM_getValue(storageKey, { pinned: false });
                if (panelState.pinned) {
                    return; // 固定状态下不允许拖动
                }
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialLeft = panel.offsetLeft;
                initialTop = panel.offsetTop;
                handle.style.cursor = 'grabbing';
            });

            document.addEventListener('mousemove', e => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                panel.style.left = `${initialLeft + dx}px`;
                panel.style.top = `${initialTop + dy}px`;
                panel.style.right = 'auto'; // 清除right属性以允许自由移动
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    // 保存位置到存储
                    const panelState = GM_getValue(storageKey, {});
                    panelState.top = panel.offsetTop;
                    panelState.left = panel.offsetLeft;
                    GM_setValue(storageKey, panelState);
                }
                isDragging = false;
                handle.style.cursor = 'move';
            });
        },

        setupListeners() {
            // 最小化
            document.getElementById('lp-min-btn').onclick = () => {
                const content = document.getElementById('lp-panel-content');
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                } else {
                    content.style.display = 'none';
                }
            };

            // 设置变更监听
            document.getElementById('lp-input-keywords').onchange = (e) => {
                state.settings.keywords = e.target.value;
                StorageManager.saveSettings();
            };
            // 新增：职位介绍关键字
            document.getElementById('lp-input-job-desc').onchange = (e) => {
                state.settings.jobDescKeywords = e.target.value;
                StorageManager.saveSettings();
                Core.log(`职位介绍关键字已更新: ${e.target.value}`, 'INFO');
            };
            // 新增：城市关键字
            document.getElementById('lp-input-city').onchange = (e) => {
                state.settings.cityKeywords = e.target.value;
                StorageManager.saveSettings();
                Core.log(`城市关键字已更新: ${e.target.value}`, 'INFO');
            };
            document.getElementById('lp-check-hunter').onchange = (e) => {
                state.settings.excludeHeadhunters = e.target.checked;
                StorageManager.saveSettings();
            };
            document.getElementById('lp-check-close').onchange = (e) => {
                state.settings.autoCloseDetail = e.target.checked;
                StorageManager.saveSettings();
            };

            // 新增：日志操作按钮
            document.getElementById('lp-btn-export-log').onclick = () => {
                Core.exportLogs();
            };
            document.getElementById('lp-btn-clear-log').onclick = () => {
                Core.clearLogs();
            };

            // 按钮事件
            document.getElementById('lp-btn-start').onclick = () => JobManager.startLoop();
            document.getElementById('lp-btn-stop').onclick = () => JobManager.stopLoop();
        }
    };

    /**
     * 职位交互管理器
     * @description 处理核心业务逻辑：列表遍历、详情页投递
     */
    const JobManager = {
        /**
         * 启动主循环
         */
        async startLoop() {
            if (state.isRunning) return;
            state.isRunning = true;
            UI.updateBtnState(true);
            Core.log(">>> 任务启动");

            try {
                // 仅在列表页执行主循环
                if (this.isListPage()) {
                    await this.processListPage();
                } else {
                    Core.log("请前往猎聘职位列表页运行此脚本");
                    this.stopLoop();
                }
            } catch (error) {
                Core.log(`运行出错: ${error.message}`);
                console.error(error);
                this.stopLoop();
            }
        },

        stopLoop() {
            state.isRunning = false;
            UI.updateBtnState(false);
            Core.log(">>> 任务停止");
        },

        isListPage() {
            // 排除详情页
            if (location.href.includes('/job/') || location.href.includes('/a/')) return false;

            // 宽松的 URL 检查
            const urlMatch = /zhaopin|job|search|sojob|city/i.test(location.href);

            // 增强的 DOM 检查
            const domMatch = document.querySelector('.job-list-item') ||
                document.querySelector('.sojob-item-main') ||
                document.querySelector('[data-selector="job-card"]') ||
                document.querySelector('.job-card-pc-container') ||
                document.querySelector('.job-list-box'); // 猜测的新容器名

            return !!(urlMatch || domMatch);
        },

        async processListPage() {
            while (state.isRunning) {
                const jobCards = this.getJobCards();
                if (jobCards.length === 0) {
                    Core.log("未检测到职位卡片，尝试翻页或等待...");
                    await Core.delay(3000);
                    // 尝试翻页逻辑 (如果需要)
                    continue;
                }

                Core.log(`本页共发现 ${jobCards.length} 个职位`);

                for (let card of jobCards) {
                    if (!state.isRunning) break;

                    // 1. 解析卡片信息
                    const jobInfo = this.extractJobInfo(card);
                    if (!jobInfo.id) continue;

                    // 2. 过滤逻辑
                    if (state.processedJobs.has(jobInfo.id)) {
                        // Core.log(`跳过已投递: ${jobInfo.title}`);
                        continue;
                    }

                    if (this.shouldSkip(jobInfo)) continue;

                    // 3. 执行投递 (打开详情页)
                    await this.processSingleJob(jobInfo, card);

                    // 4. 操作间隔
                    await Core.delay(CONFIG.OPERATION_INTERVAL);
                }

                // 本页处理完，翻页
                if (state.isRunning) {
                    const hasNext = await this.goToNextPage();
                    if (!hasNext) {
                        Core.log("没有下一页了，任务结束");
                        this.stopLoop();
                        break;
                    }
                    await Core.delay(5000); // 等待下一页已加载
                }
            }
        },

        getJobCards() {
            // 兼容多种页面结构
            return Array.from(document.querySelectorAll('.job-list-item, .sojob-item-main, [data-selector="job-card"]'));
        },

        /**
         * 提取职位信息
         * @param {HTMLElement} card 
         */
        extractJobInfo(card) {
            // 2. 标题提取
            const titleSelectors = [
                '.job-title',
                '.job-name',
                '.title-text',
                '.subscribe-job-title',
                '.job-title-box',
                '.job-detail-box > div:first-child',
                '[data-selector="job-title"]',
                '.ellipsis-1', // 猎聘常用截断类名
                'h3', // 猎聘新版可能是 h3
                '.job-card-pc-container .job-title' // 针对特定容器
            ];

            let titleEl = null;
            for (let sel of titleSelectors) {
                titleEl = card.querySelector(sel);
                if (titleEl) break;
            }

            let title = titleEl ? titleEl.innerText.trim() : "";

            // 链接提取
            const linkEl = card.querySelector('a[href*="/job/"], a[href*="/a/"], a[data-selector="job-card-link"]');

            // 补救措施：如果没找到标题元素，但找到了链接，通常链接文字就是标题
            if (!title && linkEl) {
                // 排除包含 "立即沟通" 这种按钮链接
                if (!linkEl.innerText.includes("沟通") && !linkEl.innerText.includes("查看")) {
                    title = linkEl.innerText.trim();
                } else {
                    title = linkEl.getAttribute('title') || "";
                }
            }

            // 3. 公司提取
            const companySelectors = [
                '.company-name',
                '.company-text',
                '.job-company-name',
                '[data-selector="comp-name"]',
                '.company-info',
                '.company-name-box',
                'h4'
            ];

            let companyEl = null;
            for (let sel of companySelectors) {
                companyEl = card.querySelector(sel);
                if (companyEl) break;
            }
            let company = companyEl ? companyEl.innerText.trim() : "未知公司";

            // 4. 地点提取
            const locSelectors = [
                '.job-dq-box',
                '.area',
                '.job-area',
                '.job-address',
                '[data-selector="job-dq"]',
                '.area-text',
                '.job-labels-box .labels-tag',
                '.ellipsis-1'
            ];

            let locEl = null;
            // 优先找特定的地点容器
            for (let sel of locSelectors) {
                const els = card.querySelectorAll(sel);
                for (let el of els) {
                    if (el !== titleEl && el !== companyEl) {
                        // 简单的启发式：地点通常比较短
                        if (el.innerText.length < 20) {
                            locEl = el;
                            break;
                        }
                    }
                }
                if (locEl) break;
            }
            let location = locEl ? locEl.innerText.trim() : "";

            // 猎头标记
            const isHeadhunter = !!card.querySelector('img[alt="猎头"], .hunt-tag');

            const link = linkEl ? linkEl.href : '';
            const id = link || (title + company);

            if (!title) {
                Core.log(`[调试] 警告: 未能提取到职位标题, Card Text: ${card.innerText.substring(0, 50)}...`);
            }

            return {
                id,
                title,
                company,
                location,
                link,
                isHeadhunter
            };
        },

        /**
         * 过滤判断
         */
        shouldSkip(jobInfo) {
            // 关键词过滤
            if (state.settings.keywords) {
                const keys = state.settings.keywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
                if (keys.length > 0) {
                    // 查找匹配的关键字
                    const matchedKey = keys.find(k => jobInfo.title.includes(k) || jobInfo.company.includes(k));
                    if (!matchedKey) {
                        Core.log(`跳过: 职位关键词不匹配 (${jobInfo.title})`, 'SKIP');
                        return true;
                    }
                    // 显示匹配到的关键字
                    const matchSource = jobInfo.title.includes(matchedKey) ? '职位名' : '公司名';
                    Core.log(`✅ ${matchSource}匹配关键字【${matchedKey}】: ${jobInfo.title}`, 'DEBUG');
                    jobInfo.matchedKeyword = matchedKey;
                    jobInfo.matchSource = matchSource;
                }
            }

            // 城市关键字过滤
            if (state.settings.cityKeywords) {
                const cities = state.settings.cityKeywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
                if (cities.length > 0) {
                    const matchedCity = cities.find(city => jobInfo.location.includes(city));
                    if (!matchedCity) {
                        Core.log(`跳过: 城市不匹配 (${jobInfo.location}) - ${jobInfo.title}`, 'SKIP');
                        return true;
                    }
                    // 显示匹配到的城市
                    Core.log(`✅ 城市匹配关键字【${matchedCity}】: ${jobInfo.location} - ${jobInfo.title}`, 'DEBUG');
                    jobInfo.matchedCity = matchedCity;
                }
            }

            // 猎头过滤
            if (state.settings.excludeHeadhunters && jobInfo.isHeadhunter) {
                Core.log(`跳过猎头职位: ${jobInfo.title}`, 'SKIP');
                StorageManager.addProcessedJob(jobInfo.id);
                return true;
            }

            return false;
        },

        async processSingleJob(jobInfo, cardElement) {
            Core.log(`准备投递: ${jobInfo.title} @ ${jobInfo.company}`);

            // 高亮卡片
            if (cardElement) {
                cardElement.style.border = `2px solid ${CONFIG.COLORS.primary}`;
                cardElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }

            // 标记为处理中
            state.processedJobs.add(jobInfo.id);

            // 使用 GM_setValue 通信模式
            const task = {
                url: jobInfo.link,
                status: 'pending',
                timestamp: Date.now(),
                // 保存列表页匹配信息
                matchedKeyword: jobInfo.matchedKeyword || '',
                matchedCity: jobInfo.matchedCity || '',
                matchSource: jobInfo.matchSource || '',
                title: jobInfo.title,
                company: jobInfo.company
            };
            GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));

            // 后台打开页面（不切换焦点）
            const win = GM_openInTab(jobInfo.link, { active: false, insert: true, setParent: true });
            if (!win) {
                Core.log("无法打开新窗口，可能被浏览器拦截", 'ERROR');
                return;
            }

            // 轮询等待结果
            const result = await this.waitForTaskResult(jobInfo.link, win);

            if (result === 'success') {
                // 显示匹配摘要
                let matchSummary = '▶️ 匹配摘要: ';
                const matchDetails = [];
                if (jobInfo.matchedKeyword) matchDetails.push(`职位关键字【${jobInfo.matchedKeyword}】`);
                if (jobInfo.matchedCity) matchDetails.push(`城市【${jobInfo.matchedCity}】`);
                // 读取详情页保存的职位介绍匹配信息
                try {
                    const taskData = JSON.parse(GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, '{}'));
                    if (taskData.matchedJobDescKeyword) matchDetails.push(`职位介绍【${taskData.matchedJobDescKeyword}】`);
                } catch (e) { }
                if (matchDetails.length > 0) {
                    matchSummary += matchDetails.join(' + ');
                    Core.log(matchSummary, 'SUCCESS');
                }
                Core.log("投递成功", 'SUCCESS');
                state.stats.success++;
                StorageManager.addProcessedJob(jobInfo.id);
            } else if (result === 'fail') {
                Core.log("投递失败或无按钮", 'ERROR');
                state.stats.fail++;
            } else if (result === 'skip') {
                Core.log("职位介绍不匹配，已跳过", 'SKIP');
                state.stats.skip++;
            } else {
                Core.log("投递操作超时", 'WARNING');
                state.stats.fail++;
            }
        },

        async waitForTaskResult(url, winHandle) {
            let lastLogTime = 0; // 记录上次读取的日志时间

            return new Promise(resolve => {
                let checks = 0;
                const maxChecks = 30; // 30秒超时

                const timer = setInterval(() => {
                    checks++;

                    // 读取并显示详情页的共享日志
                    const sharedLogs = GM_getValue('lp_shared_logs', []);
                    sharedLogs.forEach(log => {
                        if (log.time > lastLogTime) {
                            // 显示新日志
                            if (UI && UI.logContainer) {
                                const div = document.createElement('div');
                                div.style.cssText = `
                                    padding: 4px 8px;
                                    color: ${log.color};
                                    border-bottom: 1px solid #f0f0f0;
                                    font-size: 12px;
                                    line-height: 1.5;
                                    margin-bottom: 2px;
                                `;
                                div.textContent = log.formattedMsg;
                                UI.logContainer.appendChild(div);
                                UI.logContainer.scrollTop = UI.logContainer.scrollHeight;
                            }
                            lastLogTime = log.time;
                        }
                    });

                    // 检查窗口是否已关闭
                    if (winHandle.closed) {
                        clearInterval(timer);
                        GM_setValue('lp_shared_logs', []); // 清空共享日志
                        resolve('closed');
                        return;
                    }

                    // 读取状态
                    const taskStr = GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_TASK);
                    if (taskStr) {
                        const task = JSON.parse(taskStr);
                        // 简单模糊匹配，因为 URL 可能有变化
                        const normalize = u => u.split('?')[0];
                        if (normalize(task.url) === normalize(url) && task.status !== 'pending') {
                            clearInterval(timer);
                            GM_setValue('lp_shared_logs', []); // 清空共享日志
                            resolve(task.status);
                            return;
                        }
                    }

                    if (checks >= maxChecks) {
                        clearInterval(timer);
                        winHandle.close();
                        GM_setValue('lp_shared_logs', []); // 清空共享日志
                        resolve('timeout');
                    }
                }, 1000);
            });
        },

        async goToNextPage() {
            // 记录当前职位数量
            const currentJobCount = document.querySelectorAll('li.job-card-box').length ||
                document.querySelectorAll('.job-list-item').length ||
                document.querySelectorAll('[class*="job-card"]').length;

            // 方法1：尝试无限滚动加载
            const scrollContainer = document.documentElement || document.body;
            const previousScrollHeight = scrollContainer.scrollHeight;

            // 滚动到页面底部
            window.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });

            // 等待加载新内容
            await Core.delay(2000);

            // 检查是否有新内容加载
            const newJobCount = document.querySelectorAll('li.job-card-box').length ||
                document.querySelectorAll('.job-list-item').length ||
                document.querySelectorAll('[class*="job-card"]').length;

            if (newJobCount > currentJobCount) {
                Core.log(`滚动加载成功，新增 ${newJobCount - currentJobCount} 个职位`);
                return true;
            }

            // 检查页面高度是否变化
            if (scrollContainer.scrollHeight > previousScrollHeight) {
                Core.log("滚动加载成功（页面高度增加）");
                return true;
            }

            // 方法2：尝试分页按钮
            const selectors = [
                '.ant-pagination-next:not([aria-disabled="true"])',
                '.pager .next:not(.disabled)',
                '.rc-pagination-next:not([aria-disabled="true"])',
                'li[title="Next Page"]:not([aria-disabled="true"])',
                '.el-pagination .btn-next:not(:disabled)',
                '.next-page-btn'
            ];

            for (let s of selectors) {
                const btn = document.querySelector(s);
                if (btn && btn.offsetParent !== null && !btn.classList.contains('disabled')) {
                    Core.log("正在翻页...");
                    btn.click();
                    return true;
                }
            }

            // 针对 Ant Design 的特殊禁用检测
            const antNextLi = document.querySelector('.ant-pagination-next');
            if (antNextLi && !antNextLi.classList.contains('ant-pagination-disabled')) {
                Core.log("正在翻页 (Ant)...");
                antNextLi.click();
                return true;
            }

            return false;
        }
    };

    /**
     * 详情页逻辑 (运行在子窗口)
     */
    const DetailManager = {
        init() {
            // 设置为详情页模式（日志写入共享存储，不创建浮窗）
            state.isDetailPage = true;

            // 检查是否有任务
            const taskStr = GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_TASK);
            if (!taskStr) return;

            const task = JSON.parse(taskStr);
            // 简单校验 URL 是否匹配
            if (!location.href.includes(task.url.split('?')[0]) && !task.url.includes(location.pathname)) {
                return; // 不是当前任务页面
            }

            if (task.status !== 'pending') return;

            this.runAutoApply(task);
        },

        /**
         * 创建详情页日志浮窗
         */
        createDetailLogPanel() {
            const STORAGE_KEY = 'lp_detail_panel_state';

            // 从存储读取位置
            const panelState = GM_getValue(STORAGE_KEY, { top: 10, right: 10 });
            const posStyle = panelState.left
                ? `top: ${panelState.top}px; left: ${panelState.left}px;`
                : `top: ${panelState.top || 10}px; right: ${panelState.right || 10}px;`;

            const panel = document.createElement('div');
            panel.id = 'lp-detail-log-panel';
            panel.style.cssText = `
                position: fixed;
                ${posStyle}
                width: 350px;
                max-height: 250px;
                background: rgba(255,255,255,0.95);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: 999999;
                font-family: sans-serif;
                border: 2px solid ${CONFIG.COLORS.primary};
                overflow: hidden;
            `;

            // 标题栏
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 8px 12px;
                background: ${CONFIG.COLORS.primary};
                color: white;
                font-weight: bold;
                font-size: 13px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
            `;

            // 图钉按钮
            const pinBtn = document.createElement('span');
            pinBtn.style.cssText = 'cursor:pointer; font-size:14px;';
            const pinState = GM_getValue(STORAGE_KEY, { pinned: false });
            pinBtn.textContent = pinState.pinned ? '📌' : '📍';
            pinBtn.title = pinState.pinned ? '已固定（点击取消）' : '未固定（点击固定）';

            pinBtn.onclick = (e) => {
                e.stopPropagation();
                const state = GM_getValue(STORAGE_KEY, { pinned: false });
                state.pinned = !state.pinned;
                GM_setValue(STORAGE_KEY, state);
                pinBtn.textContent = state.pinned ? '📌' : '📍';
                pinBtn.title = state.pinned ? '已固定（点击取消）' : '未固定（点击固定）';
                Core.log(state.pinned ? '浮窗已固定' : '浮窗已取消固定', 'INFO');
            };

            header.innerHTML = '<span>📝 猎聘助手 - 详情页日志</span>';
            header.appendChild(pinBtn);

            // 日志容器
            const logContainer = document.createElement('div');
            logContainer.style.cssText = `
                padding: 8px;
                max-height: 200px;
                overflow-y: auto;
                font-size: 12px;
            `;

            panel.appendChild(header);
            panel.appendChild(logContainer);
            document.body.appendChild(panel);

            // 绑定到UI.logContainer，让Core.log能输出到这里
            UI.logContainer = logContainer;

            // 添加拖拽功能
            UI.makeDraggable(panel, header, STORAGE_KEY);

            Core.log('详情页日志浮窗已创建', 'DEBUG');
        },

        async runAutoApply(task) {
            this.showStatus("海投助手: 正在自动投递...");
            await Core.delay(CONFIG.DETAIL_STAY_TIME);

            // 职位介绍关键字筛选
            Core.log(`[调试] 职位介绍关键字设置: "${state.settings.jobDescKeywords || '未设置'}"`, 'DEBUG');
            if (state.settings.jobDescKeywords) {
                const keywords = state.settings.jobDescKeywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
                if (keywords.length > 0) {
                    const jobDesc = this.getJobDescription();
                    Core.log(`[调试] 获取到职位介绍: ${jobDesc ? jobDesc.length + '字' : '失败'}`, 'DEBUG');
                    if (jobDesc) {
                        // 查找匹配的关键字
                        const matchedKeyword = keywords.find(kw => jobDesc.includes(kw));
                        if (!matchedKeyword) {
                            Core.log('跳过: 职位介绍不匹配关键字，跳过投递', 'SKIP');
                            this.showStatus("职位介绍不符合，已跳过");
                            task.status = 'skip';
                            GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));
                            await Core.delay(1500);
                            if (state.settings.autoCloseDetail) { window.close(); }
                            return;
                        }
                        Core.log(`✅ 职位介绍匹配关键字【${matchedKeyword}】`, 'SUCCESS');
                        task.matchedJobDescKeyword = matchedKeyword;
                        // 立即保存到GM存储，让列表页能读取到
                        GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));
                    }
                }
            } else {
                Core.log('[调试] 未设置职位介绍关键字，跳过筛选', 'DEBUG');
            }

            const applyBtn = this.findApplyButton();
            if (applyBtn) {
                // 显示匹配摘要
                let matchSummary = '▶️ 匹配摘要: ';
                const matchDetails = [];
                if (task.matchedKeyword) matchDetails.push(`职位关键字【${task.matchedKeyword}】`);
                if (task.matchedCity) matchDetails.push(`城市【${task.matchedCity}】`);
                if (task.matchedJobDescKeyword) matchDetails.push(`职位介绍【${task.matchedJobDescKeyword}】`);
                if (matchDetails.length > 0) {
                    matchSummary += matchDetails.join(' + ');
                    Core.log(matchSummary, 'INFO');
                }

                Core.log('正在点击投递按钮...', 'INFO');
                applyBtn.click();
                await Core.delay(1000);
                const confirmBtn = document.querySelector('.ant-modal .ant-btn-primary');
                if (confirmBtn) confirmBtn.click();
                this.showStatus("投递成功! 即将关闭...");
                task.status = 'success';
                GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));
                Core.log('投递成功', 'SUCCESS');
                await Core.delay(1500);
                if (state.settings.autoCloseDetail) { window.close(); }
            } else {
                this.showStatus("未找到投递按钮");
                Core.log('未找到投递按钮', 'ERROR');
                task.status = 'fail';
                GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));
            }
        },

        getJobDescription() {
            try {
                const selectors = ['.job-intro-container', '.content-word', '[class*="job-detail"]'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText && el.innerText.length > 20) {
                        Core.log(`获取职位介绍: ${el.innerText.length}字`, 'DEBUG');
                        return el.innerText.trim();
                    }
                }
                return '';
            } catch (e) {
                Core.log(`获取职位介绍失败: ${e.message}`, 'ERROR');
                return '';
            }
        },

        findApplyButton() {
            // 策略1: 包含特定文本的按钮
            const buttons = Array.from(document.querySelectorAll('a, button'));
            const target = buttons.find(b => {
                const t = b.innerText.trim();
                return (t.includes('立即沟通') || t.includes('立即应聘') || t.includes('聊一聊')) && !t.includes('已');
            });
            return target;
        },

        showStatus(msg) {
            let tip = document.getElementById('lp-detail-tip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'lp-detail-tip';
                tip.style.cssText = `
                    position: fixed; top: 20px; right: 20px; padding: 10px 20px;
                    background: ${CONFIG.COLORS.primary}; color: white; border-radius: 4px;
                    z-index: 999999; font-weight: bold;
                `;
                document.body.appendChild(tip);
            }
            tip.innerText = msg;
        }
    };

    // === 主入口 ===
    (function main() {
        console.log("Unified Liepin Helper Loaded");
        StorageManager.loadState();

        // 注册菜单命令 (即使自动检测失败也能手动挽救)
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand("打开控制面板", () => {
                UI.init();
                Core.log("用户手动触发面板显示");
            });
        }

        let initialized = false;

        const checkAndInit = () => {
            if (initialized) return;

            if (JobManager.isListPage()) {
                Core.log("检测到职位列表页，初始化 UI...");
                UI.init();
                initialized = true;
            } else if (location.href.includes('/job/') || location.href.includes('/a/')) {
                Core.log("检测到职位详情页，初始化...");
                // 先加载settings，确保 jobDescKeywords 可用
                StorageManager.loadState();
                DetailManager.init();
                initialized = true;
            }
        };

        // 1. 立即检查
        checkAndInit();

        // 2. 监听动态加载 (MutationObserver)
        const observer = new MutationObserver((mutations) => {
            if (!initialized) {
                checkAndInit();
            }
        });

        // 观察 body 变化
        observer.observe(document.body, { childList: true, subtree: true });

        // 3. 兜底定时器 (3秒和6秒再次检查)
        setTimeout(checkAndInit, 3000);
        setTimeout(checkAndInit, 6000);

    })();

})();
