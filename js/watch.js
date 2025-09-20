// 获取当前URL的参数，并将它们传递给player.html
window.onload = function() {
    // 获取当前URL的查询参数
    const currentParams = new URLSearchParams(window.location.search);
    
    // 创建player.html的URL对象
    const playerUrlObj = new URL("player.html", window.location.origin);
    
    // 更新状态文本
    const statusElement = document.getElementById('redirect-status');
    const manualRedirect = document.getElementById('manual-redirect');
    let statusMessages = [
        "準備影片數據中...",
        "正在載入影片訊息...",
        "即將開始播放...",
    ];
    let currentStatus = 0;
    
    // 状态文本动画
    let statusInterval = setInterval(() => {
        if (currentStatus >= statusMessages.length) {
            currentStatus = 0;
        }
        if (statusElement) {
            statusElement.textContent = statusMessages[currentStatus];
            statusElement.style.opacity = 0.7;
            setTimeout(() => {
                if (statusElement) statusElement.style.opacity = 1;
            }, 300);
        }
        currentStatus++;
    }, 1000);
    
    // 确保保留所有原始参数
    currentParams.forEach((value, key) => {
        playerUrlObj.searchParams.set(key, value);
    });
    
    // 获取来源URL (如果存在)
    const referrer = document.referrer;
    
    // 获取当前URL中的返回URL参数（如果有）
    const backUrl = currentParams.get('back');
    
    // 确定返回URL的优先级：1. 指定的back参数 2. referrer 3. 搜索页面
    let returnUrl = '';
    if (backUrl) {
        // 有显式指定的返回URL
        returnUrl = decodeURIComponent(backUrl);
    } else if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        // 来源是搜索页面
        returnUrl = referrer;
    } else if (referrer && referrer.trim() !== '') {
        // 如果有referrer但不是搜索页，也使用它
        returnUrl = referrer;
    } else {
        // 默认回到首页
        returnUrl = '/';
    }
    
    // 将返回URL添加到player.html的参数中
    if (!playerUrlObj.searchParams.has('returnUrl')) {
        playerUrlObj.searchParams.set('returnUrl', encodeURIComponent(returnUrl));
    }
    
    // 同时保存在localStorage中，作为备用
    localStorage.setItem('lastPageUrl', returnUrl);
    
    // 标记来自搜索页面
    if (returnUrl.includes('/s=') || returnUrl.includes('?s=')) {
        localStorage.setItem('cameFromSearch', 'true');
        localStorage.setItem('searchPageUrl', returnUrl);
    }
    
    // 获取最终的URL字符串
    const finalPlayerUrl = playerUrlObj.toString();
    
    // 更新手动重定向链接
    if (manualRedirect) {
        manualRedirect.href = finalPlayerUrl;
    }

    // 更新meta refresh标签
    const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
    if (metaRefresh) {
        metaRefresh.content = `3; url=${finalPlayerUrl}`;
    }
    
    // 在跳轉前添加觀看紀錄
    addToViewingHistoryFromParams(currentParams);
    
    // 重定向到播放器页面
    setTimeout(() => {
        clearInterval(statusInterval);
        window.location.href = finalPlayerUrl;
    }, 2800); // 稍微早于meta refresh的时间，确保我们的JS控制重定向
};

// 從URL參數添加觀看紀錄
function addToViewingHistoryFromParams(params) {
    try {
        // 獲取必要的參數
        const url = params.get('url') || '';
        const title = params.get('title') || '未知影片';
        const episodeIndex = parseInt(params.get('index') || '0', 10);
        const sourceName = params.get('source') || '';
        const sourceCode = params.get('source_code') || '';
        const vodId = params.get('id') || '';
        
        if (!url) return; // 如果沒有URL，則不添加記錄
        
        // 創建視頻信息對象
        const videoInfo = {
            url: url,
            title: title,
            episodeIndex: episodeIndex,
            sourceName: sourceName,
            sourceCode: sourceCode,
            vod_id: vodId,
            showIdentifier: sourceName && vodId ? `${sourceName}_${vodId}` : url,
            timestamp: Date.now(),
            playbackPosition: 0,
            duration: 0,
            episodes: []
        };
        
        // 獲取現有歷史記錄
        let history = [];
        try {
            const data = localStorage.getItem('viewingHistory');
            history = data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('獲取觀看歷史失敗:', e);
            history = [];
        }
        
        // 檢查是否已存在相同記錄
        const existingIndex = history.findIndex(item => 
            item.title === videoInfo.title && 
            item.sourceName === videoInfo.sourceName && 
            item.showIdentifier === videoInfo.showIdentifier
        );
        
        if (existingIndex !== -1) {
            // 更新現有記錄
            const existingItem = history[existingIndex];
            existingItem.episodeIndex = videoInfo.episodeIndex;
            existingItem.timestamp = videoInfo.timestamp;
            existingItem.url = videoInfo.url;
            
            // 移動到歷史記錄頂部
            history.splice(existingIndex, 1);
            history.unshift(existingItem);
        } else {
            // 添加新記錄
            history.unshift(videoInfo);
        }
        
        // 限制歷史記錄數量為50條
        const maxHistoryItems = 50;
        if (history.length > maxHistoryItems) {
            history.splice(maxHistoryItems);
        }
        
        // 保存到本地存儲
        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
        console.error('保存觀看歷史失敗:', e);
    }
}
