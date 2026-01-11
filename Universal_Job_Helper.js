// ==UserScript==
// @name         Universal Job Helper (Boss & Liepin)
// @namespace    https://github.com/yangshengzhou03
// @version      3.0.2
// @description  二合一招聘助手：支持 BOSS直聘 和 猎聘。基于策略模式架构，统一 UI 风格。
// @author       Yangshengzhou / Refactored by Assistant
// @match        https://www.zhipin.com/*
// @match        https://www.liepin.com/*
// @match        https://c.liepin.com/*
// @match        https://liepin.com/*
// @match        https://*.liepin.com/*
// @include      https://www.liepin.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @license      AGPL-3.0-or-later
// ==/UserScript==


(function () {
    "use strict";
    console.log(">>> [JobHelper] IIFE Start");

    // =================================================================
    // 1. 基础配置 (Global Configuration)
    // =================================================================
    const CONFIG = {
        BASIC_INTERVAL: 1000,
        OPERATION_INTERVAL: 1200,

        DELAYS: {
            SHORT: 30,
            MEDIUM_SHORT: 200,
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
            // 策略特定的 key 前缀
            PREFIX_BOSS: "boss_",
            PREFIX_LIEPIN: "lp_"
        },

        // 平台标识
        PLATFORM: {
            BOSS: 'boss',
            LIEPIN: 'liepin',
            UNKNOWN: 'unknown'
        }
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
    // 2. 核心工具 (Core Utilities)
    // =================================================================
    const Core = {
        /**
         * 增强型日志方法
         */
        log(message, level = "INFO") {
            const time = new Date().toLocaleTimeString();
            const levelInfo = LOG_LEVEL[level] || LOG_LEVEL.INFO;
            const logEntry = `[${time}] ${levelInfo.icon} ${message}`;

            console.log(`[JobHelper] ${message}`);

            // UI 日志输出 (如果 UI 已初始化)
            if (typeof UIManager !== 'undefined' && UIManager.logPanel) {
                UIManager.appendLog(logEntry, levelInfo.color);
            }
        },

        async delay(ms) {
            const variance = ms * 0.2; // 20% 随机波动
            const actualMs = ms + (Math.random() * variance * 2 - variance);
            return new Promise((resolve) => setTimeout(resolve, actualMs));
        },

        async smartDelay(baseTime) {
            return this.delay(baseTime);
        },

        async waitForElement(selectorOrFunction, timeout = 10000) {
            return new Promise((resolve) => {
                let element;
                const getEl = () => {
                    if (typeof selectorOrFunction === "function") return selectorOrFunction();
                    return document.querySelector(selectorOrFunction);
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

                observer.observe(document.body, { childList: true, subtree: true });
            });
        },

        async simulateClick(element) {
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const eventOpts = {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
            };

            element.dispatchEvent(new MouseEvent("mouseover", eventOpts));
            await this.delay(30);
            element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
            await this.delay(30);
            element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
            await this.delay(30);
            element.click();
        },

        extractTwoCharKeywords(text) {
            const keywords = [];
            const cleanedText = text.replace(/[\s,，.。:：;；""''\[\]\(\)\{\}]/g, "");
            for (let i = 0; i < cleanedText.length - 1; i++) {
                keywords.push(cleanedText.substring(i, i + 2));
            }
            return keywords;
        },

        exportLogs() {
            if (typeof UIManager === 'undefined' || !UIManager.logPanel) {
                alert("没有日志可导出");
                return;
            }
            const lines = Array.from(UIManager.logPanel.children).map(d => d.textContent).join('\n');
            const blob = new Blob([lines], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `job_helper_logs_${new Date().toISOString().slice(0, 10)}.txt`;
            a.click();
        }
    };

    // =================================================================
    // 3. 存储管理 (Storage Manager)
    // =================================================================
    class StorageManager {
        static get(key, defaultValue) {
            try {
                // 优先尝试 GM_getValue (支持跨域/跨标签页更强)
                const val = GM_getValue(key);
                return val !== undefined ? val : defaultValue;
            } catch (e) {
                // 降级到 localStorage
                try {
                    const localVal = localStorage.getItem(key);
                    return localVal ? JSON.parse(localVal) : defaultValue;
                } catch (e2) {
                    return defaultValue;
                }
            }
        }

        static set(key, value) {
            try {
                GM_setValue(key, value);
            } catch (e) {
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                } catch (e2) {
                    console.error("Storage save failed", e2);
                }
            }
        }

        static addRecordWithLimit(key, record, limit) {
            let records = this.get(key, []);
            if (!Array.isArray(records)) records = [];

            // 简单的去重
            if (records.includes(record)) return;

            records.push(record);
            if (records.length > limit) {
                records.shift();
            }
            this.set(key, records);
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
    const UIManager = {
        panel: null,
        logPanel: null,
        contentContainer: null,

        init() {
            this.createPanel();
            this.setupGlobalStyles();
        },

        setupGlobalStyles() {
            // 设置 CSS 变量
            const root = document.documentElement;
            root.style.setProperty('--ujh-primary', CONFIG.COLORS.primary);
            root.style.setProperty('--ujh-secondary', CONFIG.COLORS.secondary);
            root.style.setProperty('--ujh-accent', CONFIG.COLORS.accent);
            root.style.setProperty('--ujh-neutral', CONFIG.COLORS.neutral);
        },

        createPanel() {
            if (document.getElementById('ujh-panel')) return;

            const panel = document.createElement('div');
            panel.id = 'ujh-panel';
            panel.style.cssText = `
                position: fixed;
                top: 100px;
                right: 20px;
                width: 320px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.25);
                z-index: 2147483647 !important;
                font-family: system-ui, sans-serif;
                border: 1px solid var(--ujh-accent);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                pointer-events: auto;
            `;

            // Header
            const header = this.createHeader();

            // Dynamic Content Area (Strategy Specific)
            this.contentContainer = document.createElement('div');
            this.contentContainer.id = 'ujh-content';
            this.contentContainer.style.padding = '12px';
            this.contentContainer.style.background = 'var(--ujh-secondary)';

            // Log Area
            this.logPanel = this.createLogPanel();

            // Footer
            const footer = this.createFooter();

            panel.append(header, this.contentContainer, this.logPanel, footer);
            document.body.appendChild(panel);
            this.panel = panel;

            this.makeDraggable(panel, header);
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
            if (!this.logPanel) return;
            const div = document.createElement('div');
            div.textContent = msg;
            div.style.color = color || '#333';
            div.style.marginBottom = '4px';
            div.style.borderBottom = '1px dashed #f0f0f0';
            this.logPanel.appendChild(div);
            this.logPanel.scrollTop = this.logPanel.scrollHeight;
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
        }
    };

    // =================================================================
    // 6. 策略基类与接口 (Strategy Interface - Object Version)
    // =================================================================

    // =================================================================
    // 6. 策略基类与接口 (Strategy Interface)
    // =================================================================
    class JobStrategy {
        constructor() {
            this.name = 'BaseStrategy';
        }
        init() { console.log('Init strategy'); }
        start() { console.log('Start strategy'); }
        stop() { console.log('Stop strategy'); }
        renderSettings(container) { container.textContent = 'No settings'; }

        recoverState() { }

        exportLogs() {
            Core.exportLogs();
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
    class BossStrategy extends JobStrategy {
        constructor() {
            super();
            this.name = 'BossStrategy';
            this.settings = {
                keywords: '',
                locationKeywords: '',
                jobDescKeywords: '',
                cityKeywords: '',
                excludeHeadhunters: false,
                autoScroll: true,
                autoReply: false,
                keywordReplies: [] // [{keyword:'xx', reply:'xx'}]
            };
            this.lastProcessedMessage = null;
            this.processingMessage = false;
            this.currentIndex = 0;
        }

        init() {
            Core.log('BOSS策略初始化...');
            this.loadSettings();
        }

        loadSettings() {
            const saved = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_BOSS + 'settings', {});
            Object.assign(this.settings, saved);
        }

        saveSettings() {
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_BOSS + 'settings', this.settings);
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
            const jobCards = Array.from(document.querySelectorAll("li.job-card-box"));

            // 过滤逻辑
            const validCards = [];
            for (const card of jobCards) {
                if (await this.shouldProcessCard(card)) {
                    validCards.push(card);
                }
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

            const chatBtn = currentCard.querySelector("a.op-btn-chat");
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
            const title = card.querySelector(".job-name")?.textContent?.toLowerCase() || "";
            const addressText = (
                card.querySelector(".job-address-desc")?.textContent ||
                card.querySelector(".company-location")?.textContent ||
                card.querySelector(".job-area")?.textContent || ""
            ).toLowerCase().trim();

            const headhuntingElement = card.querySelector(".job-tag-icon");
            const altText = headhuntingElement ? headhuntingElement.alt : "";

            // 职位名筛选
            if (this.settings.keywords) {
                const keywords = this.settings.keywords.split(/[,，]/).filter(k => k.trim());
                if (keywords.length > 0) {
                    const matched = keywords.find(kw => title.includes(kw.toLowerCase().trim()));
                    if (!matched) return false;
                }
            }

            // 地点筛选
            if (this.settings.locationKeywords) {
                const keywords = this.settings.locationKeywords.split(/[,，]/).filter(k => k.trim());
                if (keywords.length > 0) {
                    const matched = keywords.find(kw => addressText.includes(kw.toLowerCase().trim()));
                    if (!matched) return false;
                }
            }

            // 城市筛选
            if (this.settings.cityKeywords) {
                const keywords = this.settings.cityKeywords.split(/[,，]/).filter(k => k.trim());
                if (keywords.length > 0) {
                    const matched = keywords.find(kw => addressText.includes(kw.toLowerCase().trim()));
                    if (!matched) return false;
                }
            }

            // 猎头过滤
            if (this.settings.excludeHeadhunters && altText.includes("猎头")) {
                return false;
            }

            return true;
        }

        async goToNextPage() {
            Core.log("尝试翻页...");
            let nextBtn = document.querySelector(".ui-icon-arrow-right")?.closest("a") ||
                Array.from(document.querySelectorAll(".options-pages a")).find(a => a.textContent.includes("下一页"));

            if (nextBtn && !nextBtn.classList.contains("disabled")) {
                nextBtn.click();
                await Core.delay(3000);
                return true;
            }
            return false;
        }

        async handleGreetingModal() {
            await Core.delay(2000);
            const btn = [...document.querySelectorAll(".default-btn.cancel-btn")].find(b => b.textContent.trim() === "留在此页");
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
            const chatContainer = document.querySelector(".chat-message .im-list");
            if (!chatContainer) return;

            const friendMessages = Array.from(chatContainer.querySelectorAll("li.message-item.item-friend"));
            if (friendMessages.length === 0) return;

            const lastMessageEl = friendMessages[friendMessages.length - 1];
            const textEl = lastMessageEl.querySelector(".text span");
            const text = textEl?.textContent?.trim();

            if (text && text !== this.lastProcessedMessage) {
                this.lastProcessedMessage = text;
                Core.log(`收到新消息: ${text}`, "INFO");

                // 关键词自动回复
                if (this.settings.keywordReplies && this.settings.keywordReplies.length > 0) {
                    // TODO: 实现具体的回复发送逻辑
                    Core.log("关键词匹配回复逻辑待实现", "DEBUG");
                }
            }
        }

        async sendResume() {
            // Ported minimal version
            const resumeBtn = [...document.querySelectorAll(".toolbar-btn")].find(el => el.textContent.trim() === "发简历");
            if (resumeBtn && !resumeBtn.classList.contains('unable')) {
                resumeBtn.click();
                await Core.delay(1000);
                // 确认弹窗
                const confirmBtn = document.querySelector(".btn-sure-v2");
                if (confirmBtn) confirmBtn.click();
                Core.log("尝试发送简历", "INFO");
                return true;
            }
            return false;
        }

        renderSettings(container) {
            container.innerHTML = '';
            container.appendChild(UIManager.addControl('text', '职位关键词', 'keywords', {
                value: this.settings.keywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.keywords = val; this.saveSettings(); }
            }));

            // 新增：职责描述关键词
            container.appendChild(UIManager.addControl('text', '职责关键词', 'jobDescKeywords', {
                value: this.settings.jobDescKeywords,
                placeholder: '详情页筛选',
                onChange: (val) => { this.settings.jobDescKeywords = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '排除猎头', 'excludeHeadhunters', {
                value: this.settings.excludeHeadhunters,
                onChange: (val) => { this.settings.excludeHeadhunters = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '自动回复', 'autoReply', {
                value: this.settings.autoReply || false,
                onChange: (val) => { this.settings.autoReply = val; this.saveSettings(); }
            }));

            // 按钮组容器
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';
            btnGroup.style.marginBottom = '10px';

            const startBtn = document.createElement('button');
            startBtn.id = 'boss-start-btn';
            startBtn.textContent = '开始运行';
            startBtn.style.cssText = `flex: 1; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; background: var(--ujh-primary); color: white;`;
            startBtn.onclick = () => this.start();

            const stopBtn = document.createElement('button');
            stopBtn.id = 'boss-stop-btn';
            stopBtn.textContent = '停止';
            stopBtn.style.cssText = `flex: 1; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; background: ${CONFIG.COLORS.neutral}; color: white;`;
            stopBtn.onclick = () => this.stop();

            btnGroup.append(startBtn, stopBtn);
            container.appendChild(btnGroup);

            // Log Buttons Group
            const logBtnGroup = document.createElement('div');
            logBtnGroup.style.display = 'flex';
            logBtnGroup.style.gap = '10px';
            logBtnGroup.style.marginBottom = '10px';

            const exportBtn = document.createElement('button');
            exportBtn.textContent = '导出日志';
            exportBtn.style.cssText = `flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; background: var(--ujh-primary); color: white; opacity: 0.9;`;
            exportBtn.onclick = () => this.exportLogs();

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清空日志';
            clearBtn.style.cssText = `flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; background: ${CONFIG.COLORS.warning}; color: white; opacity: 0.9;`;
            clearBtn.onclick = () => {
                if (UIManager.logPanel) UIManager.logPanel.innerHTML = '';
            };

            logBtnGroup.append(exportBtn, clearBtn);
            container.appendChild(logBtnGroup);

            // Sync initial state
            this.updateButtonState(GlobalState.isRunning);
        }

        updateButtonState(isRunning) {
            const startBtn = document.getElementById('boss-start-btn');
            const stopBtn = document.getElementById('boss-stop-btn');

            if (startBtn && stopBtn) {
                if (isRunning) {
                    startBtn.textContent = '运行中...';
                    startBtn.style.background = '#81c784'; // Light Green
                    startBtn.disabled = true;
                    stopBtn.style.background = CONFIG.COLORS.warning; // Orange/Red for stop active
                    stopBtn.disabled = false;
                } else {
                    startBtn.textContent = '开始运行';
                    startBtn.style.background = 'var(--ujh-primary)';
                    startBtn.disabled = false;
                    stopBtn.style.background = CONFIG.COLORS.neutral;
                    stopBtn.disabled = true;
                }
            }
        }

        start() {
            Core.log('BOSS任务启动');
            GlobalState.isRunning = true;
            this.updateButtonState(true);
            this.loop();
        }

        stop() {
            Core.log('BOSS任务停止');
            GlobalState.isRunning = false;
            this.updateButtonState(false);
        }
    }



    // =================================================================
    // 8. 猎聘策略 (LiepinStrategy)
    // =================================================================
    class LiepinStrategy extends JobStrategy {
        constructor() {
            super();
            this.name = 'LiepinStrategy';
            this.dailyCount = 0;
            this.settings = {
                keywords: '',
                dailyLimit: 200,
                autoClose: true
            };
        }

        init() {
            Core.log('猎聘策略初始化...');
            this.loadSettings();

            // 0. 特殊处理：投递成功页面 (URL check or Content check)
            if (location.href.includes('/chat/im/success') ||
                document.querySelector('.apply-success') ||
                document.title.includes('投递成功')) {
                const task = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task');
                if (task && task.autoClose) {
                    Core.log("检测到投递成功页面，即将关闭...");
                    StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result', 'success');
                    setTimeout(() => window.close(), 1000);
                    return;
                }
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
                    // Check validity (prevent zombie tasks)
                    const now = Date.now();
                    // Task valid for 60 seconds
                    if (task.timestamp && (now - task.timestamp < 60000)) {
                        Core.log("检测到活跃自动投递任务，开始执行...");
                        this.start(false);
                    } else {
                        Core.log("当前暂无活跃任务或任务已过期", "DEBUG");
                    }
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
            try {
                // 详情页逻辑：读取任务 -> 筛选 -> 投递 -> 返回结果 -> 关闭
                const task = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task');
                if (!task || !task.jobId) return;

                Core.log("正在执行自动投递任务...");

                // Sync UI state
                this.updateButtonState(true);

                await Core.delay(2000); // Wait for page stability

                // 职责描述筛选
                if (task.jobDescKeywords) {
                    // ... (keyword logic)
                    const desc = document.body.innerText;
                    const matched = this.getMatchedKeywords(desc, task.jobDescKeywords);
                    // If keywords set but no match found:
                    if (task.jobDescKeywords && matched.length === 0) {
                        // Double check if using "white list" logic or "must contain" logic?
                        // User phrasing "筛选" implies "must contain".
                        // If user provided keywords, and NONE appear, skip.
                        const kws = task.jobDescKeywords.split(/[,，]/).filter(k => k.trim());
                        if (kws.length > 0) {
                            Core.log("职责描述不匹配，跳过");
                            this.reportResult('skip', { desc: [] });
                            if (task.autoClose) window.close();
                            return;
                        }
                    }
                }

                // 查找关键按钮 (Wait loop)
                let chatBtn = null;
                let applyBtn = null;
                let attempts = 0;
                const maxAttempts = 10;

                while (attempts < maxAttempts) {
                    const allActions = Array.from(document.querySelectorAll('a, button, div.btn-group span, .btn-container .btn, .apply-btn-container .btn, [data-selector="chat-btn"], [data-selector="apply-btn"]'));

                    chatBtn = allActions.find(el => {
                        const t = el.innerText.trim();
                        // Handle icon-only or complex structure? Usually text is present.
                        return (t === '聊一聊' || t === '立即沟通') && !t.includes('已');
                    });

                    applyBtn = allActions.find(el => {
                        const t = el.innerText.trim();
                        return (t === '投简历' || t === '立即应聘') && !t.includes('已');
                    });

                    if (chatBtn || applyBtn) break;

                    if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                        break;
                    }

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
                    // Logic A
                    if (chatBtn) {
                        Core.log("执行: 聊一聊");
                        chatBtn.click();
                        await Core.delay(1500);
                    }
                    Core.log("执行: 投简历");
                    applyBtn.click();
                    await Core.delay(1500);

                    const confirmBtn = Array.from(document.querySelectorAll('.ant-modal button, .ant-modal a')).find(b => b.innerText.includes('立即投递'));
                    if (confirmBtn) {
                        confirmBtn.click();
                        await Core.delay(1000);
                    } else {
                        const genericConfirm = document.querySelector('.ant-modal .ant-btn-primary');
                        if (genericConfirm) genericConfirm.click();
                    }
                    actionStatus = 'success_apply';

                } else if (chatBtn) {
                    // Logic B
                    Core.log("仅执行: 聊一聊");
                    chatBtn.click();
                    await Core.delay(1000);
                    actionStatus = 'success_chat';
                } else {
                    if (document.body.innerText.includes('已投递') || document.body.innerText.includes('已沟通')) {
                        Core.log("检测到已投递状态");
                        actionStatus = 'success_chat';
                    } else {
                        Core.log("未找到有效操作按钮", "ERROR");
                    }
                }

                this.reportResult(actionStatus, { desc: matchedDesc });

                if (task.autoClose) {
                    await Core.delay(1000);
                    window.close();
                }
            } catch (err) {
                Core.log(`详情页执行出错: ${err.message}`, "ERROR");
                this.reportResult('fail'); // Ensure we unblock list page
            }
        }

        isDetailPage() {
            return location.href.includes('/job/') || location.href.includes('/a/');
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

            container.appendChild(UIManager.addControl('text', '职位关键词', 'keywords', {
                value: this.settings.keywords,
                placeholder: '逗号分隔',
                onChange: (val) => { this.settings.keywords = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('text', '城市关键词', 'cityKeywords', {
                value: this.settings.cityKeywords,
                placeholder: '例如: 北京,上海',
                onChange: (val) => { this.settings.cityKeywords = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('text', '职位介绍词', 'jobDescKeywords', {
                value: this.settings.jobDescKeywords,
                placeholder: '详情页筛选',
                onChange: (val) => { this.settings.jobDescKeywords = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '排除猎头', 'excludeHeadhunters', {
                value: this.settings.excludeHeadhunters,
                onChange: (val) => { this.settings.excludeHeadhunters = val; this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('number', '每日上限', 'dailyLimit', {
                value: this.settings.dailyLimit,
                onChange: (val) => { this.settings.dailyLimit = parseInt(val); this.saveSettings(); }
            }));

            container.appendChild(UIManager.addControl('checkbox', '投递后自动关闭详情页', 'autoClose', {
                value: this.settings.autoClose,
                onChange: (val) => { this.settings.autoClose = val; this.saveSettings(); }
            }));

            // 按钮组容器
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';
            btnGroup.style.marginBottom = '10px';

            const startBtn = document.createElement('button');
            startBtn.id = 'liepin-start-btn';
            startBtn.textContent = '开始运行';
            startBtn.style.cssText = `flex: 1; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; background: var(--ujh-primary); color: white;`;
            startBtn.onclick = () => this.start(true); // User click -> persist

            const stopBtn = document.createElement('button');
            stopBtn.id = 'liepin-stop-btn';
            stopBtn.textContent = '停止';
            stopBtn.style.cssText = `flex: 1; padding: 8px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; background: ${CONFIG.COLORS.neutral}; color: white;`;
            stopBtn.onclick = () => this.stop(true); // User click -> persist

            btnGroup.append(startBtn, stopBtn);
            container.appendChild(btnGroup);

            // Log Buttons Group
            const logBtnGroup = document.createElement('div');
            logBtnGroup.style.display = 'flex';
            logBtnGroup.style.gap = '10px';
            logBtnGroup.style.marginBottom = '10px';

            const exportBtn = document.createElement('button');
            exportBtn.textContent = '导出日志';
            exportBtn.style.cssText = `flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; background: var(--ujh-primary); color: white; opacity: 0.9;`;
            exportBtn.onclick = () => this.exportLogs();

            const clearBtn = document.createElement('button');
            clearBtn.textContent = '清空日志';
            clearBtn.style.cssText = `flex: 1; padding: 6px; border: none; border-radius: 4px; cursor: pointer; background: ${CONFIG.COLORS.warning}; color: white; opacity: 0.9;`;
            clearBtn.onclick = () => {
                if (UIManager.logPanel) UIManager.logPanel.innerHTML = '';
            };

            logBtnGroup.append(exportBtn, clearBtn);
            container.appendChild(logBtnGroup);

            // Sync initial state
            this.updateButtonState(GlobalState.isRunning);
        }

        updateButtonState(isRunning) {
            const startBtn = document.getElementById('liepin-start-btn');
            const stopBtn = document.getElementById('liepin-stop-btn');

            if (startBtn && stopBtn) {
                if (isRunning) {
                    startBtn.textContent = '运行中...';
                    startBtn.style.background = '#81c784'; // Light Green
                    startBtn.disabled = true;
                    stopBtn.style.background = CONFIG.COLORS.warning; // Orange/Red for stop active
                    stopBtn.disabled = false;
                } else {
                    startBtn.textContent = '开始运行';
                    startBtn.style.background = 'var(--ujh-primary)';
                    startBtn.disabled = false;
                    stopBtn.style.background = CONFIG.COLORS.neutral;
                    stopBtn.disabled = true;
                }
            }
        }

        start(persist = false) {
            Core.log('猎聘任务启动');
            GlobalState.isRunning = true;
            this.updateButtonState(true);
            if (persist && !this.isDetailPage()) {
                StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'running_state', true);
            }
            this.loop();
        }

        stop(persist = false) {
            Core.log('猎聘任务停止');
            GlobalState.isRunning = false;
            this.updateButtonState(false);
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
            StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'current_task', {
                jobId: job.id,
                jobDescKeywords: this.settings.jobDescKeywords, // 传递筛选参数
                autoClose: this.settings.autoClose
            });

            // 打开详情页
            const newTab = GM_openInTab(job.link, { active: false, insert: true });

            // 等待详情页处理结果 (轮询 Storage)
            const result = await this.waitForTaskResult();

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
                const timer = setInterval(() => {
                    const result = StorageManager.get(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result');
                    if (result) {
                        clearInterval(timer);
                        StorageManager.set(CONFIG.STORAGE_KEYS.PREFIX_LIEPIN + 'task_result', null); // Clear
                        resolve(result);
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

        // Ensure body exists
        if (!document.body) {
            console.log(">>> [JobHelper] Waiting for body...");
            await new Promise(r => {
                const obs = new MutationObserver(() => {
                    if (document.body) { obs.disconnect(); r(); }
                });
                obs.observe(document.documentElement, { childList: true });
            });
        }

        // Debug Marker
        const marker = document.createElement('div');
        marker.style.cssText = 'position:fixed; bottom:0; right:0; width:10px; height:10px; background:red; z-index:9999999; pointer-events:none;';
        document.body.appendChild(marker);
        console.log(">>> [JobHelper] Debug marker added (Red Dot at bottom-right)");

        const host = window.location.host;
        console.log(`>>> [JobHelper] Detected host: ${host}`);

        if (host.includes('zhipin.com')) {
            GlobalState.platform = CONFIG.PLATFORM.BOSS;
            GlobalState.strategy = new BossStrategy();
        } else if (host.includes('liepin.com')) {
            GlobalState.platform = CONFIG.PLATFORM.LIEPIN;
            GlobalState.strategy = new LiepinStrategy();
        } else {
            console.warn(`>>> [JobHelper] Unknown platform: ${host}`);
            marker.style.background = 'gray';
            return;
        }

        // 初始化 UI
        try {
            UIManager.init();
            console.log(">>> [JobHelper] UI Initialized");
            marker.style.background = 'green';

            // 注册菜单命令
            GM_registerMenuCommand("显示/隐藏 招聘助手", () => {
                const panel = document.getElementById('ujh-panel');
                if (panel) {
                    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
                } else {
                    UIManager.init();
                }
            });
        } catch (e) {
            console.error(">>> [JobHelper] UI Init Failed", e);
            marker.style.background = 'yellow';
        }

        // 初始化策略
        if (GlobalState.strategy) {
            try {
                GlobalState.strategy.init();
                // 渲染策略特定的设置
                if (UIManager.contentContainer) {
                    GlobalState.strategy.renderSettings(UIManager.contentContainer);
                }
            } catch (e) {
                console.error(">>> [JobHelper] Strategy Init Failed", e);
            }
        }
    }

    main().catch(e => console.error(">>> [JobHelper] Main Crashed", e));

    // 暴露给 window 以便调试
    window.JobHelper = { Core, StorageManager, GlobalState, CONFIG, UIManager };

})();

