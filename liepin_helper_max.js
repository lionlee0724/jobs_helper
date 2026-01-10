// ==UserScript==
// @name         猎聘海投助手 Max
// @namespace    http://tampermonkey.net/
// @version      1.1.2
// @description  猎聘网自动投递职位，支持关键词屏蔽、自动翻页、跨子域通信。
// @author       You
// @match        https://*.liepin.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @icon         https://www.liepin.com/favicon.ico
// @license      AGPL-3.0-or-later
// ==/UserScript==

(function () {
    'use strict';

    // --- 配置 ---
    const CONFIG = {
        STORAGE_KEYS: {
            SETTINGS: 'lp_helper_settings',
            PROCESSED_JOBS: 'lp_helper_processed',
            CURRENT_TASK: 'lp_helper_current_task',
            STATS: 'lp_helper_stats'
        },
        COLORS: {
            primary: '#ff6600', // 猎聘橙
            border: '2px solid red'
        },
        BASIC_INTERVAL: 1500, // 卡片处理间隔
        DETAIL_STAY_TIME: 3000 // 详情页模拟阅读时间
    };

    // --- 全局状态 ---
    const state = {
        isRunning: false,
        processedJobs: new Set(),
        currentCard: null,
        stats: {
            success: 0,
            fail: 0
        },
        settings: {
            keywords: "",  // 职位关键词
            locationKeywords: "",
            excludeHeadhunters: false, // 排除猎头
            autoCloseDetail: true // 投递后自动关闭详情页
        }
    };

    // --- 核心工具 ---
    const Core = {
        async delay(ms) {
            const variance = ms * 0.2;
            const actualMs = ms + (Math.random() * variance * 2 - variance);
            return new Promise(resolve => setTimeout(resolve, actualMs));
        },

        log(msg) {
            console.log(`[猎聘助手] ${msg}`);
            window.UI?.log(msg);
        },

        loadSettings() {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEYS.SETTINGS);
            if (saved) Object.assign(state.settings, JSON.parse(saved));

            const processed = localStorage.getItem(CONFIG.STORAGE_KEYS.PROCESSED_JOBS);
            if (processed) {
                JSON.parse(processed).forEach(id => state.processedJobs.add(id));
            }
        },

        saveSettings() {
            localStorage.setItem(CONFIG.STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
        },

        saveProcessed() {
            localStorage.setItem(CONFIG.STORAGE_KEYS.PROCESSED_JOBS, JSON.stringify([...state.processedJobs]));
        },

        isListPage() {
            // URL 检查：必须包含列表特征，且不能是详情页特征
            const isDetail = /\/job\/|\/a\//.test(location.href);
            if (isDetail) return false;

            const urlMatch = /zhaopin|job|search|sojob/i.test(location.href);
            // DOM 检查
            const domMatch = document.querySelector('.job-list-item') ||
                document.querySelector('.sojob-item-main') ||
                document.querySelector('[data-selector="job-card"]') ||
                document.querySelector('.job-card-pc-container');

            return !!(urlMatch || domMatch);
        },

        isDetailPage() {
            // 详情页特征
            return /\/job\/|\/a\//.test(location.href);
        }
    };

    // --- 页面逻辑：职位列表 ---
    const ListPageLogic = {
        init() {
            window.UI.renderPanel();
        },

        async start() {
            if (state.isRunning) return;
            state.isRunning = true;
            window.UI.updateBtnState(true);
            Core.log(">>> 任务启动");

            try {
                await this.loop();
            } catch (err) {
                Core.log(`任务异常停止: ${err.message}`);
            } finally {
                this.stop();
            }
        },

        stop() {
            state.isRunning = false;
            window.UI.updateBtnState(false);
            Core.log(">>> 任务已停止");
        },

        getJobCards() {
            // 适配多种列表样式
            const selectors = [
                '.job-list-item',
                '.sojob-item-main',
                '[data-selector="job-card"]',
                '.job-card-pc-container' // 新版搜索页
            ];
            for (let sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) return Array.from(els);
            }
            return [];
        },

        async loop() {
            while (state.isRunning) {
                const cards = this.getJobCards();
                if (cards.length === 0) {
                    Core.log("未找到职位卡片，请确认在招聘列表页");
                    break;
                }

                let hasProcessedInThisPage = false;

                for (let card of cards) {
                    if (!state.isRunning) break;

                    // 高亮当前卡片
                    if (state.currentCard) state.currentCard.style.outline = "none";
                    state.currentCard = card;
                    card.style.outline = CONFIG.COLORS.border;
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    const jobInfo = this.extractJobInfo(card);

                    // --- 过滤器检查 ---
                    if (state.processedJobs.has(jobInfo.id)) {
                        // Core.log(`跳过已投递: ${jobInfo.title}`);
                        continue;
                    }

                    if (!this.checkKeywords(jobInfo.title, jobInfo.company, jobInfo.location)) {
                        continue;
                    }

                    if (state.settings.excludeHeadhunters && jobInfo.isHeadhunter) {
                        Core.log(`跳过猎头职位: ${jobInfo.title}`);
                        continue;
                    }

                    // --- 无论过滤结果如何，都加上一点随机延迟模拟人工浏览 ---
                    await Core.delay(500);

                    // --- 执行投递流程 ---
                    Core.log(`准备投递: ${jobInfo.title} | ${jobInfo.company}`);

                    // 标记为处理中，防止重复
                    state.processedJobs.add(jobInfo.id);
                    Core.saveProcessed();

                    // 打开详情页
                    const success = await this.processDetailPage(jobInfo.link);

                    if (success) {
                        state.stats.success++;
                        Core.log("投递成功");
                    } else {
                        state.stats.fail++;
                        Core.log("投递失败或超时");
                    }

                    hasProcessedInThisPage = true;
                    await Core.delay(CONFIG.BASIC_INTERVAL);
                }

                // 翻页逻辑
                if (state.isRunning) {
                    Core.log("本页处理完毕，尝试翻页...");
                    const nextBtn = this.findNextPageBtn();
                    if (nextBtn) {
                        nextBtn.click();
                        await Core.delay(5000); // 等待页面加载
                    } else {
                        Core.log("未找到下一页，任务结束");
                        break;
                    }
                }
            }
        },

        extractJobInfo(card) {
            // 提取逻辑适配 - 增强版 V2

            // 1. 尝试寻找链接 (核心锚点)
            const linkEl = card.querySelector('a[href*="/job/"], a[href*="/a/"], a[data-selector="job-card-link"]');

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

            // 补救措施：如果没找到标题元素，但找到了链接，通常链接文字就是标题，或者链接包含标题
            if (!title && linkEl) {
                // 排除包含 "立即沟通" 这种按钮链接
                if (!linkEl.innerText.includes("沟通") && !linkEl.innerText.includes("查看")) {
                    title = linkEl.innerText.trim();
                } else {
                    // 尝试找链接的 title 属性
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
                '.company-name-box', // 新增
                'h4' // 新增
            ];

            let companyEl = null;
            for (let sel of companySelectors) {
                companyEl = card.querySelector(sel);
                if (companyEl) break;
            }

            let company = companyEl ? companyEl.innerText.trim() : "";

            // 4. 地点提取
            // 尝试列表
            const locSelectors = [
                '.job-dq-box',
                '.area',
                '.job-area',
                '.job-address',
                '[data-selector="job-dq"]',
                '.area-text',
                '.job-labels-box .labels-tag', // 有些布局地点是第一个标签
                '.ellipsis-1' // 某些紧凑布局
            ];

            let locEl = null;
            // 优先找特定的地点容器
            for (let sel of locSelectors) {
                // 排除 title (因为 .ellipsis-1 也可能是标题)
                const els = card.querySelectorAll(sel);
                for (let el of els) {
                    if (el !== titleEl && el !== companyEl) {
                        // 简单的启发式：地点通常比较短，且不包含"公司"等字眼
                        if (el.innerText.length < 20) {
                            locEl = el;
                            break;
                        }
                    }
                }
                if (locEl) break;
            }

            let location = locEl ? locEl.innerText.trim() : "";

            // 猎头标记检测
            const isHeadhunter = !!card.querySelector('img[alt="猎头"], .hunt-tag');

            // 调试日志
            if (!title) {
                console.log("[猎聘助手-调试] 标题提取失败。卡片纯文本:", card.innerText.replace(/\n/g, ' '));
            }
            if (!location) {
                // 尝试从 job-sub-title 获取，通常包含地点信息
                const subTitleEl = card.querySelector('.job-sub-title');
                if (subTitleEl) {
                    const subTitleText = subTitleEl.innerText.trim();
                    // 简单匹配城市名，例如 "北京-海淀"
                    const cityMatch = subTitleText.match(/[\u4e00-\u9fa5]{2,4}[市区县]/); // 匹配城市或区县
                    if (cityMatch) {
                        location = cityMatch[0];
                    } else {
                        // 如果没有明确城市，尝试整个副标题
                        location = subTitleText;
                    }
                }
            }

            // ID生成
            const link = linkEl ? linkEl.href : "";
            const id = link || (title + company);

            return {
                title: title,
                company: company,
                location: location,
                link: link,
                id: id,
                isHeadhunter: isHeadhunter
            };
        },

        checkKeywords(title, company, location) {
            const { keywords, locationKeywords } = state.settings;

            // 关键词筛选逻辑
            if (keywords && keywords.trim()) {
                const keys = keywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
                const match = keys.some(k => title.includes(k) || company.includes(k));
                if (!match) {
                    Core.log(`跳过: 关键词不匹配 (${title})`);
                    return false;
                }
            }

            if (locationKeywords && locationKeywords.trim()) {
                const keys = locationKeywords.split(/[,，]/).map(k => k.trim()).filter(k => k);
                // 如果提取不到地点，为避免误杀，暂时放行（或者严格模式下跳过）
                const match = keys.some(k => location.includes(k));
                if (!match) {
                    Core.log(`跳过: 地点不匹配 (${location})`);
                    return false;
                }
            }

            return true;
        },

        findNextPageBtn() {
            // 适配 Ant Design, Element UI, RC-Pagination 等
            const selectors = [
                '.ant-pagination-next:not([aria-disabled="true"])',
                '.pager .next:not(.disabled)',
                '.rc-pagination-next:not([aria-disabled="true"])',
                'li[title="Next Page"]:not([aria-disabled="true"])',
                '.el-pagination .btn-next:not(:disabled)',
                '.next-page-btn' // 通用猜测
            ];

            for (let s of selectors) {
                const btn = document.querySelector(s);
                // 确保可见且未禁用
                if (btn && btn.offsetParent !== null && !btn.classList.contains('disabled')) {
                    return btn;
                }
            }

            // 针对 Ant Design 的特殊禁用检测 (有时 class 在 button 上，有时在 li 上)
            const antNextLi = document.querySelector('.ant-pagination-next');
            if (antNextLi && !antNextLi.classList.contains('ant-pagination-disabled')) {
                return antNextLi;
            }

            return null;
        },

        async processDetailPage(url) {
            if (!url) return false;

            return new Promise((resolve) => {
                // 设置通信暗号：当前需要处理的 URL
                // 使用 GM_setValue 以支持跨子域通信
                const task = {
                    url: url,
                    status: 'pending',
                    timestamp: Date.now()
                };
                GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));

                // 打开窗口
                const win = window.open(url, '_blank');

                // 轮询检查结果
                let checks = 0;
                const maxChecks = 30; // 约30秒超时

                const timer = setInterval(() => {
                    checks++;
                    // 使用 GM_getValue 读取状态
                    const taskStr = GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_TASK);
                    if (!taskStr) {
                        clearInterval(timer);
                        resolve(false);
                        return;
                    }

                    const currentTask = JSON.parse(taskStr);

                    // 确认是当前任务
                    if (currentTask.url === url) {
                        if (currentTask.status === 'success') {
                            clearInterval(timer);
                            if (win && !win.closed) win.close();
                            resolve(true);
                        } else if (currentTask.status === 'fail') {
                            clearInterval(timer);
                            if (win && !win.closed) win.close();
                            resolve(false);
                        }
                    }

                    if (checks >= maxChecks) {
                        clearInterval(timer);
                        if (win && !win.closed) win.close();
                        Core.log("详情页处理超时");
                        resolve(false);
                    }

                    if (win && win.closed && currentTask.status === 'pending') {
                        clearInterval(timer);
                        resolve(false); // 用户手动关了
                    }
                }, 1000);
            });
        }
    };

    // --- 页面逻辑：职位详情页 ---
    const DetailPageLogic = {
        init() {
            // 1. 无论如何，先渲染详情页控制面板，确保用户知道脚本在运行
            this.createDetailPanel();
            this.log("已加载详情页模块");

            // 2. 检查任务
            this.checkAndExecute();
        },

        createDetailPanel() {
            const panel = document.createElement('div');
            panel.id = 'lp-detail-panel';
            panel.style.cssText = `
                position: fixed; top: 120px; right: 20px; width: 260px;
                background: white; border: 2px solid ${CONFIG.COLORS.primary}; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 8px; 
                z-index: 999999; font-size: 13px; color: #333;
                font-family: sans-serif;
            `;

            panel.innerHTML = `
                <div style="padding:10px; background:${CONFIG.COLORS.primary}; color:white; font-weight:bold; border-radius:6px 6px 0 0;">
                    海投助手 - 投递详情
                </div>
                <div id="lp-detail-log" style="height:120px; overflow-y:auto; padding:10px; border-bottom:1px solid #eee; background:#f9f9f9;">
                    <div>等待指令...</div>
                </div>
                <div style="padding:10px; text-align:center;">
                    <button id="lp-btn-force-apply" style="width:100%; padding:8px; background:#fff; border:1px solid ${CONFIG.COLORS.primary}; color:${CONFIG.COLORS.primary}; border-radius:4px; cursor:pointer;">
                        强制手动投递
                    </button>
                    <div style="margin-top:5px; font-size:10px; color:#999;">如果自动投递未触发，请点击上方按钮</div>
                </div>
            `;

            document.body.appendChild(panel);

            document.getElementById('lp-btn-force-apply').onclick = () => {
                this.log("多此一举？正在强制投递...");
                this.doApply().then(res => {
                    this.log(res ? "投递动作已完成" : "找不到投递按钮");
                });
            };

            this.logEl = document.getElementById('lp-detail-log');
        },

        log(msg) {
            console.log(`[详情页] ${msg}`);
            if (this.logEl) {
                const div = document.createElement('div');
                div.textContent = `> ${msg}`;
                div.style.marginBottom = "4px";
                this.logEl.appendChild(div);
                this.logEl.scrollTop = this.logEl.scrollHeight;
            }
        },

        async checkAndExecute() {
            // 使用 GM_getValue 读取任务
            const taskStr = GM_getValue(CONFIG.STORAGE_KEYS.CURRENT_TASK);
            if (!taskStr) {
                this.log("无自动任务，待机中...");
                return;
            }

            let task;
            try {
                task = JSON.parse(taskStr);
            } catch (e) {
                this.log("任务数据解析失败");
                return;
            }

            // URL 匹配 (只要 ID 对得上就行，或者 URL 包含)
            // 猎聘 ID 通常在 URL 里，如 /job/123456.shtml
            const currentUrl = location.href;

            // 提取纯净 URL 用于对比
            const normalize = (u) => u.split('?')[0].replace(/^(https?:)?\/\//, '');
            const taskUrlSimple = normalize(task.url);
            const currentUrlSimple = normalize(currentUrl);

            // 检查包含关系
            if (!currentUrlSimple.includes(taskUrlSimple) && !taskUrlSimple.includes(currentUrlSimple)) {
                this.log("非当前任务目标页面，跳过");
                return;
            }

            if (task.status !== 'pending') {
                this.log(`任务状态为 ${task.status}，跳过`);
                return;
            }

            if (Date.now() - task.timestamp > 90000) { // 放宽到90秒
                this.log("任务已超时失效");
                return;
            }

            this.log("接收到自动投递任务！");
            this.log(`将在 ${CONFIG.DETAIL_STAY_TIME / 1000} 秒后投递...`);

            await Core.delay(CONFIG.DETAIL_STAY_TIME);

            const result = await this.doApply();

            // 更新任务状态 (使用 GM_setValue)
            task.status = result ? 'success' : 'fail';
            GM_setValue(CONFIG.STORAGE_KEYS.CURRENT_TASK, JSON.stringify(task));

            if (result) {
                this.log("投递成功！");
                if (state.settings.autoCloseDetail) {
                    this.log("即将关闭页面...");
                    await Core.delay(1500);
                    window.close();
                }
            } else {
                this.log("未找到投递按钮/投递失败");
            }
        },

        async doApply() {
            // 查找按钮增强版
            const btnSelectors = [
                '.btn-apply',
                '.btn-chat',
                '[data-selector="chat-btn"]',
                '.job-apply-container .btn', // 容器下的按钮
                'a.btn-apply',
                'button' // 最后的暴力匹配
            ];

            let targetBtn = null;

            // 优先精确匹配
            for (let sel of btnSelectors) {
                const btns = document.querySelectorAll(sel);
                for (let btn of btns) {
                    const text = btn.innerText.trim();
                    if (text.includes("立即沟通") || text.includes("聊一聊") || text.includes("继续沟通") || text.includes("应聘")) {
                        if (!text.includes("已") && !btn.classList.contains('disabled')) {
                            targetBtn = btn;
                            break;
                        }
                    }
                }
                if (targetBtn) break;
            }

            if (!targetBtn) {
                this.log("页面未发现有效的沟通按钮");
                return false;
            }

            this.log(`点击: ${targetBtn.innerText}`);
            targetBtn.click();

            // 确认弹窗检测
            await Core.delay(1000);
            const confirmBtn = document.querySelector('.ant-modal .ant-btn-primary') || document.querySelector('.next-btn');
            if (confirmBtn) {
                this.log("点击确认弹窗");
                confirmBtn.click();
            }

            return true;
        }
    };

    // --- UI 渲染 ---
    window.UI = {
        renderPanel() {
            const panel = document.createElement('div');
            panel.style.cssText = `
                position: fixed; top: 80px; right: 20px; width: 320px;
                background: white; border: 1px solid #ddd; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                border-radius: 8px; z-index: 99999; font-size: 14px; color: #333;
                font-family: sans-serif;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                padding: 12px; background: ${CONFIG.COLORS.primary}; color: white;
                font-weight: bold; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between;
            `;
            header.innerHTML = `<span>猎聘海投助手 Max</span><span style="font-size:12px; cursor:pointer;" id="lp-min-btn">_</span>`;

            const content = document.createElement('div');
            content.style.padding = '15px';
            content.id = 'lp-panel-content';

            // 配置区域
            const createInput = (label, key, placeholder) => `
                <div style="margin-bottom: 10px;">
                    <label style="display:block;margin-bottom:4px;font-weight:500;">${label}</label>
                    <input type="text" id="lp-input-${key}" value="${state.settings[key]}" placeholder="${placeholder}"
                    style="width:100%; padding: 6px; border:1px solid #ddd; border-radius:4px;">
                </div>
            `;

            content.innerHTML = `
                ${createInput("职位关键词 (逗号分隔)", "keywords", "如: 前端, Java")}
                ${createInput("地点关键词 (逗号分隔)", "locationKeywords", "如: 海淀, 朝阳")}
                
                <div style="margin-bottom: 15px;">
                    <label style="cursor:pointer; display:flex; align-items:center;">
                        <input type="checkbox" id="lp-check-hunter" ${state.settings.excludeHeadhunters ? 'checked' : ''}>
                        <span style="margin-left:6px;">排除猎头职位</span>
                    </label>
                </div>

                <div style="display:flex; gap:10px; margin-bottom:15px;">
                    <button id="lp-btn-start" style="flex:1; padding:8px; background:${CONFIG.COLORS.primary}; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold;">开始投递</button>
                    <button id="lp-btn-stop" style="flex:1; padding:8px; background:#f5f5f5; color:#333; border:1px solid #ddd; border-radius:4px; cursor:pointer;">停止</button>
                    <button id="lp-btn-save" style="flex:1; padding:8px; background:#e6f7ff; color:#1890ff; border:1px solid #1890ff; border-radius:4px; cursor:pointer;">保存配置</button>
                </div>

                <div id="lp-log-area" style="height:150px; background:#f9f9f9; border:1px solid #eee; padding:8px; overflow-y:auto; font-size:12px; line-height:1.4; color:#666;">
                    <div>欢迎使用！配置完成后点击保存，然后点击开始投递。</div>
                </div>
            `;

            panel.appendChild(header);
            panel.appendChild(content);
            document.body.appendChild(panel);

            // 最小化逻辑
            const minBtn = header.querySelector('#lp-min-btn');
            minBtn.onclick = () => {
                const c = document.getElementById('lp-panel-content');
                c.style.display = c.style.display === 'none' ? 'block' : 'none';
            };

            // 绑定事件
            document.getElementById('lp-btn-save').onclick = () => {
                state.settings.keywords = document.getElementById('lp-input-keywords').value;
                state.settings.locationKeywords = document.getElementById('lp-input-locationKeywords').value;
                state.settings.excludeHeadhunters = document.getElementById('lp-check-hunter').checked;
                Core.saveSettings();
                Core.log("配置已保存");
            };

            document.getElementById('lp-btn-start').onclick = () => ListPageLogic.start();
            document.getElementById('lp-btn-stop').onclick = () => ListPageLogic.stop();

            this.logEl = document.getElementById('lp-log-area');
        },

        log(msg) {
            if (this.logEl) {
                const d = document.createElement('div');
                d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
                this.logEl.appendChild(d);
                this.logEl.scrollTop = this.logEl.scrollHeight;
            }
        },

        updateBtnState(isRunning) {
            const btn = document.getElementById('lp-btn-start');
            if (btn) {
                btn.textContent = isRunning ? '运行中...' : '开始投递';
                btn.disabled = isRunning;
                btn.style.opacity = isRunning ? 0.6 : 1;
            }
        }
    };

    // --- 入口与引导 ---
    (function main() {
        console.log("[猎聘助手] 脚本已加载");

        // 加载配置
        Core.loadSettings();

        // 注册菜单命令 (作为兜底)
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand("强制显示控制面板", () => {
                ListPageLogic.init();
                console.log("[猎聘助手] 用户手动触发面板显示");
            });
        }

        let initialized = false;

        const checkAndInit = () => {
            if (initialized) return;

            if (Core.isListPage()) {
                console.log("[猎聘助手] 检测到职位列表页，初始化UI...");
                setTimeout(() => ListPageLogic.init(), 1000);
                initialized = true;
            } else if (Core.isDetailPage()) {
                console.log("[猎聘助手] 检测到职位详情页，执行投递逻辑...");
                DetailPageLogic.init();
                initialized = true;
            }
        };

        // 1. 立即检查
        checkAndInit();

        // 2. 也是SPA? 监听URL和DOM变化
        // 某些页面是动态加载的，刚开始可能没有卡片
        const observer = new MutationObserver(() => {
            if (!initialized) checkAndInit();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // 3. 兜底定时器 (针对某些极端慢加载)
        setTimeout(checkAndInit, 3000);
        setTimeout(checkAndInit, 6000);

    })();

})();
