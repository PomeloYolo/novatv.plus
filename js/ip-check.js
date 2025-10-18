// IP Whitelist Check Script
let ipWhitelist = [];
let clientIP = null;

// Fetch the IP whitelist
async function fetchIPWhitelist() {
    try {
        const response = await fetch('js/ip-whitelist.json');
        const data = await response.json();
        ipWhitelist = data.allowedIPs || [];
        console.log('IP白名單載入成功');
        return ipWhitelist;
    } catch (error) {
        console.error('Error loading IP whitelist:', error);
        return [];
    }
}

// 使用多個服務來獲取客戶端IP，提高可靠性
async function getClientIP() {
    try {
        // 嘗試第一個API
        const response1 = await fetch('https://api.ipify.org?format=json');
        const data1 = await response1.json();
        if (data1 && data1.ip) {
            console.log('IP地址(來源1)檢測成功');
            return data1.ip;
        }
    } catch (error) {
        console.log('第一個IP檢測API失敗，嘗試備用API');
    }

    try {
        // 嘗試第二個API
        const response2 = await fetch('https://api.db-ip.com/v2/free/self');
        const data2 = await response2.json();
        if (data2 && data2.ipAddress) {
            console.log('IP地址(來源2)檢測成功');
            return data2.ipAddress;
        }
    } catch (error) {
        console.log('第二個IP檢測API失敗');
    }

    // 如果所有API都失敗，返回null
    console.error('無法獲取IP地址');
    return null;
}

// 檢查管理員認證
function checkAdminAuthentication() {
    return sessionStorage.getItem('adminAuthenticated') === 'true';
}

// 檢查IP是否在白名單中
async function checkIPAccess() {
    // 如果已經通過管理員認證，直接允許訪問
    if (checkAdminAuthentication()) {
        console.log('管理員認證通過，允許訪問');
        return true;
    }
    
    try {
        const whitelist = await fetchIPWhitelist();
        clientIP = await getClientIP();
        
        if (!clientIP) {
            console.error('無法確定客戶端IP');
            // 當IP檢測失敗時，重定向到錯誤頁面並設置狀態為需要密碼
            sessionStorage.setItem('ipCheckStatus', 'failed');
            window.location.href = 'ip-error.html';
            return false;
        }
        
        const isAllowed = whitelist.includes(clientIP);
        console.log('IP檢查結果:', {
            isAllowed: isAllowed
        });
        
        if (!isAllowed) {
            // 將IP信息存儲在sessionStorage中，以便錯誤頁面使用
            sessionStorage.setItem('blockedIP', clientIP);
            sessionStorage.setItem('ipCheckStatus', 'blocked');
            
            // 重定向到錯誤頁面
            window.location.href = 'ip-error.html';
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('IP檢查過程中發生錯誤:', error);
        // 發生錯誤時也重定向到錯誤頁面
        sessionStorage.setItem('ipCheckStatus', 'error');
        window.location.href = 'ip-error.html';
        return false;
    }
}

// 頁面加載時運行IP檢查
document.addEventListener('DOMContentLoaded', checkIPAccess);
