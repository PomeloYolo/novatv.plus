const CUSTOMER_SITES = {
    qiqi: {
        api: 'https://cj.lziapi.com/api.php/provide/vod',
        name: '非凡資源',
    }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("錯誤：請先加載 config.js！");
}
