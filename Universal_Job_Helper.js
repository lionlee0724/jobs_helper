// ==UserScript==
// @name         招聘助手 (Universal Job Helper)
// @namespace    http://tampermonkey.net/
// @version      3.1.0
// @description  自动化 BOSS直聘 和 猎聘 的求职投递，支持 AI 自动回复
// @author       JobHelper Team
// @match        https://www.zhipin.com/*
// @match        https://www.liepin.com/*
// @match        https://c.liepin.com/*
// @match        https://*.liepin.com/*
// @match        https://*.zhipin.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    


    // 1. 常量定义 (Constants)
    // =================================================================

    const CONFIG = {
        // For compatibility with existing code, some values are top-level
        BASIC_INTERVAL: 1000,
        OPERATION_INTERVAL: 1200,

        TIME: {
            BASIC_INTERVAL: 1000,
            OPERATION_INTERVAL: 1200,
            DETAIL_STAY_TIME: 3000,
            ELEMENT_WAIT_TIMEOUT: 10000,
            TASK_TIMEOUT: 60000
        },
        DELAYS: {
            SHORT: 30,
            MEDIUM_SHORT: 200,
            LONG: 2000
        },
        LIMITS: {
            STORAGE_RECORDS: 500,
            DAILY_LIMIT: 200,
            MAX_RETRIES: 3,
            LOG_HISTORY: 100
        },
        UI: {
            PANEL_WIDTH: 320,
            PANEL_HEIGHT: 600,
            LOG_HEIGHT: 200,
            MINI_ICON_SIZE: 40
        },
        COLORS: {
            primary: '#4285f4', // 默认蓝色 (Boss)
            secondary: '#f5f7fa',
            accent: '#e8f0fe',
            neutral: '#6b7280',
            success: '#4CAF50',
            warning: '#FF9800',
            error: '#F44336'
        },
        STORAGE_KEYS: {
            SETTINGS: "ujh_settings",
            GLOBAL_STATS: "ujh_stats",
            PREFIX_BOSS: "boss_",
            PREFIX_LIEPIN: "lp_"
        },
        PLATFORM: {
            BOSS: 'boss',
            LIEPIN: 'liepin',
            UNKNOWN: 'unknown'
        }
    };

    /**
     * DOM选择器常量
     */
    const SELECTORS = {
        // BOSS直聘
        BOSS: {
            JOB_CARDS: 'li.job-card-box',
            JOB_TITLE: '.job-name',
            COMPANY_NAME: '.company-name, .job-company',
            LOCATION: '.job-address-desc, .company-location, .job-area',
            HEADHUNTER_TAG: '.job-tag-icon',
            CHAT_BUTTON: 'a.op-btn-chat',
            GREETING_MODAL: '.default-btn.cancel-btn',
            CHAT_CONTAINER: '.chat-message .im-list',
            FRIEND_MESSAGES: 'li.message-item.item-friend',
            RESUME_BUTTON: '.toolbar-btn',
            CONFIRM_BUTTON: '.btn-sure-v2'
        },

        // 猎聘
        LIEPIN: {
            JOB_CARDS: '.job-list-item, .sojob-item-main, [data-selector="job-card"], div[data-nick="job-detail-card"]',
            JOB_TITLE: 'h3, .job-title, [data-selector="job-title"], .job-name',
            COMPANY_NAME: '.company-name, .job-company, [data-selector="company-name"]',
            LOCATION: '.job-area, .job-location, .job-dq',
            HEADHUNTER_TAG: 'img[alt="猎头"], .hunt-tag',
            // Update: Added more button selectors based on recent site changes
            CHAT_BUTTON: 'a.btn-chat, a.btn-main, a.btn-apply-job, button.btn-chat, .btn-apply, [data-selector="link-chat"]',
            APPLY_BUTTON: 'a.btn-apply, a.btn-apply-job, button.btn-apply',
            CONFIRM_MODAL: '.ant-modal button, .ant-modal a, .dialog-footer .btn-primary',
            SUCCESS_PAGE: '.apply-success, .success-page, .apply-result, .apply-state-box'
        },

        // 通用UI
        UI: {
            PANEL: '#ujh-panel',
            CONTENT: '#ujh-content',
            LOG_PANEL: '#ujh-log',
            START_BUTTON: (platform) => `#${platform}-start-btn`,
            STOP_BUTTON: (platform) => `#${platform}-stop-btn`
        },

        // 分页控件
        PAGINATION: {
            BOSS: '.ui-icon-arrow-right, .options-pages a',
            LIEPIN: '.ant-pagination-next, .pager .next, .rc-pagination-next'
        }
    };

    /**
     * 正则表达式常量
     */
    const REGEX = {
        KEYWORD_SPLIT: /[,，]/,
        URL_CLEAN: /\?.*$/,
        WHITESPACE: /\s+/g,
        SUCCESS_TEXT: /已投递|已沟通|投递成功|沟通成功/
    };

    /**
     * 消息模板常量
     */
    const MESSAGES = {
        INIT_SUCCESS: '脚本初始化成功',
        PLATFORM_DETECTED: (platform) => `${platform}平台已检测`,
        TASK_STARTED: (platform) => `${platform}任务已启动`,
        TASK_STOPPED: (platform) => `${platform}任务已停止`,
        JOB_PROCESSED: (title) => `正在处理: ${title}`,
        FILTER_MATCH: (type, matched) => `${type}筛选${matched ? '通过' : '未通过'}`,
        ACTION_SUCCESS: (action) => `${action}成功`,
        ACTION_FAILED: (action, error) => `${action}失败: ${error}`,
        NETWORK_ERROR: '网络请求失败，请检查连接',
        ELEMENT_NOT_FOUND: (selector) => `未找到元素: ${selector}`,
        TASK_TIMEOUT: '任务执行超时'
    };
    /**
     * 日志级别
     */
    const LOG_LEVEL = {
        DEBUG: { name: "DEBUG", color: "#999", icon: "🔍" },
        INFO: { name: "INFO", color: "#2196F3", icon: "ℹ️" },
        SUCCESS: { name: "SUCCESS", color: "#4CAF50", icon: "✅" },
        WARNING: { name: "WARNING", color: "#FF9800", icon: "⚠️" },
        ERROR: { name: "ERROR", color: "#F44336", icon: "❌" },
        SKIP: { name: "SKIP", color: "#9E9E9E", icon: "⏭️" },
    };

    // =================================================================
    // 3. 核心工具 (Core Utilities)
    // =================================================================
    /**
     * 核心工具类
     * 提供日志记录、延迟控制、DOM操作等通用功能
     * @namespace Core
     */
    const Core = {
        // 性能监控
        performance: {
            startTime: Date.now(),
            operations: new Map(),
            memory: {
                initial: 0,
                current: 0,
                peak: 0
            }
        },

        /**
         * 初始化性能监控
         */
        initPerformance() {
            if (performance.memory) {
                this.performance.memory.initial = performance.memory.usedJSHeapSize;
                this.performance.memory.current = performance.memory.usedJSHeapSize;
            }
            this.log('性能监控已初始化', 'DEBUG');
        },

        /**
         * 更新内存使用统计
         */
        updateMemoryStats() {
            if (performance.memory) {
                this.performance.memory.current = performance.memory.usedJSHeapSize;
                this.performance.memory.peak = Math.max(
                    this.performance.memory.peak,
                    this.performance.memory.current
                );
            }
        },

        /**
         * 性能计时开始
         * @param {string} operation - 操作名称
         */
        startTiming(operation) {
            this.performance.operations.set(operation, Date.now());
        },

        /**
         * 性能计时结束
         * @param {string} operation - 操作名称
         * @param {boolean} logResult - 是否记录结果
         */
        endTiming(operation, logResult = false) {
            const startTime = this.performance.operations.get(operation);
            if (startTime) {
                const duration = Date.now() - startTime;
                this.performance.operations.delete(operation);

                if (logResult) {
                    this.log(`${operation} 耗时: ${duration}ms`, 'DEBUG');
                }

                return duration;
            }
            return 0;
        },

        /**
         * 增强型日志方法
         * @param {string} message - 日志消息
         * @param {string} level - 日志级别
         * @param {Object} context - 上下文信息
         */
        log(message, level = "INFO", context = null) {
            try {
                const time = new Date().toLocaleTimeString();
                const levelInfo = LOG_LEVEL[level] || LOG_LEVEL.INFO;
                const logEntry = `[${time}] ${levelInfo.icon} ${message}`;

                // 控制台输出
                console.log(`[JobHelper] ${message}`);

                // 添加上下文信息
                if (context && level === 'ERROR') {
                    console.error('Context:', context);
                }

                // UI 日志输出 (如果 UI 已初始化)
                if (typeof UIManager !== 'undefined' && UIManager.logPanel) {
                    UIManager.appendLog(logEntry, levelInfo.color);
                }

                // 更新性能统计
                this.updateMemoryStats();

            } catch (error) {
                // 防止日志系统崩溃
                console.error('[JobHelper] 日志系统错误:', error);
            }
        },

        /**
         * 错误处理统一入口
         * @param {Error} error - 错误对象
         * @param {string} context - 错误上下文
         * @param {boolean} rethrow - 是否重新抛出
         */
        handleError(error, context = '', rethrow = false) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const fullMessage = context ? `${context}: ${errorMessage}` : errorMessage;

            this.log(fullMessage, 'ERROR', {
                stack: error.stack,
                context: context,
                timestamp: new Date().toISOString()
            });

            if (rethrow) {
                throw error;
            }
        },

        /**
         * 安全的异步操作包装器
         * @param {Function} operation - 要执行的异步操作
         * @param {string} operationName - 操作名称
         * @param {*} defaultValue - 操作失败时的默认值
         */
        async safeAsync(operation, operationName = 'async operation', defaultValue = null) {
            try {
                this.startTiming(operationName);
                const result = await operation();
                this.endTiming(operationName, false);
                return result;
            } catch (error) {
                this.endTiming(operationName, false);
                this.handleError(error, `安全异步操作失败: ${operationName}`);
                return defaultValue;
            }
        },

        async delay(ms) {
            if (typeof ms !== 'number' || ms < 0) {
                this.log('无效的延迟时间，使用默认值', 'WARNING');
                ms = CONFIG.TIME.BASIC_INTERVAL;
            }

            const variance = ms * 0.2; // 20% 随机波动
            const actualMs = Math.max(0, ms + (Math.random() * variance * 2 - variance));

            return new Promise((resolve) => setTimeout(resolve, actualMs));
        },

        async smartDelay(baseTime, context = '') {
            // 根据上下文调整延迟
            let multiplier = 1.0;

            if (context.includes('click')) multiplier = 0.8;
            if (context.includes('input')) multiplier = 1.2;
            if (context.includes('load')) multiplier = 1.5;

            const adjustedTime = baseTime * multiplier;
            return this.delay(adjustedTime);
        },

        async waitForElement(selectorOrFunction, timeout = CONFIG.TIME.ELEMENT_WAIT_TIMEOUT) {
            return new Promise((resolve) => {
                let element;
                const getEl = () => {
                    try {
                        if (typeof selectorOrFunction === "function") return selectorOrFunction();
                        return document.querySelector(selectorOrFunction);
                    } catch (error) {
                        this.handleError(error, '元素查询失败');
                        return null;
                    }
                };

                element = getEl();
                if (element) return resolve(element);

                const observer = new MutationObserver(() => {
                    element = getEl();
                    if (element) {
                        clearTimeout(timeoutId);
                        observer.disconnect();
                        resolve(element);
                    }
                });

                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    resolve(null);
                }, timeout);

                try {
                    observer.observe(document.body, { childList: true, subtree: true });
                } catch (error) {
                    this.handleError(error, '元素监听器设置失败');
                    clearTimeout(timeoutId);
                    resolve(null);
                }
            });
        },

        async simulateClick(element) {
            if (!element) {
                this.log('无法模拟点击: 元素不存在', 'WARNING');
                return false;
            }

            try {
                const rect = element.getBoundingClientRect();
                const eventOpts = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                };

                element.dispatchEvent(new MouseEvent("mouseover", eventOpts));
                await this.delay(CONFIG.DELAYS.SHORT);
                element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
                await this.delay(CONFIG.DELAYS.SHORT);
                element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
                await this.delay(CONFIG.DELAYS.SHORT);
                element.click();

                return true;
            } catch (error) {
                this.handleError(error, '点击模拟失败');
                return false;
            }
        },

        extractTwoCharKeywords(text) {
            if (!text || typeof text !== 'string') {
                return [];
            }

            const keywords = [];
            const cleanedText = text.replace(/[\s,，.。:：;；""''\[\]\(\)\{\}]/g, "");

            for (let i = 0; i < cleanedText.length - 1; i++) {
                const keyword = cleanedText.substring(i, i + 2);
                if (keyword.trim()) {
                    keywords.push(keyword);
                }
            }

            return keywords;
        },

        exportLogs() {
            try {
                if (typeof UIManager === 'undefined' || !UIManager.logPanel) {
                    alert(MESSAGES.ELEMENT_NOT_FOUND('#ujh-log'));
                    return;
                }

                const lines = Array.from(UIManager.logPanel.children)
                    .map(child => child.textContent)
                    .filter(text => text)
                    .join('\n');

                if (!lines) {
                    alert("没有日志内容可导出");
                    return;
                }

                const blob = new Blob([lines], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `job_helper_logs_${new Date().toISOString().slice(0, 10)}.txt`;
                a.click();

                // 清理资源
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                this.log('日志导出成功', 'SUCCESS');
            } catch (error) {
                this.handleError(error, '日志导出失败');
            }
        },

        /**
         * 获取性能报告
         */
        getPerformanceReport() {
            const uptime = Date.now() - this.performance.startTime;
            const memoryMB = this.performance.memory.current / (1024 * 1024);

            return {
                uptime: Math.round(uptime / 1000), // 秒
                memoryUsage: Math.round(memoryMB * 100) / 100, // MB
                peakMemory: Math.round((this.performance.memory.peak / (1024 * 1024)) * 100) / 100,
                operationsCount: this.performance.operations.size
            };
        }
    };

    // =================================================================
    // 4. 存储管理 (Storage Manager)
    // =================================================================
    /**
     * 存储管理器
     * 统一处理GM存储和localStorage，提供跨域存储支持
     * @class StorageManager
     */
    class StorageManager {
        /**
         * 获取存储值
         * @param {string} key - 存储键
         * @param {*} defaultValue - 默认值
         * @returns {*} 存储的值或默认值
         */
        static get(key, defaultValue = null) {
            if (!key || typeof key !== 'string') {
                Core.handleError(new Error('无效的存储键'), 'StorageManager.get');
                return defaultValue;
            }

            try {
                // 优先尝试 GM_getValue (支持跨域/跨标签页更强)
                const val = GM_getValue(key);
                if (val !== undefined) {
                    return this.deserializeValue(val);
                }
            } catch (error) {
                Core.handleError(error, 'GM_getValue失败，尝试降级到localStorage');
            }

            // 降级到 localStorage
            try {
                const localVal = localStorage.getItem(key);
                if (localVal !== null) {
                    return this.deserializeValue(localVal);
                }
            } catch (error) {
                Core.handleError(error, 'localStorage读取失败');
            }

            return defaultValue;
        }

        /**
         * 设置存储值
         * @param {string} key - 存储键
         * @param {*} value - 要存储的值
         * @returns {boolean} 是否成功
         */
        static set(key, value) {
            if (!key || typeof key !== 'string') {
                Core.handleError(new Error('无效的存储键'), 'StorageManager.set');
                return false;
            }

            try {
                const serializedValue = this.serializeValue(value);
                GM_setValue(key, serializedValue);
                return true;
            } catch (error) {
                Core.handleError(error, 'GM_setValue失败，尝试降级到localStorage');

                try {
                    const serializedValue = this.serializeValue(value);
                    localStorage.setItem(key, serializedValue);
                    return true;
                } catch (fallbackError) {
                    Core.handleError(fallbackError, 'localStorage存储失败');
                    return false;
                }
            }
        }

        /**
         * 添加记录到有限列表
         * @param {string} key - 存储键
         * @param {*} record - 要添加的记录
         * @param {number} limit - 列表最大长度
         * @returns {boolean} 是否成功
         */
        static addRecordWithLimit(key, record, limit = CONFIG.LIMITS.STORAGE_RECORDS) {
            try {
                let records = this.get(key, []);
                if (!Array.isArray(records)) {
                    records = [];
                }

                // 去重检查
                if (records.includes(record)) {
                    return true; // 已存在，不需要添加
                }

                // 添加新记录
                records.push(record);

                // 限制长度
                if (records.length > limit) {
                    records = records.slice(-limit);
                }

                return this.set(key, records);
            } catch (error) {
                Core.handleError(error, '添加记录失败');
                return false;
            }
        }

        /**
         * 删除存储值
         * @param {string} key - 存储键
         * @returns {boolean} 是否成功
         */
        static remove(key) {
            if (!key || typeof key !== 'string') {
                Core.handleError(new Error('无效的存储键'), 'StorageManager.remove');
                return false;
            }

            try {
                GM_setValue(key, undefined);
                return true;
            } catch (error) {
                try {
                    localStorage.removeItem(key);
                    return true;
                } catch (fallbackError) {
                    Core.handleError(fallbackError, '存储删除失败');
                    return false;
                }
            }
        }

        /**
         * 清空所有存储
         * @returns {boolean} 是否成功
         */
        static clear() {
            try {
                // 注意：GM存储不支持批量清除，这里只清除localStorage
                localStorage.clear();
                Core.log('存储已清空', 'INFO');
                return true;
            } catch (error) {
                Core.handleError(error, '存储清空失败');
                return false;
            }
        }

        /**
         * 获取存储统计信息
         * @returns {Object} 统计信息
         */
        static getStats() {
            const stats = {
                gmStorage: 0,
                localStorage: 0,
                errors: 0
            };

            try {
                // 统计localStorage
                for (let key in localStorage) {
                    if (localStorage.hasOwnProperty(key)) {
                        stats.localStorage++;
                    }
                }
            } catch (error) {
                stats.errors++;
            }

            return stats;
        }

        /**
         * 序列化值
         * @private
         */
        static serializeValue(value) {
            if (typeof value === 'object' && value !== null) {
                return JSON.stringify(value);
            }
            return value;
        }

        /**
         * 反序列化值
         * @private
         */
        static deserializeValue(value) {
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                } catch (error) {
                    // 如果不是JSON字符串，直接返回原值
                    return value;
                }
            }
            return value;
        }
    }

    // =================================================================
    // 4. 全局状态 (Global State)
    // =================================================================
    const GlobalState = {
        platform: CONFIG.PLATFORM.UNKNOWN,
        strategy: null, // 当前激活的策略实例
        isRunning: false,
        settings: {},   // 运行时设置
    };

    // =================================================================
    // 5. UI 管理器 (UI Manager)
    // =================================================================
    /**
     * UI管理器
     * 负责创建和管理用户界面，包括面板、按钮、日志显示等
     * @namespace UIManager
     */
    const UIManager = {
        panel: null,
        logPanel: null,
        contentContainer: null,
        eventListeners: new Map(),
        resizeObserver: null,
        isMinimized: false,
        isPinned: false,

        init() {
            try {
                Core.startTiming('UI初始化');
                this.createPanel();
                this.setupGlobalStyles();
                this.setupEventListeners();
                this.setupResizeObserver();
                Core.endTiming('UI初始化', true);
                Core.log(MESSAGES.INIT_SUCCESS, 'SUCCESS');
            } catch (error) {
                Core.handleError(error, 'UI初始化失败');
            }
        },

        setupGlobalStyles() {
            try {
                const root = document.documentElement;

                // 设置 CSS 变量
                Object.entries(CONFIG.COLORS).forEach(([key, value]) => {
                    root.style.setProperty(`--ujh-${key}`, value);
                });

                // 添加全局样式
                const style = document.createElement('style');
                style.textContent = `
                    #ujh-panel * {
                        box-sizing: border-box;
                    }
                    #ujh-panel .log-item {
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                    }
                    #ujh-panel button:hover {
                        opacity: 0.9;
                    }
                    #ujh-panel button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                `;
                document.head.appendChild(style);

            } catch (error) {
                Core.handleError(error, '全局样式设置失败');
            }
        },

        /**
         * 设置全局事件监听器
         */
        setupEventListeners() {
            // 键盘快捷键
            this.addEventListener(document, 'keydown', (e) => {
                // Ctrl+Shift+L: 导出日志
                if (e.ctrlKey && e.shiftKey && e.key === 'L') {
                    e.preventDefault();
                    Core.exportLogs();
                }
                // Ctrl+Shift+C: 清空日志
                if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                    e.preventDefault();
                    if (this.logPanel) this.logPanel.innerHTML = '';
                    Core.log('日志已清空', 'INFO');
                }
            });

            // 页面可见性变化
            this.addEventListener(document, 'visibilitychange', () => {
                if (document.hidden) {
                    Core.log('页面变为不可见', 'DEBUG');
                } else {
                    Core.log('页面变为可见', 'DEBUG');
                }
            });
        },

        /**
         * 设置面板大小监听器
         */
        setupResizeObserver() {
            if (window.ResizeObserver && this.panel) {
                this.resizeObserver = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        const { width, height } = entry.contentRect;
                        // 动态调整内容布局
                        if (width < 300 && !this.isMinimized) {
                            this.panel.style.width = '280px';
                        }
                    }
                });
                this.resizeObserver.observe(this.panel);
            }
        },

        createPanel() {
            if (document.getElementById('ujh-panel')) {
                Core.log('UI面板已存在，跳过创建', 'DEBUG');
                return;
            }

            try {
                const panel = document.createElement('div');
                panel.id = 'ujh-panel';
                panel.setAttribute('data-ujh-version', '3.0.3');
                panel.style.cssText = `
                    position: fixed;
                    top: 100px;
                    right: 20px;
                    width: ${CONFIG.UI.PANEL_WIDTH}px;
                    max-height: ${CONFIG.UI.PANEL_HEIGHT}px;
                    background: white;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                    z-index: 2147483647 !important;
                    font-family: system-ui, -apple-system, sans-serif;
                    border: 1px solid var(--ujh-accent);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    pointer-events: auto;
                    transition: all 0.2s ease;
                `;

                // Header
                const header = this.createHeader();

                // Dynamic Content Area (Strategy Specific)
                this.contentContainer = document.createElement('div');
                this.contentContainer.id = 'ujh-content';
                this.contentContainer.style.cssText = `
                    padding: 12px;
                    background: var(--ujh-secondary);
                    flex: 1;
                    overflow-y: auto;
                    min-height: 150px;
                `;

                // Log Area
                this.logPanel = this.createLogPanel();

                // Footer
                const footer = this.createFooter();

                panel.append(header, this.contentContainer, this.logPanel, footer);
                document.body.appendChild(panel);
                this.panel = panel;

                this.makeDraggable(panel, header);
                Core.log('UI面板创建成功', 'SUCCESS');

            } catch (error) {
                Core.handleError(error, 'UI面板创建失败');
            }
        },

        createHeader() {
            const header = document.createElement('div');
            header.style.cssText = `
                padding: 12px;
                background: var(--ujh-primary);
                color: white;
                font-weight: bold;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
            `;

            const title = document.createElement('span');
            title.textContent = '🤖 招聘助手 (Universal)';

            const controls = document.createElement('div');

            // Pin Button
            const pinBtn = document.createElement('button');
            pinBtn.textContent = '📌';
            pinBtn.style.cssText = `
                background: none; border: none; color: white; 
                cursor: pointer; font-size: 14px; margin-right: 8px;
            `;
            pinBtn.title = "固定位置";

            let isPinned = false;
            pinBtn.onclick = (e) => {
                e.stopPropagation();
                isPinned = !isPinned;
                pinBtn.style.color = isPinned ? '#ffeb3b' : 'white';
                header.style.cursor = isPinned ? 'default' : 'move';
                this.isPinned = isPinned; // Store state
            };

            // Minimize Button
            const minBtn = document.createElement('button');
            minBtn.textContent = '—';
            minBtn.style.cssText = `
                background: none; border: none; color: white; 
                cursor: pointer; font-size: 16px; font-weight: bold;
            `;
            minBtn.onclick = () => this.toggleMinimize();

            controls.append(pinBtn, minBtn);
            header.append(title, controls);
            return header;
        },

        createLogPanel() {
            const logDiv = document.createElement('div');
            logDiv.id = 'ujh-log';
            logDiv.style.cssText = `
                height: 200px;
                overflow-y: auto;
                padding: 8px;
                font-size: 12px;
                background: white;
                border-top: 1px solid #eee;
            `;
            return logDiv;
        },

        createFooter() {
            const footer = document.createElement('div');
            footer.style.cssText = `
                padding: 8px;
                text-align: center;
                font-size: 10px;
                color: #999;
                border-top: 1px solid #eee;
            `;
            footer.textContent = '© Universal Job Helper v3.0';
            return footer;
        },

        appendLog(msg, color) {
            if (!this.logPanel) {
                Core.log('日志面板不存在，无法添加日志', 'WARNING');
                return;
            }

            try {
                // 限制日志数量，避免内存泄漏
                const maxLogs = CONFIG.LIMITS.LOG_HISTORY;
                while (this.logPanel.children.length >= maxLogs) {
                    this.logPanel.removeChild(this.logPanel.firstChild);
                }

                const div = document.createElement('div');
                div.className = 'log-item';
                div.textContent = msg;
                div.style.cssText = `
                    color: ${color || '#333'};
                    margin-bottom: 4px;
                    padding: 2px 0;
                    border-bottom: 1px dashed #f0f0f0;
                    font-size: 12px;
                    line-height: 1.4;
                    word-wrap: break-word;
                `;

                // 使用DocumentFragment优化性能
                const fragment = document.createDocumentFragment();
                fragment.appendChild(div);
                this.logPanel.appendChild(fragment);

                // 平滑滚动到底部
                this.logPanel.scrollTo({
                    top: this.logPanel.scrollHeight,
                    behavior: 'smooth'
                });

            } catch (error) {
                Core.handleError(error, '添加日志失败');
            }
        },

        toggleMinimize() {
            const content = this.panel.querySelector('#ujh-content');
            const log = this.panel.querySelector('#ujh-log');
            const footer = this.panel.lastElementChild;

            const isHidden = content.style.display === 'none';
            const display = isHidden ? 'block' : 'none';

            content.style.display = display;
            log.style.display = display;
            footer.style.display = display;
        },

        makeDraggable(panel, handle) {
            let isDragging = false;
            let startX, startY, initialLeft, initialTop;

            handle.addEventListener('mousedown', e => {
                if (this.isPinned) return; // Don't drag if pinned
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = panel.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;
                handle.style.cursor = 'grabbing';
            });

            document.addEventListener('mousemove', e => {
                if (!isDragging) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                panel.style.left = `${initialLeft + dx}px`;
                panel.style.top = `${initialTop + dy}px`;
                panel.style.right = 'auto';
            });

            document.addEventListener('mouseup', () => {
                isDragging = false;
                handle.style.cursor = 'move';
            });
        },

        /**
         * 添加事件监听器（带内存管理）
         * @param {Element} element - 目标元素
         * @param {string} event - 事件类型
         * @param {Function} handler - 事件处理函数
         * @param {Object} options - 事件选项
         */
        addEventListener(element, event, handler, options = {}) {
            if (!element || !event || !handler) {
                Core.handleError(new Error('无效的事件监听器参数'), 'UIManager.addEventListener');
                return;
            }

            try {
                const listenerKey = `${event}_${Date.now()}_${Math.random()}`;
                this.eventListeners.set(listenerKey, { element, event, handler });

                element.addEventListener(event, handler, options);

                // 返回清理函数
                return () => {
                    this.removeEventListener(listenerKey);
                };
            } catch (error) {
                Core.handleError(error, '添加事件监听器失败');
            }
        },

        /**
         * 移除事件监听器
         * @param {string} listenerKey - 监听器键
         */
        removeEventListener(listenerKey) {
            const listener = this.eventListeners.get(listenerKey);
            if (listener) {
                try {
                    const { element, event, handler } = listener;
                    element.removeEventListener(event, handler);
                    this.eventListeners.delete(listenerKey);
                } catch (error) {
                    Core.handleError(error, '移除事件监听器失败');
                }
            }
        },

        /**
         * 清理所有资源
         */
        cleanup() {
            try {
                // 清理事件监听器
                for (const [key, listener] of this.eventListeners) {
                    this.removeEventListener(key);
                }

                // 清理ResizeObserver
                if (this.resizeObserver) {
                    this.resizeObserver.disconnect();
                    this.resizeObserver = null;
                }

                // 清理DOM元素
                if (this.panel && this.panel.parentNode) {
                    this.panel.parentNode.removeChild(this.panel);
                }

                Core.log('UI资源清理完成', 'DEBUG');
            } catch (error) {
                Core.handleError(error, 'UI资源清理失败');
            }
        },

        /**
         * 获取UI状态
         */
        getUIState() {
            return {
                isMinimized: this.isMinimized,
                isPinned: this.isPinned,
                position: this.panel ? {
                    top: this.panel.style.top,
                    left: this.panel.style.left,
                    right: this.panel.style.right
                } : null,
                size: this.panel ? {
                    width: this.panel.offsetWidth,
                    height: this.panel.offsetHeight
                } : null
            };
        },

        // 动态添加配置控件的辅助方法
        addControl(type, labelText, key, options = {}) {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '10px';

            const label = document.createElement('label');
            label.textContent = labelText;
            label.style.cssText = 'display:block; font-size:12px; font-weight:bold; margin-bottom:4px; color:#555;';

            let input;
            if (type === 'text' || type === 'number') {
                input = document.createElement('input');
                input.type = type;
                input.value = options.value || '';
                input.placeholder = options.placeholder || '';
                input.style.cssText = 'width:95%; padding:6px; border:1px solid #ddd; border-radius:4px;';
                input.onchange = (e) => options.onChange(e.target.value);
            } else if (type === 'checkbox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!options.value;
                input.onchange = (e) => options.onChange(e.target.checked);
                label.style.display = 'inline-block';
                input.style.marginRight = '8px';
                wrapper.append(input, label);
                return wrapper; // Checkbox has different layout
            } else if (type === 'button') {
                input = document.createElement('button');
                if (options.id) input.id = options.id;
                input.textContent = labelText;
                input.style.cssText = `
                    width:100%; padding:8px; background:var(--ujh-primary);
                    color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;
                `;
                input.onclick = options.onClick;
                return input; // Direct return for button
            }

            wrapper.append(label, input);
            return wrapper;
        },

        // 创建标准的控制按钮组 (开始/停止按钮)
        createControlButtons(strategy, startBtnId, stopBtnId) {
            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = 'display:flex; gap:10px; margin-bottom:10px;';

            const startBtn = document.createElement('button');
            startBtn.id = startBtnId;
            startBtn.textContent = '开始运行';
            startBtn.style.cssText = `flex:1; padding:8px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; background:var(--ujh-primary); color:white;`;
            startBtn.onclick = () => strategy.start();

            const stopBtn = document.createElement('button');
            stopBtn.id = stopBtnId;
            stopBtn.textContent = '停止';
            stopBtn.style.cssText = `flex:1; padding:8px; border:none; border-radius:4px; cursor:pointer; font-weight:bold; background:${CONFIG.COLORS.neutral}; color:white;`;
            stopBtn.onclick = () => strategy.stop();

            btnGroup.append(startBtn, stopBtn);
            return btnGroup;
        },

        // 创建日志操作按钮组
        createLogButtons(strategy) {
            const logBtnGroup = document.createElement('div');
            logBtnGroup.style.cssText = 'display:flex; gap:10px; margin-bottom:10px;';

            const exportBtn = document.createElement('button');
            exportBtn.textContent = '导出日志';
            exportBtn.style.cssText = `flex:1; padding:6px; border:none; border-radius:4px; cursor:pointer; background:var(--ujh-primary); color:white; opacity:0.9;`;
            exportBtn.onclick = () => strategy.exportLogs();

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清空日志';
            clearBtn.style.cssText = `flex:1; padding:6px; border:none; border-radius:4px; cursor:pointer; background:${CONFIG.COLORS.warning}; color:white; opacity:0.9;`;
            clearBtn.onclick = () => {
                if (UIManager.logPanel) UIManager.logPanel.innerHTML = '';
            };

            logBtnGroup.append(exportBtn, clearBtn);
            return logBtnGroup;
        }
    };

    // =================================================================
    // 6. 策略基类与接口 (Strategy Interface - Object Version)
    // =================================================================

    // =================================================================
    // 6. 策略基类与接口 (Strategy Interface)
    // =================================================================
    /**
     * 招聘平台策略基类
     * 定义了所有招聘平台策略的通用接口和基础功能
     * @abstract
     * @class JobStrategy
     */
    class JobStrategy {
        constructor() {
            this.name = 'BaseStrategy';
            this.settings = {};
            this.platformPrefix = '';
            this.isRunning = false;
            this.stats = {
                processed: 0,
                successful: 0,
                failed: 0,
                skipped: 0,
                startTime: null,
                endTime: null
            };
        }

        /**
         * 初始化策略
         */
        init() {
            try {
                Core.startTiming(`${this.name}初始化`);
                this.loadSettings();
                this.recoverState();
                Core.endTiming(`${this.name}初始化`, true);
                Core.log(MESSAGES.PLATFORM_DETECTED(this.name), 'SUCCESS');
            } catch (error) {
                Core.handleError(error, `${this.name}初始化失败`);
            }
        }

        /**
         * 启动策略
         */
        start() {
            if (this.isRunning) {
                Core.log(`${this.name}已在运行中`, 'WARNING');
                return;
            }

            try {
                this.isRunning = true;
                this.stats.startTime = Date.now();
                this.resetStats();
                Core.log(MESSAGES.TASK_STARTED(this.name), 'SUCCESS');
            } catch (error) {
                Core.handleError(error, `${this.name}启动失败`);
                this.isRunning = false;
            }
        }

        /**
         * 停止策略
         */
        stop() {
            if (!this.isRunning) {
                Core.log(`${this.name}未在运行`, 'WARNING');
                return;
            }

            try {
                this.isRunning = false;
                this.stats.endTime = Date.now();
                Core.log(MESSAGES.TASK_STOPPED(this.name), 'SUCCESS');
                this.logFinalStats();
            } catch (error) {
                Core.handleError(error, `${this.name}停止失败`);
            }
        }

        /**
         * 渲染设置界面
         * @abstract
         */
        renderSettings(container) {
            container.textContent = 'No settings implemented';
        }

        /**
         * 恢复运行状态
         */
        recoverState() {
            // 子类实现具体的状态恢复逻辑
        }

        /**
         * 导出日志
         */
        exportLogs() {
            Core.exportLogs();
        }

        // 通用设置管理方法
        loadSettings() {
            try {
                const key = this.platformPrefix ?
                    CONFIG.STORAGE_KEYS.PREFIX_BOSS + this.platformPrefix + 'settings' :
                    CONFIG.STORAGE_KEYS.SETTINGS;
                const saved = StorageManager.get(key, {});
                Object.assign(this.settings, saved);
                Core.log(`${this.name}设置加载完成`, 'DEBUG');
            } catch (error) {
                Core.handleError(error, `${this.name}设置加载失败`);
            }
        }

        saveSettings() {
            try {
                const key = this.platformPrefix ?
                    CONFIG.STORAGE_KEYS.PREFIX_BOSS + this.platformPrefix + 'settings' :
                    CONFIG.STORAGE_KEYS.SETTINGS;
                const success = StorageManager.set(key, this.settings);
                if (success) {
                    Core.log(`${this.name}设置保存成功`, 'DEBUG');
                } else {
                    Core.log(`${this.name}设置保存失败`, 'WARNING');
                }
                return success;
            } catch (error) {
                Core.handleError(error, `${this.name}设置保存失败`);
                return false;
            }
        }

        // 通用按钮状态管理
        updateButtonState(startBtnId, stopBtnId, isRunning) {
            try {
                const startBtn = document.getElementById(startBtnId);
                const stopBtn = document.getElementById(stopBtnId);

                if (startBtn && stopBtn) {
                    if (isRunning) {
                        startBtn.textContent = '运行中...';
                        startBtn.style.background = CONFIG.COLORS.success;
                        startBtn.disabled = true;
                        stopBtn.style.background = CONFIG.COLORS.warning;
                        stopBtn.disabled = false;
                    } else {
                        startBtn.textContent = '开始运行';
                        startBtn.style.background = 'var(--ujh-primary)';
                        startBtn.disabled = false;
                        stopBtn.style.background = CONFIG.COLORS.neutral;
                        stopBtn.disabled = true;
                    }
                }
            } catch (error) {
                Core.handleError(error, '按钮状态更新失败');
            }
        }

        // 通用关键词筛选逻辑
        shouldProcessByKeywords(text, keywordsStr, caseSensitive = false) {
            if (!text || typeof text !== 'string') {
                return false;
            }

            if (!keywordsStr || typeof keywordsStr !== 'string') {
                return true; // 无关键词限制，全都通过
            }

            const keywords = keywordsStr.split(REGEX.KEYWORD_SPLIT).filter(k => k.trim());
            if (keywords.length === 0) {
                return true;
            }

            const searchText = caseSensitive ? text : text.toLowerCase();
            return keywords.some(kw => {
                const keyword = caseSensitive ? kw.trim() : kw.toLowerCase().trim();
                return searchText.includes(keyword);
            });
        }

        /**
         * 重置统计数据
         */
        resetStats() {
            this.stats = {
                processed: 0,
                successful: 0,
                failed: 0,
                skipped: 0,
                startTime: this.stats.startTime,
                endTime: null
            };
        }

        /**
         * 更新统计数据
         * @param {string} type - 统计类型 (processed|successful|failed|skipped)
         */
        updateStats(type) {
            if (this.stats.hasOwnProperty(type)) {
                this.stats[type]++;
            }
        }

        /**
         * 获取运行统计
         */
        getStats() {
            const runtime = this.stats.startTime && this.stats.endTime ?
                this.stats.endTime - this.stats.startTime : 0;

            return {
                ...this.stats,
                runtime: Math.round(runtime / 1000), // 秒
                successRate: this.stats.processed > 0 ?
                    Math.round((this.stats.successful / this.stats.processed) * 100) : 0
            };
        }

        /**
         * 记录最终统计信息
         */
        logFinalStats() {
            const stats = this.getStats();
            Core.log(`${this.name}运行统计:`, 'INFO');
            Core.log(`处理数量: ${stats.processed}, 成功: ${stats.successful}, 失败: ${stats.failed}, 跳过: ${stats.skipped}`, 'INFO');
            Core.log(`成功率: ${stats.successRate}%, 运行时间: ${stats.runtime}秒`, 'INFO');
        }

        /**
         * 安全的异步操作执行
         * @param {Function} operation - 要执行的操作
         * @param {string} operationName - 操作名称
         * @param {*} defaultValue - 默认返回值
         */
        async safeExecute(operation, operationName, defaultValue = null) {
            return Core.safeAsync(operation, `${this.name}-${operationName}`, defaultValue);
        }
    }

    const createBaseStrategy = () => ({
        name: 'BaseStrategy',
        init() { console.log('Init strategy'); },
        start() { console.log('Start strategy'); },
        stop() { console.log('Stop strategy'); },
        renderSettings(container) { container.textContent = 'No settings'; }
    });




    // =================================================================
    // 7. BOSS直聘策略 (BossStrategy)
    // =================================================================
    /**
     * BOSS直聘平台策略实现
     * 处理BOSS直聘网站的职位搜索、筛选和自动沟通功能
     * @class BossStrategy
     * @extends JobStrategy
     */
    class BossStrategy extends JobStrategy {
        constructor() {
            super();
            this.name = 'BossStrategy';
            this.platformPrefix = 'boss_';
            this.settings = {
                keywords: '',
                locationKeywords: '',
                jobDescKeywords: '',
                cityKeywords: '',
                excludeHeadhunters: false,
                autoScroll: true,
                autoReply: false,
                keywordReplies: [], // [{keyword:'xx', reply:'xx'}]
                imageResumes: [], // [{name: 'filename', data: 'base64'}]
                useAutoSendImageResume: false
            };
            this.lastProcessedMessage = null;
            this.processingMessage = false;
            this.currentIndex = 0;
        }

        init() {
            Core.log('BOSS策略初始化...');
            this.loadSettings();
        }

        start() {
            Core.log('BOSS任务启动');
            GlobalState.isRunning = true;
            this.loop();
        }

        stop() {
            Core.log('BOSS任务停止');
            GlobalState.isRunning = false;
        }

        async loop() {
            if (!GlobalState.isRunning) return;

            if (location.pathname.includes('/job_detail')) {
                // 详情页逻辑（暂时留空）
            } else if (location.pathname.includes('/chat')) {
                await this.handleChatPage();
            } else {
                await this.processJobList();
            }

            if (GlobalState.isRunning) {
                setTimeout(() => this.loop(), CONFIG.BASIC_INTERVAL);
            }
        }

        async processJobList() {
            const jobCards = Array.from(document.querySelectorAll(SELECTORS.BOSS.JOB_CARDS));

            // 第一遍过滤：基于列表页可见信息
            const preFilteredCards = [];
            for (const card of jobCards) {
                if (await this.shouldProcessCardBasic(card)) {
                    preFilteredCards.push(card);
                }
            }

            // 第二遍过滤：职责描述筛选（需要详情页）
            const validCards = [];
            if (this.settings.jobDescKeywords) {
                Core.log(`需要职责描述筛选，共${preFilteredCards.length}个职位待验证`, "INFO");

                for (const card of preFilteredCards) {
                    const shouldProcess = await this.shouldProcessCardWithDescription(card);
                    if (shouldProcess) {
                        validCards.push(card);
                    }
                }
            } else {
                // 无需职责描述筛选，直接使用预过滤结果
                validCards.push(...preFilteredCards);
            }

            if (validCards.length === 0) {
                Core.log("当前页面没有符合条件的职位", "WARNING");
                const hasNext = await this.goToNextPage();
                if (!hasNext) {
                    this.stop();
                    alert("所有职位已处理完毕！");
                }
                return;
            }

            if (this.currentIndex >= validCards.length) {
                const hasNext = await this.goToNextPage();
                if (hasNext) {
                    this.currentIndex = 0;
                    return;
                }
                this.stop();
                alert("所有职位已处理完毕！");
                return;
            }

            const currentCard = validCards[this.currentIndex];
            currentCard.scrollIntoView({ behavior: "smooth", block: "center" });

            // 模拟点击进入（Boss直聘通常是点击卡片或"立即沟通"）
            const chatBtn = currentCard.querySelector(SELECTORS.BOSS.CHAT_BUTTON);
            let clicked = false;

            if (chatBtn && chatBtn.textContent.trim() === "立即沟通") {
                const jobTitle = currentCard.querySelector(SELECTORS.BOSS.JOB_TITLE)?.textContent || "未知职位";
                Core.log(`正在沟通: ${jobTitle}`, "INFO");
                const clickSuccess = await Core.simulateClick(chatBtn);
                if (clickSuccess) {
                    clicked = true;
                    await this.handleGreetingModal();
                }
            } else {
                // 如果没有立即沟通按钮，尝试点击整个卡片
                Core.log("未找到立即沟通按钮，尝试点击职位卡片", "DEBUG");
                const clickSuccess = await Core.simulateClick(currentCard);
                if (clickSuccess) {
                    clicked = true;
                    await Core.smartDelay(2000, 'card_click');
                }
            }

            if (!clicked) {
                Core.log("所有点击尝试均失败，跳过此职位", "WARNING");
            }

            this.currentIndex++;
            this.updateStats('processed');
            await Core.smartDelay(CONFIG.OPERATION_INTERVAL * 2, 'job_interval');
        }

        /**
         * 基础职位卡片筛选（基于列表页信息）
         * @param {Element} card - 职位卡片元素
         * @returns {Promise<boolean>} 是否通过筛选
         */
        async shouldProcessCardBasic(card) {
            const title = card.querySelector(SELECTORS.BOSS.JOB_TITLE)?.textContent || "";
            const addressText = (
                card.querySelector(SELECTORS.BOSS.LOCATION)?.textContent || ""
            ).trim();

            const headhuntingElement = card.querySelector(SELECTORS.BOSS.HEADHUNTER_TAG);
            const altText = headhuntingElement ? headhuntingElement.alt : "";

            // 职位名筛选
            if (!this.shouldProcessByKeywords(title, this.settings.keywords)) {
                Core.log(`职位名不匹配: ${title}`, "SKIP");
                return false;
            }

            // 地点筛选
            if (!this.shouldProcessByKeywords(addressText, this.settings.locationKeywords)) {
                Core.log(`地点不匹配: ${addressText}`, "SKIP");
                return false;
            }

            // 城市筛选
            if (!this.shouldProcessByKeywords(addressText, this.settings.cityKeywords)) {
                Core.log(`城市不匹配: ${addressText}`, "SKIP");
                return false;
            }

            // 猎头过滤
            if (this.settings.excludeHeadhunters && altText.includes("猎头")) {
                Core.log(`排除猎头职位: ${title}`, "SKIP");
                return false;
            }

            return true;
        }

        /**
         * 包含职责描述的完整职位卡片筛选
         * @param {Element} card - 职位卡片元素
         * @returns {Promise<boolean>} 是否通过筛选
         */
        async shouldProcessCardWithDescription(card) {
            // 先通过基础筛选
            if (!(await this.shouldProcessCardBasic(card))) {
                return false;
            }

            // 如果启用了职责描述筛选，需要进入详情页检查
            if (!this.settings.jobDescKeywords) {
                return true;
            }

            try {
                const jobTitle = card.querySelector(SELECTORS.BOSS.JOB_TITLE)?.textContent || "未知职位";
                Core.log(`正在检查职责描述: ${jobTitle}`, "DEBUG");

                // 尝试获取详情页内容
                const description = await this.getJobDescription(card);
                if (!description) {
                    Core.log(`无法获取职责描述: ${jobTitle}`, "WARNING");
                    // 如果无法获取详情，保守起见通过（避免错过潜在匹配）
                    return true;
                }

                // 检查职责描述是否匹配关键词
                const matched = this.shouldProcessByKeywords(description, this.settings.jobDescKeywords);
                if (!matched) {
                    Core.log(`职责描述不匹配: ${jobTitle}`, "SKIP");
                    return false;
                }

                Core.log(`职责描述匹配通过: ${jobTitle}`, "SUCCESS");
                return true;

            } catch (error) {
                Core.handleError(error, `职责描述筛选失败: ${card.querySelector(SELECTORS.BOSS.JOB_TITLE)?.textContent}`);
                // 出错时保守通过，避免因为技术问题错过职位
                return true;
            }
        }

        /**
         * 获取职位职责描述
         * @param {Element} card - 职位卡片元素
         * @returns {Promise<string|null>} 职责描述文本
         */
        async getJobDescription(card) {
            try {
                // 方法1: 尝试从卡片中直接获取（如果有展开的内容）
                const expandedContent = card.querySelector('.job-detail-text, .job-description');
                if (expandedContent && expandedContent.textContent) {
                    return expandedContent.textContent.trim();
                }

                // 方法2: 点击展开按钮获取更多内容
                const expandBtn = card.querySelector('.job-detail-btn, .expand-btn, [data-toggle="collapse"]');
                if (expandBtn) {
                    await Core.simulateClick(expandBtn);
                    await Core.smartDelay(1000, 'expand_content');

                    const expandedText = card.querySelector('.job-detail-text, .job-description');
                    if (expandedText && expandedText.textContent) {
                        return expandedText.textContent.trim();
                    }
                }

                // 方法3: 尝试进入详情页获取（临时方案）
                // 注意：这可能会改变页面状态，需要谨慎处理
                const detailLink = card.querySelector('a[href*="/job_detail/"], a[href*="/geek/job/"]');
                if (detailLink && this.settings.jobDescKeywords) {
                    Core.log('尝试临时访问详情页获取职责描述', 'DEBUG');

                    // 保存当前URL
                    const currentUrl = window.location.href;

                    // 点击进入详情页
                    await Core.simulateClick(detailLink);
                    await Core.smartDelay(2000, 'page_load');

                    // 尝试获取详情页的职责描述
                    const description = this.extractDescriptionFromDetailPage();

                    // 返回列表页
                    if (window.location.href !== currentUrl) {
                        window.history.back();
                        await Core.smartDelay(1000, 'page_back');
                    }

                    return description;
                }

                return null;

            } catch (error) {
                Core.handleError(error, '获取职责描述失败');
                return null;
            }
        }

        /**
         * 从详情页提取职责描述
         * @returns {string|null} 职责描述文本
         */
        extractDescriptionFromDetailPage() {
            try {
                // BOSS直聘详情页的职责描述选择器
                const selectors = [
                    '.job-detail-section .job-description',
                    '.job-sec-text',
                    '.job-detail-content',
                    '[data-selector="job-description"]',
                    '.detail-content'
                ];

                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent) {
                        const text = element.textContent.trim();
                        if (text.length > 20) { // 确保有足够的内容
                            return text;
                        }
                    }
                }

                return null;
            } catch (error) {
                Core.handleError(error, '从详情页提取职责描述失败');
                return null;
            }
        }

        async processJobList() {
            const jobCards = Array.from(document.querySelectorAll(SELECTORS.BOSS.JOB_CARDS));

            // 第一遍过滤：基于列表页可见信息
            const preFilteredCards = [];
            for (const card of jobCards) {
                if (await this.shouldProcessCardBasic(card)) {
                    preFilteredCards.push(card);
                }
            }

            // 第二遍过滤：职责描述筛选（需要详情页）
            const validCards = [];
            if (this.settings.jobDescKeywords) {
                Core.log(`需要职责描述筛选，共${preFilteredCards.length}个职位待验证`, "INFO");

                for (const card of preFilteredCards) {
                    const shouldProcess = await this.shouldProcessCardWithDescription(card);
                    if (shouldProcess) {
                        validCards.push(card);
                    }
                }
            } else {
                // 无需职责描述筛选，直接使用预过滤结果
                validCards.push(...preFilteredCards);
            }

            if (validCards.length === 0) {
                Core.log("当前页面没有符合条件的职位");
                const hasNext = await this.goToNextPage();
                if (!hasNext) {
                    this.stop();
                    alert("所有职位已处理完毕！");
                }
                return;
            }

            if (this.currentIndex >= validCards.length) {
                const hasNext = await this.goToNextPage();
                if (hasNext) {
                    this.currentIndex = 0;
                    return;
                }
                this.stop();
                alert("所有职位已处理完毕！");
                return;
            }

            const currentCard = validCards[this.currentIndex];
            currentCard.scrollIntoView({ behavior: "smooth", block: "center" });

            // 模拟点击进入（Boss直聘通常是点击卡片或"立即沟通"）
            // 注意：Boss列表页点击卡片会跳转详情页或打开聊天
            // 这里我们模拟点击“立即沟通”如果存在，或者点击卡片

            const chatBtn = currentCard.querySelector(SELECTORS.BOSS.CHAT_BUTTON);
            let clicked = false;

            if (chatBtn && chatBtn.textContent.trim() === "立即沟通") {
                Core.log(`正在沟通: ${currentCard.querySelector(".job-name")?.textContent}`, "INFO");
                chatBtn.click();
                clicked = true;
                await this.handleGreetingModal();
            } else {
                // 如果没有立即沟通按钮，则点击整个卡片（可能会跳转）
                // 但为了保持流程，我们优先处理本页交互
                // 如果需要跳转详情页，逻辑会更复杂，暂时维持原逻辑
                // 或者，点击卡片如果在新标签页打开，我们无法控制
                // Boss_helper.js 主要是点击 "立即沟通"
            }

            if (!clicked) {
                // 如果没点 communication, 可能是已经沟通过了
                // 或者是"继续沟通"
                currentCard.click(); // 可能会跳转
                await Core.delay(2000);
            }

            this.currentIndex++;
            await Core.delay(CONFIG.OPERATION_INTERVAL * 2);
        }

        async shouldProcessCard(card) {
            const title = card.querySelector(".job-name")?.textContent || "";
            const addressText = (
                card.querySelector(".job-address-desc")?.textContent ||
                card.querySelector(".company-location")?.textContent ||
                card.querySelector(".job-area")?.textContent || ""
            ).trim();

            const headhuntingElement = card.querySelector(".job-tag-icon");
            const altText = headhuntingElement ? headhuntingElement.alt : "";

            // 职位名筛选
            if (!this.shouldProcessByKeywords(title, this.settings.keywords)) {
                return false;
            }

            // 地点筛选
            if (!this.shouldProcessByKeywords(addressText, this.settings.locationKeywords)) {
                return false;
            }

            // 城市筛选
            if (!this.shouldProcessByKeywords(addressText, this.settings.cityKeywords)) {
                return false;
            }

            // 猎头过滤
            if (this.settings.excludeHeadhunters && altText.includes("猎头")) {
                return false;
            }

            return true;
        }

        async goToNextPage() {
            try {
                Core.log("尝试翻页...", "INFO");

                // 策略1: 尝试滚动加载更多内容 (BOSS直聘主要使用无限滚动)
                const scrollSuccess = await this.tryScrollLoad();
                if (scrollSuccess) {
                    return true;
                }

                // 策略2: 查找并点击下一页按钮
                const nextBtn = this.findNextPageButton();
                if (nextBtn) {
                    Core.log("找到下一页按钮，尝试点击", "DEBUG");
                    const clickSuccess = await Core.simulateClick(nextBtn);
                    if (clickSuccess) {
                        await Core.smartDelay(3000, 'page_load');
                        Core.log("翻页成功", "SUCCESS");
                        return true;
                    }
                }

                Core.log("未找到可用的翻页方式", "WARNING");
                return false;

            } catch (error) {
                Core.handleError(error, "翻页操作失败");
                return false;
            }
        }

        /**
         * 尝试滚动加载更多内容
         * @returns {Promise<boolean>} 是否成功加载
         */
        async tryScrollLoad() {
            try {
                const initialHeight = document.body.scrollHeight;
                const initialJobCount = document.querySelectorAll(SELECTORS.BOSS.JOB_CARDS).length;

                Core.log(`当前页面高度: ${initialHeight}px, 职位数量: ${initialJobCount}`, "DEBUG");

                // 滚动到底部
                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth'
                });

                // 等待内容加载
                await Core.smartDelay(2000, 'scroll_load');

                // 检查是否有新内容加载
                const newHeight = document.body.scrollHeight;
                const newJobCount = document.querySelectorAll(SELECTORS.BOSS.JOB_CARDS).length;

                const heightIncreased = newHeight > initialHeight;
                const jobsIncreased = newJobCount > initialJobCount;

                if (heightIncreased || jobsIncreased) {
                    Core.log(`滚动加载成功 - 高度: ${initialHeight} → ${newHeight}, 职位: ${initialJobCount} → ${newJobCount}`, "SUCCESS");
                    await Core.smartDelay(1000, 'content_stabilize');
                    return true;
                }

                // 如果没有明显变化，尝试多次滚动
                for (let attempt = 1; attempt <= 3; attempt++) {
                    Core.log(`尝试第${attempt}次滚动加载...`, "DEBUG");

                    window.scrollTo({
                        top: document.body.scrollHeight,
                        behavior: 'auto'
                    });

                    await Core.smartDelay(1500, 'retry_scroll');

                    const retryHeight = document.body.scrollHeight;
                    const retryJobCount = document.querySelectorAll(SELECTORS.BOSS.JOB_CARDS).length;

                    if (retryHeight > newHeight || retryJobCount > newJobCount) {
                        Core.log(`第${attempt}次滚动加载成功`, "SUCCESS");
                        await Core.smartDelay(1000, 'content_stabilize');
                        return true;
                    }
                }

                Core.log("滚动加载未检测到新内容", "DEBUG");
                return false;

            } catch (error) {
                Core.handleError(error, "滚动加载失败");
                return false;
            }
        }

        /**
         * 查找下一页按钮
         * @returns {Element|null} 下一页按钮元素
         */
        findNextPageButton() {
            // 多种选择器尝试查找下一页按钮
            const selectors = [
                '.ui-icon-arrow-right:not(.disabled)',
                '.options-pages a:not(.disabled):contains("下一页")',
                '.pagination .next:not(.disabled)',
                '[data-page="next"]:not([disabled])',
                'a[href*="page"]:contains(">")'
            ];

            for (const selector of selectors) {
                try {
                    let element;

                    // 处理特殊选择器
                    if (selector.includes(':contains')) {
                        const [baseSelector, text] = selector.split(':contains');
                        const elements = document.querySelectorAll(baseSelector.replace(')', ''));
                        element = Array.from(elements).find(el =>
                            el.textContent && el.textContent.includes(text.replace(/[()"]/g, ''))
                        );
                    } else {
                        element = document.querySelector(selector);
                    }

                    if (element && this.isElementClickable(element)) {
                        return element;
                    }
                } catch (error) {
                    // 忽略选择器错误，继续尝试下一个
                    Core.log(`选择器 ${selector} 无效: ${error.message}`, "DEBUG");
                }
            }

            return null;
        }

        /**
         * 检查元素是否可点击
         * @param {Element} element - 要检查的元素
         * @returns {boolean} 是否可点击
         */
        isElementClickable(element) {
            if (!element) return false;

            // 检查元素是否可见
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;

            // 检查元素是否在视窗内
            if (rect.top < 0 || rect.left < 0) return false;

            // 检查是否被禁用
            if (element.disabled || element.classList.contains('disabled')) return false;

            // 检查是否有点击事件
            const hasClickHandler = element.onclick ||
                                   element.getAttribute('onclick') ||
                                   element.tagName.toLowerCase() === 'a';

            return !!hasClickHandler;
        }

        async handleGreetingModal() {
            await Core.delay(2000);
            const btn = [...document.querySelectorAll(SELECTORS.BOSS.GREETING_MODAL)].find(b => b.textContent.trim() === "留在此页");
            if (btn) {
                btn.click();
                await Core.delay(1000);
            }
        }

        async handleChatPage() {
            this.processingMessage = false;
            // 获取选中或最新的聊天项
            const currentChat = document.querySelector('li.message-item.item-friend:last-child');

            // 处理新消息
            await this.handleNewMessage();

            // 简单的简历发送逻辑（如果配置了）
            // 注意：这里需要更复杂的判断，避免重复发送
        }

        async handleNewMessage() {
            try {
                const chatContainer = document.querySelector(SELECTORS.LIEPIN.CHAT_CONTAINER);
                if (!chatContainer) {
                    Core.log("未找到聊天容器", "DEBUG");
                    return;
                }

                const friendMessages = Array.from(chatContainer.querySelectorAll(SELECTORS.LIEPIN.FRIEND_MESSAGES));
                if (friendMessages.length === 0) {
                    return;
                }

                const lastMessageEl = friendMessages[friendMessages.length - 1];
                const textEl = lastMessageEl.querySelector(".text span, .message-content");
                const text = textEl?.textContent?.trim();

                if (text && text !== this.lastProcessedMessage) {
                    this.lastProcessedMessage = text;
                    Core.log(`收到新消息: ${text}`, "INFO");

                    // 检查是否需要自动回复
                    if (this.settings.autoReply) {
                        await this.processAutoReply(text);
                    }

                    // 关键词自动回复
                    if (this.settings.keywordReplies && this.settings.keywordReplies.length > 0) {
                        await this.processKeywordReply(text);
                    }
                }
            } catch (error) {
                Core.handleError(error, '处理新消息失败');
            }
        }

        /**
         * 处理自动回复
         * @param {string} message - 收到的消息
         */
        async processAutoReply(message) {
            try {
                Core.log('正在生成AI自动回复...', 'DEBUG');

                // 这里应该调用AI API生成回复
                // 暂时使用简单的模板回复
                const reply = await this.generateAIReply(message);

                if (reply) {
                    await this.sendReply(reply);
                    Core.log(`AI自动回复成功: ${reply}`, 'SUCCESS');
                } else {
                    Core.log('AI回复生成失败', 'WARNING');
                }
            } catch (error) {
                Core.handleError(error, 'AI自动回复失败');
            }
        }

        /**
         * 处理关键词自动回复
         * @param {string} message - 收到的消息
         */
        async processKeywordReply(message) {
            try {
                if (!this.settings.keywordReplies || this.settings.keywordReplies.length === 0) {
                    return;
                }

                const lowerMessage = message.toLowerCase();

                for (const replyRule of this.settings.keywordReplies) {
                    if (!replyRule.keyword || !replyRule.reply) continue;

                    const keywords = replyRule.keyword.split(/[,，]/).map(k => k.trim().toLowerCase());
                    const matched = keywords.some(keyword => lowerMessage.includes(keyword));

                    if (matched) {
                        Core.log(`关键词匹配成功: "${replyRule.keyword}"`, 'DEBUG');
                        await this.sendReply(replyRule.reply);
                        Core.log(`关键词自动回复成功: ${replyRule.reply}`, 'SUCCESS');
                        break; // 只回复第一个匹配的规则
                    }
                }
            } catch (error) {
                Core.handleError(error, '关键词自动回复失败');
            }
        }

        /**
         * 生成AI回复
         * @param {string} message - 用户消息
         * @returns {Promise<string|null>} AI回复内容
         */
        async generateAIReply(message) {
            try {
                // 这里应该调用真实的AI API
                // 暂时使用模拟回复逻辑

                const lowerMessage = message.toLowerCase();

                // 简单的规则-based回复
                if (lowerMessage.includes('经验') || lowerMessage.includes('工作经验')) {
                    return '我有相关实习经验，在项目中负责前端开发工作。';
                }

                if (lowerMessage.includes('技能') || lowerMessage.includes('技术')) {
                    return '我熟练掌握React、Vue等前端框架，以及Node.js后端开发。';
                }

                if (lowerMessage.includes('薪资') || lowerMessage.includes('待遇')) {
                    return '薪资待遇方面我期望能与我的能力和贡献相匹配。';
                }

                if (lowerMessage.includes('到岗') || lowerMessage.includes('入职')) {
                    return '我可以尽快到岗，具体时间可以进一步沟通。';
                }

                // 默认回复
                return '感谢您的关注，我对这个职位很感兴趣，希望能进一步了解公司和团队的情况。';

            } catch (error) {
                Core.handleError(error, 'AI回复生成失败');
                return null;
            }
        }

        /**
         * 发送回复消息
         * @param {string} replyText - 回复内容
         */
        async sendReply(replyText) {
            try {
                // 查找输入框
                const inputSelectors = [
                    '.chat-input input',
                    '.message-input textarea',
                    '.chat-textarea',
                    '[contenteditable="true"]',
                    '.input-box textarea'
                ];

                let inputElement = null;
                for (const selector of inputSelectors) {
                    inputElement = document.querySelector(selector);
                    if (inputElement) break;
                }

                if (!inputElement) {
                    Core.log('未找到消息输入框', 'WARNING');
                    return false;
                }

                // 输入回复内容
                if (inputElement.tagName.toLowerCase() === 'textarea' ||
                    inputElement.contentEditable === 'true') {
                    inputElement.value = replyText;
                    inputElement.textContent = replyText;
                } else {
                    inputElement.value = replyText;
                }

                // 触发输入事件
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dispatchEvent(new Event('change', { bubbles: true }));

                await Core.smartDelay(500, 'input_text');

                // 查找发送按钮
                const sendSelectors = [
                    '.send-btn',
                    '.chat-send',
                    'button[type="submit"]',
                    '.btn-send',
                    '[data-selector="send-btn"]'
                ];

                let sendButton = null;
                for (const selector of sendSelectors) {
                    sendButton = document.querySelector(selector);
                    if (sendButton && !sendButton.disabled) break;
                }

                if (sendButton) {
                    await Core.simulateClick(sendButton);
                    await Core.smartDelay(1000, 'send_message');
                    return true;
                } else {
                    // 尝试按Enter键发送
                    inputElement.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                        bubbles: true
                    }));

                    await Core.smartDelay(1000, 'send_message');
                    return true;
                }

            } catch (error) {
                Core.handleError(error, '发送回复失败');
                return false;
            }
        }

        async sendResume() {
            // Ported minimal version
            const resumeBtn = [...document.querySelectorAll(SELECTORS.BOSS.RESUME_BUTTON)].find(el => el.textContent.trim() === "发简历");
            if (resumeBtn && !resumeBtn.classList.contains('unable')) {
                resumeBtn.click();
                await Core.delay(1000);
                // 确认弹窗
                const confirmBtn = document.querySelector(SELECTORS.BOSS.CONFIRM_BUTTON);
                if (confirmBtn) confirmBtn.click();
                Core.log("尝试发送简历", "INFO");
                return true;
            }
            return false;
        }

        /**
         * 根据职位名称选择合适的图片简历
         * @param {string} positionName - 职位名称
         * @returns {Object|null} 简历对象
         */
        selectImageResume(positionName) {
            if (!this.settings.imageResumes || this.settings.imageResumes.length === 0) {
                return null;
            }

            if (!positionName) {
                return this.settings.imageResumes[0];
            }

            // Fuzzy match using two-char keywords
            const targetKeywords = Core.extractTwoCharKeywords(positionName);
            let bestMatch = null;
            let maxScore = 0;

            for (const resume of this.settings.imageResumes) {
                const resumeKeywords = Core.extractTwoCharKeywords(resume.name);
                let score = 0;
                for (const k of targetKeywords) {
                    if (resumeKeywords.includes(k)) score++;
                }

                if (score > maxScore) {
                    maxScore = score;
                    bestMatch = resume;
                }
            }

            // If no significant match, return the first one
            return bestMatch || this.settings.imageResumes[0];
        }

        /**
         * 发送图片简历
         */
        async sendImageResume() {
            if (!this.settings.imageResumes || this.settings.imageResumes.length === 0) {
                Core.log('没有可用的图片简历', 'WARNING');
                return false;
            }

            try {
                // Find file input
                const fileInput = document.querySelector('.btn-sendimg input[type="file"]');
                if (!fileInput) {
                    Core.log('未找到图片上传按钮 (.btn-sendimg input)', 'WARNING');
                    return false;
                }

                // Get current position name for matching
                const positionNameEl = document.querySelector('.job-name') || document.querySelector('.job-title');
                const positionName = positionNameEl ? positionNameEl.textContent.trim() : '';

                const resume = this.selectImageResume(positionName);
                if (!resume) {
                    Core.log('无法选择合适的简历', 'WARNING');
                    return false;
                }

                Core.log(`准备发送图片简历: ${resume.name}`, 'INFO');

                // Convert base64 to Blob/File
                const arr = resume.data.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const file = new File([u8arr], resume.name, { type: mime });

                // Create DataTransfer
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                fileInput.files = dataTransfer.files;

                // Dispatch change event
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));

                Core.log('图片简历发送指令已触发', 'SUCCESS');
                return true;

            } catch (error) {
                Core.handleError(error, '发送图片简历失败');
                return false;
            }
        }

        renderSettings(container) {
            container.innerHTML = '';

            // 职位关键词输入
            container.appendChild(UIManager.addControl('text', '职位关键词', 'keywords', {
                value: this.settings.keywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.keywords = val; this.saveSettings(); }
            }));

            // 地点关键词输入
            container.appendChild(UIManager.addControl('text', '地点关键词', 'locationKeywords', {
                value: this.settings.locationKeywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.locationKeywords = val; this.saveSettings(); }
            }));

            // 职责描述关键词
            container.appendChild(UIManager.addControl('text', '职责关键词', 'jobDescKeywords', {
                value: this.settings.jobDescKeywords,
                placeholder: '详情页筛选',
                onChange: (val) => { this.settings.jobDescKeywords = val; this.saveSettings(); }
            }));

            // 城市关键词
            container.appendChild(UIManager.addControl('text', '城市关键词', 'cityKeywords', {
                value: this.settings.cityKeywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.cityKeywords = val; this.saveSettings(); }
            }));

            // 复选框选项
            container.appendChild(UIManager.addControl('checkbox', '排除猎头', 'excludeHeadhunters', {
                value: this.settings.excludeHeadhunters,
                onChange: (val) => { this.settings.excludeHeadhunters = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '自动回复', 'autoReply', {
                value: this.settings.autoReply || false,
                onChange: (val) => { this.settings.autoReply = val; this.saveSettings(); }
            }));

            // 图片简历设置区域
            const resumeSection = document.createElement('div');
            resumeSection.style.cssText = 'margin-top: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;';

            const resumeTitle = document.createElement('div');
            resumeTitle.textContent = '图片简历设置';
            resumeTitle.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #333; display: flex; justify-content: space-between; align-items: center;';

            // Auto send checkbox in title bar
            const autoSendLabel = document.createElement('label');
            autoSendLabel.style.cssText = 'font-size: 12px; font-weight: normal; display: flex; align-items: center;';
            const autoSendCheck = document.createElement('input');
            autoSendCheck.type = 'checkbox';
            autoSendCheck.checked = this.settings.useAutoSendImageResume || false;
            autoSendCheck.style.marginRight = '4px';
            autoSendCheck.onchange = (e) => {
                this.settings.useAutoSendImageResume = e.target.checked;
                this.saveSettings();
            };
            autoSendLabel.append(autoSendCheck, '自动发送');
            resumeTitle.appendChild(autoSendLabel);

            resumeSection.appendChild(resumeTitle);

            // Resume List
            const resumeList = document.createElement('div');
            resumeList.id = 'boss-resume-list';
            resumeList.style.cssText = 'margin-bottom: 8px; max-height: 100px; overflow-y: auto;';

            const renderResumeList = () => {
                resumeList.innerHTML = '';
                if (!this.settings.imageResumes || this.settings.imageResumes.length === 0) {
                    resumeList.textContent = '暂无简历';
                    resumeList.style.color = '#999';
                    resumeList.style.fontSize = '12px';
                    return;
                }

                this.settings.imageResumes.forEach((resume, index) => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px dashed #eee; font-size: 12px;';

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = resume.name;
                    nameSpan.title = resume.name;
                    nameSpan.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;';

                    const delBtn = document.createElement('button');
                    delBtn.textContent = '删除';
                    delBtn.style.cssText = 'padding: 2px 6px; background: #ff4444; color: white; border: none; border-radius: 2px; cursor: pointer; font-size: 10px;';
                    delBtn.onclick = () => {
                        if (confirm(`确定删除简历 "${resume.name}" 吗?`)) {
                            this.settings.imageResumes.splice(index, 1);
                            this.saveSettings();
                            renderResumeList();
                        }
                    };

                    item.append(nameSpan, delBtn);
                    resumeList.appendChild(item);
                });
            };
            renderResumeList();
            resumeSection.appendChild(resumeList);

            // Add Resume Button & Hidden Input
            const addResumeBtn = document.createElement('button');
            addResumeBtn.textContent = '➕ 添加简历';
            addResumeBtn.style.cssText = 'width: 100%; padding: 6px; background: #fff; border: 1px dashed #999; color: #666; cursor: pointer; border-radius: 4px; font-size: 12px;';

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            fileInput.onchange = (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    if (file.size > 2 * 1024 * 1024) { // 2MB limit warning
                         alert('建议图片大小不超过2MB');
                    }

                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (!this.settings.imageResumes) this.settings.imageResumes = [];
                        this.settings.imageResumes.push({
                            name: file.name,
                            data: event.target.result
                        });
                        this.saveSettings();
                        renderResumeList();
                        Core.log(`已添加简历: ${file.name}`, 'SUCCESS');
                    };
                    reader.readAsDataURL(file);
                }
                // Reset value to allow selecting same file again
                e.target.value = '';
            };

            addResumeBtn.onclick = () => fileInput.click();

            resumeSection.appendChild(addResumeBtn);
            resumeSection.appendChild(fileInput);

            container.appendChild(resumeSection);

            // 控制按钮组
            container.appendChild(UIManager.createControlButtons(this, 'boss-start-btn', 'boss-stop-btn'));

            // 日志操作按钮组
            container.appendChild(UIManager.createLogButtons(this));

            // 同步初始状态
            this.updateButtonState('boss-start-btn', 'boss-stop-btn', GlobalState.isRunning);
        }

        start() {
            Core.log('BOSS任务启动');
            GlobalState.isRunning = true;
            this.updateButtonState('boss-start-btn', 'boss-stop-btn', true);
            this.loop();
        }

        stop() {
            Core.log('BOSS任务停止');
            GlobalState.isRunning = false;
            this.updateButtonState('boss-start-btn', 'boss-stop-btn', false);
        }
    }



    // =================================================================
    // 8. 猎聘策略 (LiepinStrategy)
    // =================================================================
    /**
     * 猎聘平台策略实现
     * 处理猎聘网站的职位搜索、筛选和自动投递功能
     * 支持多标签页详情页处理模式
     * @class LiepinStrategy
     * @extends JobStrategy
     */
    class LiepinStrategy extends JobStrategy {
        constructor() {
            super();
            this.name = 'LiepinStrategy';
            this.platformPrefix = 'lp_';
            this.dailyCount = 0;
            this.settings = {
                keywords: '',
                cityKeywords: '',
                jobDescKeywords: '',
                excludeHeadhunters: false,
                dailyLimit: 200,
                autoClose: true
            };
        }

        // Helper to trace execution from detail page to list page
        trace(msg) {
            const logMsg = `[Det-${new Date().getSeconds()}] ${msg}`;
            // Core.log(logMsg); // Local log
            const old = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'debug_trace', '');
            const newLog = (old ? old + '\n' : '') + logMsg;
            const lines = newLog.split('\n');
            const kept = lines.slice(-5).join('\n'); // Keep last 5 lines
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'debug_trace', kept);
        }

        async init() {
            // Early trace
            if (this.isDetailPage()) {
                this.trace("策略初始化(Init)...");
            }

            Core.log('猎聘策略初始化...');
            this.loadSettings();

            // 0. 特殊处理：投递成功页面 (多种检测方式)
            const isSuccessPage =
                location.href.includes('/chat/im/success') ||
                location.href.includes('sojob/success') ||
                location.href.includes('success') ||
                document.querySelector('.apply-success, .success-page, .apply-result') ||
                document.title.includes('投递成功') ||
                document.title.includes('沟通成功') ||
                document.body.innerText.includes('投递成功') ||
                document.body.innerText.includes('沟通成功');

            if (isSuccessPage) {
                this.trace("检测到成功页，关闭中...");
                StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result', { status: 'success_apply' });
                setTimeout(() => window.close(), 500);
                return;
            }

            // 1. 恢复列表页运行状态
            const shouldRun = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'running_state', false);
            if (shouldRun && !this.isDetailPage()) {
                Core.log("恢复运行状态(列表页)...");
                this.start(false);
            }

            // 2. 检查是否是详情页自动任务 (宽松模式)
            if (this.isDetailPage()) {
                const task = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task');
                if (task && task.jobId) {
                    const now = Date.now();
                    const age = now - (task.timestamp || 0);
                    this.trace(`发现任务: ${task.jobId}, Age: ${age}ms`);

                    if (age < 60000) {
                        this.trace("任务有效，准备执行...");
                        this.trace("调用handleDetailPage...");
                        await this.handleDetailPage().catch(e => {
                            this.trace(`执行异常: ${e.message}`);
                            this.reportResult('fail');
                        });
                    } else {
                        this.trace("任务过期");
                    }
                } else {
                    this.trace("无有效任务数据");
                }
            }
        }

        // ... (methods skipped) ...

        async processSingleJob(job) {
            Core.log(`正在处理: ${job.title}`, "INFO");

            // 传递任务数据给详情页 (Add Timestamp)
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task', {
                jobId: job.id,
                jobDescKeywords: this.settings.jobDescKeywords,
                autoClose: this.settings.autoClose,
                timestamp: Date.now() // Add timestamp
            });

            // 打开详情页
            const newTab = GM_openInTab(job.link, { active: false, insert: true });

            // 等待详情页处理结果
            const result = await this.waitForTaskResult();
            // ... (rest of processSingleJob handling)

            // ...
        }

        // ... (methods skipped) ...



        async handleDetailPage() {
            this.trace("详情页逻辑启动 - URL: " + location.href);
            try {
                this.trace("进入详情页处理流程...");
                const task = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task');

                if (!task || !task.jobId) {
                    this.trace("未找到任务信息，退出。");
                    return;
                }

                // Check timestamp validity
                if (task.timestamp && (Date.now() - task.timestamp > 60000)) {
                    this.trace("任务时间戳过期，退出。");
                    return;
                }

                this.trace(`开始处理任务: ${task.jobId}`);
                this.updateButtonState(true);

                await Core.delay(2000);

                // 职责描述筛选
                if (task.jobDescKeywords) {
                    this.trace("正在进行关键词筛选...");
                    const desc = document.body.innerText;
                    const matched = this.getMatchedKeywords(desc, task.jobDescKeywords);
                    if (task.jobDescKeywords && matched.length === 0) {
                        const kws = task.jobDescKeywords.split(/[,，]/).filter(k => k.trim());
                        if (kws.length > 0) {
                            this.trace("关键词不匹配，跳过并关闭页面。");
                            this.reportResult('skip', { desc: [] });
                            // 匹配失败始终关闭页面
                            await Core.delay(300);
                            window.close();
                            return;
                        }
                    }
                    this.trace("关键词筛选通过。");
                }

                // 查找关键按钮 (Wait loop)
                let chatBtn = null;
                let applyBtn = null;
                let attempts = 0;
                const maxAttempts = 10;

                this.trace("开始寻找操作按钮...");
                while (attempts < maxAttempts) {
                    // 更全面的选择器，包括猜聘实际使用的类名
                    const allActions = Array.from(document.querySelectorAll(
                        'a.btn-main, a.btn-chat, a.btn-apply, a.btn-minor, a.btn-apply-job, ' +
                        '.apply-box a, .recruiter-container a, ' +
                        'a, button, div.btn-group span, .btn-container .btn, ' +
                        '.apply-btn-container .btn, .btns-item .btn, ' +
                        'button.ant-btn-primary'
                    ));

                    chatBtn = allActions.find(el => {
                        const t = el.innerText.trim();
                        return (t === '聊一聊' || t === '立即沟通' || t === '继续聊') && !t.includes('已');
                    });

                    applyBtn = allActions.find(el => {
                        const t = el.innerText.trim();
                        return (t === '投简历' || t === '立即投递' || t === '立即应聘') && !t.includes('已');
                    });

                    if (chatBtn || applyBtn) {
                        this.trace(`找到按钮: ${applyBtn ? '投简历' : ''} ${chatBtn ? '聊一聊' : ''}`);
                        break;
                    }

                    if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                        this.trace("检测到已投递状态 (文本)。");
                        break;
                    }

                    if (attempts % 2 === 0) this.trace(`寻找按钮中 (${attempts}/${maxAttempts})...`);
                    attempts++;
                    await Core.delay(1000);
                }

                let actionStatus = 'fail';
                let matchedDesc = [];
                if (task.jobDescKeywords) {
                    const desc = document.body.innerText;
                    matchedDesc = this.getMatchedKeywords(desc, task.jobDescKeywords);
                }

                if (applyBtn) {
                    if (chatBtn) {
                        this.trace("点击: 聊一聊");
                        chatBtn.click();
                        await Core.delay(1500);
                    }
                    this.trace("点击: 投简历");
                    applyBtn.click();
                    await Core.delay(1500);

                    const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button, .ant-modal a')).find(b => b.innerText.includes('立即投递'));
                    if (confirmBtn) {
                        this.trace("点击: 确认投递弹窗");
                        confirmBtn.click();
                        await Core.delay(1000);
                    } else {
                        const genericConfirm = document.querySelector('.ant-modal .ant-btn-primary');
                        if (genericConfirm) {
                            this.trace("点击: 通用确认弹窗");
                            genericConfirm.click();
                        }
                    }
                    actionStatus = 'success_apply';

                } else if (chatBtn) {
                    this.trace("点击: 仅聊一聊");
                    chatBtn.click();
                    await Core.delay(1000);
                    actionStatus = 'success_chat';
                } else {
                    if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                        actionStatus = 'success_chat';
                    } else {
                        this.trace("错误: 未找到有效按钮，且未检测到已投递状态。");
                        // Log DOM dump for debug? Toolong.
                    }
                }

                this.reportResult(actionStatus, { desc: matchedDesc });
                this.trace(`任务完成: ${actionStatus}`);

                // 任务完成后始终关闭页面
                this.trace("关闭页面...");
                await Core.delay(800);
                try {
                    window.close();
                } catch (e) {
                    // 备用方案
                    window.open('about:blank', '_self').close();
                }
            } catch (err) {
                this.trace(`严重错误: ${err.message}`);
                this.reportResult('fail');
                // 出错也关闭页面
                await Core.delay(500);
                window.close();
            }
        }

        isDetailPage() {
            return location.href.includes('/job/') || location.href.includes('/a/');
        }

        getMatchedKeywords(text, keywordsStr) {
            if (!keywordsStr) return [];
            const kws = keywordsStr.split(/[,，]/).filter(k => k.trim());
            return kws.filter(k => text.includes(k));
        }

        loadSettings() {
            const saved = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'settings', {});
            Object.assign(this.settings, saved);
        }

        saveSettings() {
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'settings', this.settings);
        }

        renderSettings(container) {
            container.innerHTML = '';

            // 职位关键词输入
            container.appendChild(UIManager.addControl('text', '职位关键词', 'keywords', {
                value: this.settings.keywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.keywords = val; this.saveSettings(); }
            }));

            // 城市关键词输入
            container.appendChild(UIManager.addControl('text', '城市关键词', 'cityKeywords', {
                value: this.settings.cityKeywords,
                placeholder: '例如: 北京,上海',
                onChange: (val) => { this.settings.cityKeywords = val; this.saveSettings(); }
            }));

            // 职位介绍关键词
            container.appendChild(UIManager.addControl('text', '职位介绍词', 'jobDescKeywords', {
                value: this.settings.jobDescKeywords,
                placeholder: '详情页筛选',
                onChange: (val) => { this.settings.jobDescKeywords = val; this.saveSettings(); }
            }));

            // 复选框选项
            container.appendChild(UIManager.addControl('checkbox', '排除猎头', 'excludeHeadhunters', {
                value: this.settings.excludeHeadhunters,
                onChange: (val) => { this.settings.excludeHeadhunters = val; this.saveSettings(); }
            }));

            // 数字输入
            container.appendChild(UIManager.addControl('number', '每日上限', 'dailyLimit', {
                value: this.settings.dailyLimit,
                onChange: (val) => { this.settings.dailyLimit = parseInt(val); this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '投递后自动关闭详情页', 'autoClose', {
                value: this.settings.autoClose,
                onChange: (val) => { this.settings.autoClose = val; this.saveSettings(); }
            }));

            // AI自动回复设置
            container.appendChild(UIManager.addControl('checkbox', '启用AI自动回复', 'autoReply', {
                value: this.settings.autoReply || false,
                onChange: (val) => { this.settings.autoReply = val; this.saveSettings(); }
            }));

            // 关键词回复设置区域
            const keywordReplySection = document.createElement('div');
            keywordReplySection.style.cssText = 'margin-top: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; background: #f9f9f9;';

            const sectionTitle = document.createElement('div');
            sectionTitle.textContent = '关键词自动回复设置';
            sectionTitle.style.cssText = 'font-weight: bold; margin-bottom: 8px; color: #333;';
            keywordReplySection.appendChild(sectionTitle);

            // 关键词回复输入区域
            const replyInput = document.createElement('div');
            replyInput.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 8px;';

            const keywordInput = document.createElement('input');
            keywordInput.type = 'text';
            keywordInput.placeholder = '关键词 (用逗号分隔)';
            keywordInput.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';

            const replyTextInput = document.createElement('input');
            replyTextInput.type = 'text';
            replyTextInput.placeholder = '回复内容';
            replyTextInput.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px;';

            const addBtn = document.createElement('button');
            addBtn.textContent = '添加';
            addBtn.style.cssText = 'padding: 6px 12px; background: var(--ujh-primary); color: white; border: none; border-radius: 4px; cursor: pointer;';
            addBtn.onclick = () => {
                const keyword = keywordInput.value.trim();
                const reply = replyTextInput.value.trim();
                if (keyword && reply) {
                    if (!this.settings.keywordReplies) {
                        this.settings.keywordReplies = [];
                    }
                    this.settings.keywordReplies.push({ keyword, reply });
                    this.saveSettings();
                    this.renderKeywordReplies(replyList);
                    keywordInput.value = '';
                    replyTextInput.value = '';
                }
            };

            replyInput.append(keywordInput, replyTextInput, addBtn);
            keywordReplySection.appendChild(replyInput);

            // 关键词回复列表
            const replyList = document.createElement('div');
            replyList.style.cssText = 'max-height: 150px; overflow-y: auto;';
            keywordReplySection.appendChild(replyList);

            // 渲染现有关键词回复
            this.renderKeywordReplies(replyList);

            container.appendChild(keywordReplySection);

            // 控制按钮组
            const controlButtons = UIManager.createControlButtons(this, 'liepin-start-btn', 'liepin-stop-btn');
            // 修改按钮点击事件以支持持久化
            controlButtons.querySelector('#liepin-start-btn').onclick = () => this.start(true);
            controlButtons.querySelector('#liepin-stop-btn').onclick = () => this.stop(true);
            container.appendChild(controlButtons);

            // 日志操作按钮组
            container.appendChild(UIManager.createLogButtons(this));

            // 同步初始状态
            this.updateButtonState('liepin-start-btn', 'liepin-stop-btn', GlobalState.isRunning);
        }

        /**
         * 渲染关键词回复列表
         * @param {Element} container - 列表容器
         */
        renderKeywordReplies(container) {
            container.innerHTML = '';

            if (!this.settings.keywordReplies || this.settings.keywordReplies.length === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.textContent = '暂无关键词回复规则';
                emptyMsg.style.cssText = 'color: #999; font-style: italic; padding: 8px;';
                container.appendChild(emptyMsg);
                return;
            }

            this.settings.keywordReplies.forEach((rule, index) => {
                const ruleItem = document.createElement('div');
                ruleItem.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px; margin-bottom: 4px; background: white; border-radius: 4px; border: 1px solid #eee;';

                const ruleText = document.createElement('div');
                ruleText.style.cssText = 'flex: 1;';
                ruleText.innerHTML = `<strong>${rule.keyword}</strong> → ${rule.reply}`;

                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '删除';
                deleteBtn.style.cssText = 'padding: 4px 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;';
                deleteBtn.onclick = () => {
                    this.settings.keywordReplies.splice(index, 1);
                    this.saveSettings();
                    this.renderKeywordReplies(container);
                };

                ruleItem.append(ruleText, deleteBtn);
                container.appendChild(ruleItem);
            });
        }

        start(persist = false) {
            Core.log('猎聘任务启动');
            GlobalState.isRunning = true;
            this.updateButtonState('liepin-start-btn', 'liepin-stop-btn', true);
            if (persist && !this.isDetailPage()) {
                StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'running_state', true);
            }
            this.loop();
        }

        stop(persist = false) {
            Core.log('猎聘任务停止');
            GlobalState.isRunning = false;
            this.updateButtonState('liepin-start-btn', 'liepin-stop-btn', false);
            if (persist && !this.isDetailPage()) {
                StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'running_state', false);
            }
        }

        async loop() {
            if (!GlobalState.isRunning) return;

            // 区分列表页和详情页
            if (location.href.includes('/job/') || location.href.includes('/a/')) {
                await this.handleDetailPage();
            } else {
                await this.processJobList();
            }
        }

        async processJobList() {
            if (!GlobalState.isRunning) return;

            // 高亮已投递职位
            this.highlightProcessedJobs();

            const jobCards = Array.from(document.querySelectorAll('.job-list-item, .sojob-item-main, [data-selector="job-card"]'));

            if (jobCards.length === 0) {
                Core.log("未检测到职位卡片，尝试翻页...");
                await this.goToNextPage();
                return;
            }

            for (const card of jobCards) {
                if (!GlobalState.isRunning) break;

                // 每日上限检查
                if (this.settings.dailyLimit > 0 && this.dailyCount >= this.settings.dailyLimit) {
                    Core.log(`⚠️ 已达到每日投递上限 (${this.settings.dailyLimit})`, 'WARNING');
                    this.stop();
                    return;
                }

                const jobInfo = this.extractJobInfo(card);
                if (!jobInfo.id) continue;

                // 检查是否已投递
                const processed = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed', []);
                if (processed.includes(jobInfo.id)) continue;

                // 筛选
                if (this.shouldSkip(jobInfo)) continue;

                // 处理单个职位
                await this.processSingleJob(jobInfo);

                // 立即更新UI高亮
                this.highlightProcessedJobs();

                await Core.delay(CONFIG.OPERATION_INTERVAL);
            }

            if (GlobalState.isRunning) {
                await this.goToNextPage();
            }
        }

        extractJobInfo(card) {
            // 1. 标题提取
            const titleSelectors = [
                '.job-title', '.job-name', '.title-text', '.subscribe-job-title',
                '.job-title-box', '.job-detail-box > div:first-child',
                '[data-selector="job-title"]', '.ellipsis-1', 'h3',
                '.job-card-pc-container .job-title'
            ];
            let titleEl = null;
            for (let sel of titleSelectors) {
                titleEl = card.querySelector(sel);
                if (titleEl) break;
            }
            let title = titleEl ? titleEl.innerText.trim() : "";

            // 2. 链接提取
            const linkEl = card.querySelector('a[href*="/job/"], a[href*="/a/"], a[data-selector="job-card-link"]');
            if (!title && linkEl) {
                // 补救措施
                if (!linkEl.innerText.includes("沟通") && !linkEl.innerText.includes("查看")) {
                    title = linkEl.innerText.trim();
                } else {
                    title = linkEl.getAttribute('title') || "";
                }
            }

            // 3. 公司提取
            const companySelectors = [
                '.company-name', '.company-text', '.job-company-name',
                '[data-selector="comp-name"]', '.company-info', '.company-name-box', 'h4'
            ];
            let companyEl = null;
            for (let sel of companySelectors) {
                companyEl = card.querySelector(sel);
                if (companyEl) break;
            }
            let company = companyEl ? companyEl.innerText.trim() : "未知公司";

            // 4. 地点提取
            const locSelectors = [
                '.job-dq-box', '.area', '.job-area', '.job-address',
                '[data-selector="job-dq"]', '.area-text', '.job-labels-box .labels-tag', '.ellipsis-1'
            ];
            let locEl = null;
            for (let sel of locSelectors) {
                const els = card.querySelectorAll(sel);
                for (let el of els) {
                    if (el !== titleEl && el !== companyEl) {
                        if (el.innerText.length < 20) { locEl = el; break; }
                    }
                }
                if (locEl) break;
            }
            let location = locEl ? locEl.innerText.trim() : "";

            const isHeadhunter = !!card.querySelector('img[alt="猎头"], .hunt-tag');
            const link = linkEl ? linkEl.href : '';

            const cleanLink = link ? link.split('?')[0] : '';
            return {
                id: cleanLink || (title + company),
                title, company, location, link, isHeadhunter
            };
        }

        shouldSkip(job) {
            // 关键词筛选
            if (this.settings.keywords) {
                const kws = this.settings.keywords.split(/[,，]/).filter(k => k.trim());
                if (kws.length > 0) {
                    const matched = kws.find(k => job.title.includes(k) || job.company.includes(k));
                    if (!matched) {
                        // Core.log(`跳过: 关键词不匹配 (${job.title})`, 'SKIP'); // 减少日志
                        return true;
                    }
                }
            }

            // 城市筛选
            if (this.settings.cityKeywords) {
                const cities = this.settings.cityKeywords.split(/[,，]/).filter(k => k.trim());
                if (cities.length > 0) {
                    const matched = cities.find(city => job.location.includes(city));
                    if (!matched) {
                        return true;
                    }
                }
            }

            // 猎头过滤
            if (this.settings.excludeHeadhunters && job.isHeadhunter) {
                Core.log(`跳过猎头职位: ${job.title}`, "SKIP");
                return true;
            }

            return false;
        }

        async processSingleJob(job) {
            Core.log(`正在处理: ${job.title}`, "INFO");

            // 传递任务数据给详情页
            // 传递任务数据给详情页
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task', {
                jobId: job.id,
                jobDescKeywords: this.settings.jobDescKeywords,
                autoClose: this.settings.autoClose,
                timestamp: Date.now()
            });

            // 打开详情页
            const newTab = GM_openInTab(job.link, { active: false, insert: true });

            // 等待详情页处理结果 (轮询 Storage)
            const result = await this.waitForTaskResult();

            // 关闭详情页 (从列表页主动关闭)
            try {
                if (newTab && typeof newTab.close === 'function') {
                    newTab.close();
                }
            } catch (e) {
                // 忽略关闭错误
            }

            let status = null;
            let resultData = {};

            if (typeof result === 'object' && result !== null) {
                status = result.status;
                resultData = result;
            } else {
                status = result;
            }

            if (status && status.startsWith('success')) {
                // Calculate and Log Matches
                const matchedTitle = this.getMatchedKeywords(job.title + job.company, this.settings.keywords);
                const matchedCity = this.getMatchedKeywords(job.location, this.settings.cityKeywords);
                const descStr = (resultData.desc && resultData.desc.length > 0) ? resultData.desc.join('|') :
                    (this.settings.jobDescKeywords ? "已验证" : "无限制");

                Core.log(`ℹ️匹配信息：职位:【${matchedTitle.join('|') || '无限制'}】 城市:【${matchedCity.join('|') || '无限制'}】 描述:【${descStr}】`, 'INFO');

                this.dailyCount++;
                const isApply = status.includes('apply');
                const logType = isApply ? '投递+沟通' : '仅沟通';
                Core.log(`${logType}成功 (今日: ${this.dailyCount})`, "SUCCESS");

                // 记录已投递 (Base list for skipping)
                const processed = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed', []);
                if (!processed.includes(job.id)) {
                    processed.push(job.id);
                    if (processed.length > 2000) processed.shift();
                    StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed', processed);
                }

                // 记录详细状态 (For UI Highlighting)
                const details = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed_details', {});
                details[job.id] = isApply ? 'apply' : 'chat';
                StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed_details', details);

            } else {
                Core.log(`投递跳过或失败 [${status}]`, "SKIP");
            }
        }

        async waitForTaskResult() {
            return new Promise(resolve => {
                let checks = 0;
                let lastTrace = "";
                const timer = setInterval(() => {
                    // Check Result
                    const result = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result');
                    if (result) {
                        clearInterval(timer);
                        StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result', null); // Clear
                        resolve(result);
                    }

                    // Poll Trace
                    const trace = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'debug_trace');
                    if (trace && trace !== lastTrace) {
                        Core.log(trace); // Print to List Page UI
                        lastTrace = trace;
                    }

                    if (checks++ > 30) { // 30秒超时
                        clearInterval(timer);
                        resolve('timeout');
                    }
                }, 1000);
            });
        }

        async goToNextPage() {
            // 1. 尝试滚动加载 (模拟无限滚动)
            let scrollAttempts = 0;
            const maxScrolls = 3;

            while (scrollAttempts < maxScrolls) {
                Core.log(`尝试滚动加载更多 (${scrollAttempts + 1}/${maxScrolls})...`);
                const previousHeight = document.body.scrollHeight;
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                await Core.delay(2000);

                const newHeight = document.body.scrollHeight;
                if (newHeight > previousHeight) {
                    Core.log("滚动加载成功，继续处理...");
                    if (GlobalState.isRunning) setTimeout(() => this.loop(), 1000);
                    return;
                }
                scrollAttempts++;
            }

            Core.log("检查翻页按钮...");

            // 优先检查 Ant Design 和常见的翻页类名
            const selectors = [
                '.ant-pagination-next:not([aria-disabled="true"])',
                '.pager .next:not(.disabled)',
                '.rc-pagination-next:not([aria-disabled="true"])',
                'li[title="Next Page"]:not([aria-disabled="true"])',
                '.el-pagination .btn-next:not(:disabled)',
                '.next-page-btn',
                '[data-selector="pager-next"]'
            ];

            let nextBtn = null;
            for (let s of selectors) {
                const btn = document.querySelector(s);
                // 确保按钮是可见的且未禁用
                if (btn && btn.offsetParent !== null && !btn.classList.contains('disabled')) {
                    nextBtn = btn;
                    break;
                }
            }

            // 特殊检查 Ant Design (某些情况下结构不同)
            if (!nextBtn) {
                const antNextLi = document.querySelector('.ant-pagination-next');
                if (antNextLi && !antNextLi.classList.contains('ant-pagination-disabled')) {
                    nextBtn = antNextLi;
                }
            }

            // 文本降级策略
            if (!nextBtn) {
                nextBtn = Array.from(document.querySelectorAll('a, button, li, div, span')).find(el => {
                    if (el.offsetParent === null) return false; // ignore hidden
                    const text = el.innerText.replace(/\s/g, '');
                    return (text === '下一页' || text === 'Next' || text === '>') &&
                        !el.className.includes('disabled') &&
                        !el.classList.contains('ant-pagination-disabled') &&
                        !el.getAttribute('disabled');
                });
            }

            if (nextBtn) {
                Core.log(`找到下一页按钮: ${nextBtn.className || nextBtn.tagName}`);
                Core.log("正在点击翻页...");
                nextBtn.click();
                await Core.delay(3000);
                // 递归循环
                if (GlobalState.isRunning) setTimeout(() => this.loop(), 1000);
            } else {
                Core.log("无下一页，任务结束");
                this.stop();
            }
        }

        highlightProcessedJobs() {
            // Read basic list and detailed map
            const processed = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed', []);
            const details = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'processed_details', {});

            const jobCards = document.querySelectorAll('.job-list-item, .sojob-item-main, [data-selector="job-card"]');

            jobCards.forEach(card => {
                const jobInfo = this.extractJobInfo(card);
                if (processed.includes(jobInfo.id)) {
                    // Determine status
                    const status = details[jobInfo.id] || 'chat'; // Default to chat (legacy red) if unknown
                    const isApply = status === 'apply';
                    const color = isApply ? '#4CAF50' : '#F44336'; // Green vs Red
                    const text = isApply ? '已投递' : '已沟通'; // "Applied" vs "Chatted"

                    card.style.border = `2px solid ${color}`;
                    card.style.position = 'relative';

                    // Remove old tag if exists to update it
                    const oldTag = card.querySelector('.processed-tag');
                    if (oldTag) oldTag.remove();

                    const tag = document.createElement('div');
                    tag.className = 'processed-tag';
                    tag.innerText = text;
                    tag.style.cssText = `
                         position: absolute; top: 0; right: 0; 
                         background: ${color}; color: white; padding: 2px 5px; 
                         font-size: 10px; z-index: 10;
                     `;
                    card.appendChild(tag);
                }
            });
        }

        async handleDetailPage() {
            // 详情页逻辑：读取任务 -> 筛选 -> 投递 -> 返回结果 -> 关闭
            const task = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task');
            if (!task || !task.jobId) return; // 不是自动任务打开的页面

            Core.log("正在执行自动投递任务...");

            // Sync UI state
            this.updateButtonState(true);

            await Core.delay(2000);

            // 职责描述筛选 (如果在详情页)
            if (task.jobDescKeywords) {
                const desc = document.body.innerText; // 简化获取
                const kws = task.jobDescKeywords.split(/[,，]/).filter(k => k.trim());
                if (kws.length > 0 && !kws.some(k => desc.includes(k))) {
                    Core.log("职责描述不匹配，跳过");
                    this.reportResult('skip');
                    if (task.autoClose) window.close();
                    return;
                }
            }

            // 查找关键按钮 (Wait loop)
            let chatBtn = null;
            let applyBtn = null;
            let attempts = 0;
            const maxAttempts = 10; // Wait up to 10s

            while (attempts < maxAttempts) {
                const allActions = Array.from(document.querySelectorAll('a, button, div.btn-group span, .btn-container .btn, .apply-btn-container .btn'));

                chatBtn = allActions.find(el => {
                    const t = el.innerText.trim();
                    return (t === '聊一聊' || t === '立即沟通') && !t.includes('已');
                });

                applyBtn = allActions.find(el => {
                    const t = el.innerText.trim();
                    return (t === '投简历' || t === '立即应聘') && !t.includes('已');
                });

                if (chatBtn || applyBtn) break;

                // Check if already finished
                if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                    break;
                }

                attempts++;
                await Core.delay(1000);
            }

            let actionStatus = 'fail';
            let matchedDesc = [];

            // Calculate description matches if success
            if (task.jobDescKeywords) {
                const desc = document.body.innerText;
                matchedDesc = this.getMatchedKeywords(desc, task.jobDescKeywords);
            }

            if (applyBtn) {
                // 场景 A: 有投简历按钮
                // 1. 先尝试聊一聊
                if (chatBtn) {
                    Core.log("执行: 聊一聊 (Chat)");
                    chatBtn.click();
                    await Core.delay(1500); // 等待响应
                }

                // 2. 执行投递
                Core.log("执行: 投简历 (Apply)");
                applyBtn.click();
                await Core.delay(1500);

                // 3. 处理弹窗确认 ("立即投递")
                const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button, .ant-modal a')).find(b => b.innerText.includes('立即投递'));
                if (confirmBtn) {
                    Core.log("确认投递弹窗...");
                    confirmBtn.click();
                    await Core.delay(1000);
                } else {
                    // 尝试通用选择器
                    const genericConfirm = document.querySelector('.ant-modal .ant-btn-primary');
                    if (genericConfirm) genericConfirm.click();
                }

                actionStatus = 'success_apply';

            } else if (chatBtn) {
                // 场景 B: 只有聊一聊
                Core.log("仅执行: 聊一聊 (Chat Only)");
                chatBtn.click();
                await Core.delay(1000);
                actionStatus = 'success_chat';
            } else {
                Core.log("未找到有效操作按钮 (No valid action button)", "ERROR");
                // 尝试查找是否有“已投递”标记
                if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                    Core.log("检测到已投递状态");
                    actionStatus = 'success_chat'; // Treat as handled (assume chat for safety)
                }
            }

            this.reportResult(actionStatus, { desc: matchedDesc });

            if (task.autoClose) {
                await Core.delay(1000);
                window.close();
            }
        }

        reportResult(status) {
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result', status);
        }
    }

    // =================================================================
    // 9. 主入口 (Main Entry)
    // =================================================================
    async function main() {
        console.log(">>> [JobHelper] Main execution started");

        try {
            UIManager.init();
            Core.startTiming('应用启动');

            // 初始化性能监控
            try { Core.initPerformance(); } catch (e) {}

            // Ensure body exists
            if (!document.body) {
                console.log(">>> [JobHelper] Waiting for body...");
                await Core.waitForElement(() => document.body, CONFIG.TIME.ELEMENT_WAIT_TIMEOUT);
            }

            // Debug Marker
            const marker = document.createElement('div');
            marker.id = 'ujh-debug-marker';
            marker.style.cssText = `
                position:fixed; bottom:0; right:0; width:10px; height:10px;
                background:rgba(255, 0, 0, 0.3); z-index:9999999;
                border-radius: 50%;
            `;
            document.body.appendChild(marker);
            console.log(">>> [JobHelper] Debug marker added (Red Dot at bottom-right)");

            // 检测平台
            const host = window.location.host;
            console.log(`>>> [JobHelper] Detected host: ${host}`);

            if (host.includes('zhipin.com')) {
                GlobalState.platform = CONFIG.PLATFORM.BOSS;
                GlobalState.strategy = new BossStrategy();
                marker.style.background = 'blue';
            } else if (host.includes('liepin.com')) {
                GlobalState.platform = CONFIG.PLATFORM.LIEPIN;
                GlobalState.strategy = new LiepinStrategy();
                marker.style.background = 'orange'; marker.onclick = () => UIManager.init();
            } else {
                console.warn(`>>> [JobHelper] Unknown platform: ${host}`);
                marker.style.background = 'gray';
                Core.log(MESSAGES.PLATFORM_DETECTED('未知平台'), 'WARNING');
                return;
            }
            marker.style.cursor = 'pointer';
            marker.title = '点击显示/隐藏面板';

            // 初始化 UI
            await Core.safeAsync(async () => {
                console.log(">>> [JobHelper] UI Initialized");
                marker.style.background = 'green';

                // 注册菜单命令
                try {
                    GM_registerMenuCommand("显示/隐藏 招聘助手", () => {
                        const panel = document.getElementById('ujh-panel');
                        if (panel) {
                            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
                        } else {
                            UIManager.init();
                        }
                    });

                    GM_registerMenuCommand("导出日志", () => Core.exportLogs());
                    GM_registerMenuCommand("性能报告", () => {
                        const report = Core.getPerformanceReport();
                        alert(`性能报告:
运行时间: ${report.uptime}秒
内存使用: ${report.memoryUsage}MB
峰值内存: ${report.peakMemory}MB
活跃操作: ${report.operationsCount}`);
                    });
                } catch (error) {
                    Core.handleError(error, '菜单命令注册失败');
                }
            }, 'UI初始化');

            // 初始化策略
            if (GlobalState.strategy) {
                await Core.safeAsync(async () => {
                    GlobalState.strategy.init();
                    // 渲染策略特定的设置
                    if (UIManager.contentContainer) {
                        GlobalState.strategy.renderSettings(UIManager.contentContainer);
                    }
                }, '策略初始化');
            }

            Core.endTiming('应用启动', true);
            Core.log('Universal Job Helper 初始化完成', 'SUCCESS');

            // 设置页面卸载时的清理
            window.addEventListener('beforeunload', () => {
                try {
                    UIManager.cleanup();
                    Core.log('应用资源清理完成', 'DEBUG');
                } catch (error) {
                    console.error('清理失败:', error);
                }
            });

        } catch (error) {
            Core.handleError(error, '应用启动失败');
            console.error(">>> [JobHelper] Main Crashed", error);
        }
    }

    main().catch(e => console.error(">>> [JobHelper] Main Crashed", e));

    // 暴露给 window 以便调试和外部调用
    window.JobHelper = {
        // 核心模块
        Core,
        StorageManager,
        UIManager,
        GlobalState,

        // 配置常量
        CONFIG,
        SELECTORS,
        REGEX,
        MESSAGES,

        // 策略类
        JobStrategy,
        BossStrategy,
        LiepinStrategy,

        // 工具方法
        getPerformanceReport: () => Core.getPerformanceReport(),
        getUIState: () => UIManager.getUIState(),
        getStrategyStats: () => GlobalState.strategy ? GlobalState.strategy.getStats() : null,
        cleanup: () => UIManager.cleanup(),

        // 版本信息
        version: '3.1.0',
        buildDate: new Date().toISOString()
    };

})();

