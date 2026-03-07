// functions/proxy/[[path]].js

// --- 配置 (现在从 Cloudflare 环境变量读取) ---
// 在 Cloudflare Pages 设置 -> 函数 -> 环境变量绑定 中设置以下变量:
// CACHE_TTL (例如 86400)
// MAX_RECURSION (例如 5)
// FILTER_DISCONTINUITY (不再需要，设为 false 或移除)
// USER_AGENTS_JSON (例如 ["UA1", "UA2"]) - JSON 字符串数组
// DEBUG (例如 false 或 true)
// PASSWORD (例如 "your_password") - 鉴权密码
// --- 配置结束 ---

// --- 常量 (之前在 config.js 中，现在移到这里，因为它们与代理逻辑相关) ---
const MEDIA_FILE_EXTENSIONS = [
    '.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.f4v', '.m4v', '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
    '.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.wma', '.alac', '.aiff', '.opus',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic'
];
const MEDIA_CONTENT_TYPES = ['video/', 'audio/', 'image/'];
// --- 常量结束 ---


/**
 * 主要的 Pages Function 处理函数
 * 拦截发往 /proxy/* 的请求
 */
export async function onRequest(context) {
    const { request, env, next, waitUntil } = context; // next 和 waitUntil 可能需要
    const url = new URL(request.url);

    // 验证鉴权（主函数调用）
    const isValidAuth = await validateAuth(request, env);
    if (!isValidAuth) {
        return new Response(JSON.stringify({
            success: false,
            error: '代理訪問未授權：請檢查授權碼配置'
        }), { 
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Content-Type': 'application/json'
            }
        });
    }

    // --- 从环境变量读取配置 ---
    const DEBUG_ENABLED = (env.DEBUG === 'true');
    const CACHE_TTL = parseInt(env.CACHE_TTL || '86400'); // 默认 24 小时
    const MAX_RECURSION = parseInt(env.MAX_RECURSION || '5'); // 默认 5 层
    // 广告过滤已移至播放器处理，代理不再执行
    let USER_AGENTS = [ // 提供一个基础的默认值
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    try {
        // 尝试从环境变量解析 USER_AGENTS_JSON
        const agentsJson = env.USER_AGENTS_JSON;
        if (agentsJson) {
            const parsedAgents = JSON.parse(agentsJson);
            if (Array.isArray(parsedAgents) && parsedAgents.length > 0) {
                USER_AGENTS = parsedAgents;
            } else {
                 logDebug("環境變數 USER_AGENTS_JSON 格式無效或為空，使用預設值");
            }
        }
    } catch (e) {
        logDebug(`解析環境變數 USER_AGENTS_JSON 失敗: ${e.message}，使用預設值`);
    }
    // --- 配置读取结束 ---


    // --- 辅助函数 ---

    // 验证代理请求的鉴权
    async function validateAuth(request, env) {
        const url = new URL(request.url);
        const authHash = url.searchParams.get('auth');
        const timestamp = url.searchParams.get('t');
        
        // 获取服务器端密码
        const serverPassword = env.PASSWORD;
        if (!serverPassword) {
            console.error('伺服器未設置 PASSWORD 環境變數，代理訪問被拒絕');
            return false;
        }
        
        // 使用 SHA-256 哈希算法（与其他平台保持一致）
        // 在 Cloudflare Workers 中使用 crypto.subtle
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(serverPassword);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const serverPasswordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            if (!authHash || authHash !== serverPasswordHash) {
                console.warn('代理請求失敗：密碼不匹配');
                return false;
            }
        } catch (error) {
            console.error('計算密碼失敗:', error);
            return false;
        }
        
        // 验证时间戳（10分钟有效期）
        if (timestamp) {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10分钟
            if (now - parseInt(timestamp) > maxAge) {
                console.warn('代理請求失敗：時間過期');
                return false;
            }
        }
        
        return true;
    }

    // 验证鉴权（主函数调用）
    if (!validateAuth(request, env)) {
        return new Response('Unauthorized', { 
            status: 401,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*'
            }
        });
    }

    // 输出调试日志 (需要设置 DEBUG: true 环境变量)
    function logDebug(message) {
        if (DEBUG_ENABLED) {
            console.log(`[Proxy Func] ${message}`);
        }
    }

    // 从请求路径中提取目标 URL
    function getTargetUrlFromPath(pathname) {
        // 路径格式: /proxy/经过编码的URL
        // 例如: /proxy/https%3A%2F%2Fexample.com%2Fplaylist.m3u8
        const encodedUrl = pathname.replace(/^\/proxy\//, '');
        if (!encodedUrl) return null;
        try {
            // 解码
            let decodedUrl = decodeURIComponent(encodedUrl);

             // 简单检查解码后是否是有效的 http/https URL
             if (!decodedUrl.match(/^https?:\/\//i)) {
                 // 也许原始路径就没有编码？如果看起来像URL就直接用
                 if (encodedUrl.match(/^https?:\/\//i)) {
                     decodedUrl = encodedUrl;
                     logDebug(`Warning: Path was not encoded but looks like URL: ${decodedUrl}`);
                 } else {
                    logDebug(`無效的目標URL格式 (解碼後): ${decodedUrl}`);
                    return null;
                 }
             }
             return decodedUrl;

        } catch (e) {
            logDebug(`解碼目標URL時出錯: ${encodedUrl} - ${e.message}`);
            return null;
        }
    }

    // 创建标准化的响应
    function createResponse(body, status = 200, headers = {}) {
        const responseHeaders = new Headers(headers);
        // 关键：添加 CORS 跨域头，允许前端 JS 访问代理后的响应
        responseHeaders.set("Access-Control-Allow-Origin", "*"); // 允许任何来源访问
        responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS"); // 允许的方法
        responseHeaders.set("Access-Control-Allow-Headers", "*"); // 允许所有请求头

        // 处理 CORS 预检请求 (OPTIONS) - 放在这里确保所有响应都处理
         if (request.method === "OPTIONS") {
             // 使用下面的 onOptions 函数可以更规范，但在这里处理也可以
             return new Response(null, {
                 status: 204, // No Content
                 headers: responseHeaders // 包含上面设置的 CORS 头
             });
         }

        return new Response(body, { status, headers: responseHeaders });
    }

    // 创建 M3U8 类型的响应
    function createM3u8Response(content) {
        return createResponse(content, 200, {
            "Content-Type": "application/vnd.apple.mpegurl", // M3U8 的标准 MIME 类型
            "Cache-Control": `public, max-age=${CACHE_TTL}` // 允许浏览器和CDN缓存
        });
    }

    // 获取随机 User-Agent
    function getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    // 获取 URL 的基础路径 (用于解析相对路径)
    function getBaseUrl(urlStr) {
        try {
            const parsedUrl = new URL(urlStr);
            // 如果路径是根目录，或者没有斜杠，直接返回 origin + /
            if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
                return `${parsedUrl.origin}/`;
            }
            const pathParts = parsedUrl.pathname.split('/');
            pathParts.pop(); // 移除文件名或最后一个路径段
            return `${parsedUrl.origin}${pathParts.join('/')}/`;
        } catch (e) {
            logDebug(`获取 BaseUrl 时出错: ${urlStr} - ${e.message}`);
            // 备用方法：找到最后一个斜杠
            const lastSlashIndex = urlStr.lastIndexOf('/');
            // 确保不是协议部分的斜杠 (http://)
            return lastSlashIndex > urlStr.indexOf('://') + 2 ? urlStr.substring(0, lastSlashIndex + 1) : urlStr + '/';
        }
    }


    // 将相对 URL 转换为绝对 URL
    function resolveUrl(baseUrl, relativeUrl) {
        // 如果已经是绝对 URL，直接返回
        if (relativeUrl.match(/^https?:\/\//i)) {
            return relativeUrl;
        }
        try {
            // 使用 URL 对象来处理相对路径
            return new URL(relativeUrl, baseUrl).toString();
        } catch (e) {
            logDebug(`解析 URL 失败: baseUrl=${baseUrl}, relativeUrl=${relativeUrl}, error=${e.message}`);
            // 简单的备用方法
            if (relativeUrl.startsWith('/')) {
                // 处理根路径相对 URL
                const urlObj = new URL(baseUrl);
                return `${urlObj.origin}${relativeUrl}`;
            }
            // 处理同级目录相对 URL
            return `${baseUrl.replace(/\/[^/]*$/, '/')}${relativeUrl}`; // 确保baseUrl以 / 结尾
        }
    }

    // 将目标 URL 重写为内部代理路径 (/proxy/...)
    function rewriteUrlToProxy(targetUrl) {
        // 确保目标URL被正确编码，以便作为路径的一部分
        return `/proxy/${encodeURIComponent(targetUrl)}`;
    }

    // 获取远程内容及其类型
    async function fetchContentWithType(targetUrl) {
        const headers = new Headers({
            'User-Agent': getRandomUserAgent(),
            'Accept': '*/*',
            // 尝试传递一些原始请求的头信息
            'Accept-Language': request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8',
            // 尝试设置 Referer 为目标网站的域名，或者传递原始 Referer
            'Referer': request.headers.get('Referer') || new URL(targetUrl).origin
        });

        try {
            // 直接请求目标 URL
            logDebug(`開始直接請求: ${targetUrl}`);
            // Cloudflare Functions 的 fetch 默认支持重定向
            const response = await fetch(targetUrl, { headers, redirect: 'follow' });

            if (!response.ok) {
                 const errorBody = await response.text().catch(() => '');
                 logDebug(`請求失敗: ${response.status} ${response.statusText} - ${targetUrl}`);
                 throw new Error(`HTTP error ${response.status}: ${response.statusText}. URL: ${targetUrl}. Body: ${errorBody.substring(0, 150)}`);
            }

            // 读取响应内容为文本
            const content = await response.text();
            const contentType = response.headers.get('Content-Type') || '';
            logDebug(`請求成功: ${targetUrl}, Content-Type: ${contentType}, 內容長度: ${content.length}`);
            return { content, contentType, responseHeaders: response.headers }; // 同时返回原始响应头

        } catch (error) {
             logDebug(`請求徹底失敗: ${targetUrl}: ${error.message}`);
            // 抛出更详细的错误
            throw new Error(`請求目標URL失敗 ${targetUrl}: ${error.message}`);
        }
    }

    // 判断是否是 M3U8 内容
    function isM3u8Content(content, contentType) {
        // 检查 Content-Type
        if (contentType && (contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('application/x-mpegurl') || contentType.includes('audio/mpegurl'))) {
            return true;
        }
        // 检查内容本身是否以 #EXTM3U 开头
        return content && typeof content === 'string' && content.trim().startsWith('#EXTM3U');
    }

    // 判断是否是媒体文件 (根据扩展名和 Content-Type) - 这部分在此代理中似乎未使用，但保留
    function isMediaFile(url, contentType) {
        if (contentType) {
            for (const mediaType of MEDIA_CONTENT_TYPES) {
                if (contentType.toLowerCase().startsWith(mediaType)) {
                    return true;
                }
            }
        }
        const urlLower = url.toLowerCase();
        for (const ext of MEDIA_FILE_EXTENSIONS) {
            if (urlLower.endsWith(ext) || urlLower.includes(`${ext}?`)) {
                return true;
            }
        }
        return false;
    }

    // 处理 M3U8 中的 #EXT-X-KEY 行 (加密密钥)
    function processKeyLine(line, baseUrl) {
        return line.replace(/URI="([^"]+)"/, (match, uri) => {
            const absoluteUri = resolveUrl(baseUrl, uri);
            logDebug(`處理 KEY URI: 原始='${uri}', 絕對='${absoluteUri}'`);
            return `URI="${rewriteUrlToProxy(absoluteUri)}"`; // 重写为代理路径
        });
    }

    // 处理 M3U8 中的 #EXT-X-MAP 行 (初始化片段)
    function processMapLine(line, baseUrl) {
         return line.replace(/URI="([^"]+)"/, (match, uri) => {
             const absoluteUri = resolveUrl(baseUrl, uri);
             logDebug(`處理 MAP URI: 原始='${uri}', 絕對='${absoluteUri}'`);
             return `URI="${rewriteUrlToProxy(absoluteUri)}"`; // 重写为代理路径
         });
     }

    // 处理媒体 M3U8 播放列表 (包含视频/音频片段)
    function processMediaPlaylist(url, content) {
        const baseUrl = getBaseUrl(url);
        const lines = content.split('\n');
        const output = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            // 保留最后的空行
            if (!line && i === lines.length - 1) {
                output.push(line);
                continue;
            }
            if (!line) continue; // 跳过中间的空行

            if (line.startsWith('#EXT-X-KEY')) {
                output.push(processKeyLine(line, baseUrl));
                continue;
            }
            if (line.startsWith('#EXT-X-MAP')) {
                output.push(processMapLine(line, baseUrl));
                 continue;
            }
             if (line.startsWith('#EXTINF')) {
                 output.push(line);
                 continue;
             }
             if (!line.startsWith('#')) {
                 const absoluteUrl = resolveUrl(baseUrl, line);
                 logDebug(`重寫媒體片段: 原始='${line}', 絕對='${absoluteUrl}'`);
                 output.push(rewriteUrlToProxy(absoluteUrl));
                 continue;
             }
             // 其他 M3U8 标签直接添加
             output.push(line);
        }
        return output.join('\n');
    }

    // 递归处理 M3U8 内容
     async function processM3u8Content(targetUrl, content, recursionDepth = 0, env) {
         if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:')) {
             logDebug(`偵測到主播放列表: ${targetUrl}`);
             return await processMasterPlaylist(targetUrl, content, recursionDepth, env);
         }
         logDebug(`偵測到媒體播放列表: ${targetUrl}`);
         return processMediaPlaylist(targetUrl, content);
     }

    // 处理主 M3U8 播放列表
    async function processMasterPlaylist(url, content, recursionDepth, env) {
        if (recursionDepth > MAX_RECURSION) {
            throw new Error(`處理主列表時次數過多 (${MAX_RECURSION}): ${url}`);
        }

        const baseUrl = getBaseUrl(url);
        const lines = content.split('\n');
        let highestBandwidth = -1;
        let bestVariantUrl = '';

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                const currentBandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

                 let variantUriLine = '';
                 for (let j = i + 1; j < lines.length; j++) {
                     const line = lines[j].trim();
                     if (line && !line.startsWith('#')) {
                         variantUriLine = line;
                         i = j;
                         break;
                     }
                 }

                 if (variantUriLine && currentBandwidth >= highestBandwidth) {
                     highestBandwidth = currentBandwidth;
                     bestVariantUrl = resolveUrl(baseUrl, variantUriLine);
                 }
            }
        }

         if (!bestVariantUrl) {
             logDebug(`主列表中未找到 BANDWIDTH 或 STREAM-INF，嘗試查找第一個子列表引用: ${url}`);
             for (let i = 0; i < lines.length; i++) {
                 const line = lines[i].trim();
                 if (line && !line.startsWith('#') && (line.endsWith('.m3u8') || line.includes('.m3u8?'))) { // 修复：检查是否包含 .m3u8?
                    bestVariantUrl = resolveUrl(baseUrl, line);
                     logDebug(`備用方案：找到第一個子列表引用: ${bestVariantUrl}`);
                     break;
                 }
             }
         }

        if (!bestVariantUrl) {
            logDebug(`在主列表 ${url} 中未找到任何有效的子播放列表 URL。可能格式有問題或僅包含音頻/字幕。將嘗試按媒體列表處理原始内容。`);
            return processMediaPlaylist(url, content);
        }

        // --- 获取并处理选中的子 M3U8 ---

        const cacheKey = `m3u8_processed:${bestVariantUrl}`; // 使用处理后的缓存键

        let kvNamespace = null;
        try {
            kvNamespace = env.LIBRETV_PROXY_KV; // 从环境获取 KV 命名空间 (变量名在 Cloudflare 设置)
            if (!kvNamespace) throw new Error("KV 命名空間未綁定");
        } catch (e) {
            logDebug(`KV 命名空間 'LIBRETV_PROXY_KV' 訪問出錯或未綁定: ${e.message}`);
            kvNamespace = null; // 确保设为 null
        }

        if (kvNamespace) {
            try {
                const cachedContent = await kvNamespace.get(cacheKey);
                if (cachedContent) {
                    logDebug(`[緩存命中] 主列表的子列表: ${bestVariantUrl}`);
                    return cachedContent;
                } else {
                    logDebug(`[緩存未命中] 主列表的子列表: ${bestVariantUrl}`);
                }
            } catch (kvError) {
                logDebug(`從 KV 讀取緩存失敗 (${cacheKey}): ${kvError.message}`);
                // 出错则继续执行，不影响功能
            }
        }

        logDebug(`選擇的子列表 (帶寬: ${highestBandwidth}): ${bestVariantUrl}`);
        const { content: variantContent, contentType: variantContentType } = await fetchContentWithType(bestVariantUrl);

        if (!isM3u8Content(variantContent, variantContentType)) {
            logDebug(`獲取到的子列表 ${bestVariantUrl} 不是 M3U8 内容 (類型: ${variantContentType})。可能直接是媒體文件，返回原始内容。`);
             // 如果不是M3U8，但看起来像媒体内容，直接返回代理后的内容
             // 注意：这里可能需要决定是否直接代理这个非 M3U8 的 URL
             // 为了简化，我们假设如果不是 M3U8，则流程中断或按原样处理
             // 或者，尝试将其作为媒体列表处理？（当前行为）
             // return createResponse(variantContent, 200, { 'Content-Type': variantContentType || 'application/octet-stream' });
             // 尝试按媒体列表处理，以防万一
             return processMediaPlaylist(bestVariantUrl, variantContent);

        }

        const processedVariant = await processM3u8Content(bestVariantUrl, variantContent, recursionDepth + 1, env);

        if (kvNamespace) {
             try {
                 // 使用 waitUntil 异步写入缓存，不阻塞响应返回
                 // 注意 KV 的写入限制 (免费版每天 1000 次)
                 waitUntil(kvNamespace.put(cacheKey, processedVariant, { expirationTtl: CACHE_TTL }));
                 logDebug(`已將處理後的子列表寫入緩存: ${bestVariantUrl}`);
             } catch (kvError) {
                 logDebug(`向 KV 寫入緩存失敗 (${cacheKey}): ${kvError.message}`);
                 // 写入失败不影响返回结果
             }
        }

        return processedVariant;
    }

    // --- 主要请求处理逻辑 ---

    try {
        const targetUrl = getTargetUrlFromPath(url.pathname);

        if (!targetUrl) {
            logDebug(`無效的代理請求路徑: ${url.pathname}`);
            return createResponse("無效的代理請求。路徑應為 /proxy/<經過編碼的URL>", 400);
        }

        logDebug(`收到代理請求: ${targetUrl}`);

        // --- 缓存检查 (KV) ---
        const cacheKey = `proxy_raw:${targetUrl}`; // 使用原始内容的缓存键
        let kvNamespace = null;
        try {
            kvNamespace = env.LIBRETV_PROXY_KV;
            if (!kvNamespace) throw new Error("KV 命名空间未绑定");
        } catch (e) {
            logDebug(`KV 命名空見 'LIBRETV_PROXY_KV' 訪問出錯或未綁定: ${e.message}`);
            kvNamespace = null;
        }

        if (kvNamespace) {
            try {
                const cachedDataJson = await kvNamespace.get(cacheKey); // 直接获取字符串
                if (cachedDataJson) {
                    logDebug(`[緩存命中] 原始内容: ${targetUrl}`);
                    const cachedData = JSON.parse(cachedDataJson); // 解析 JSON
                    const content = cachedData.body;
                    let headers = {};
                    try { headers = JSON.parse(cachedData.headers); } catch(e){} // 解析头部
                    const contentType = headers['content-type'] || headers['Content-Type'] || '';

                    if (isM3u8Content(content, contentType)) {
                        logDebug(`緩存内容是 M3U8，重新處理: ${targetUrl}`);
                        const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
                        return createM3u8Response(processedM3u8);
                    } else {
                        logDebug(`從緩存返回非 M3U8 内容: ${targetUrl}`);
                        return createResponse(content, 200, new Headers(headers));
                    }
                } else {
                     logDebug(`[緩存未命中] 原始内容: ${targetUrl}`);
                 }
            } catch (kvError) {
                 logDebug(`從 KV 讀取或解析緩存失敗 (${cacheKey}): ${kvError.message}`);
                 // 出错则继续执行，不影响功能
            }
        }

        // --- 实际请求 ---
        const { content, contentType, responseHeaders } = await fetchContentWithType(targetUrl);

        // --- 写入缓存 (KV) ---
        if (kvNamespace) {
             try {
                 const headersToCache = {};
                 responseHeaders.forEach((value, key) => { headersToCache[key.toLowerCase()] = value; });
                 const cacheValue = { body: content, headers: JSON.stringify(headersToCache) };
                 // 注意 KV 写入限制
                 waitUntil(kvNamespace.put(cacheKey, JSON.stringify(cacheValue), { expirationTtl: CACHE_TTL }));
                 logDebug(`已將原始内容寫入緩存: ${targetUrl}`);
            } catch (kvError) {
                 logDebug(`向 KV 寫入緩存失敗 (${cacheKey}): ${kvError.message}`);
                 // 写入失败不影响返回结果
            }
        }

        // --- 处理响应 ---
        if (isM3u8Content(content, contentType)) {
            logDebug(`内容是 M3U8，開始處理: ${targetUrl}`);
            const processedM3u8 = await processM3u8Content(targetUrl, content, 0, env);
            return createM3u8Response(processedM3u8);
        } else {
            logDebug(`內容不是 M3U8 (類型: ${contentType})，直接返回: ${targetUrl}`);
            const finalHeaders = new Headers(responseHeaders);
            finalHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
            // 添加 CORS 头，确保非 M3U8 内容也能跨域访问（例如图片、字幕文件等）
            finalHeaders.set("Access-Control-Allow-Origin", "*");
            finalHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
            finalHeaders.set("Access-Control-Allow-Headers", "*");
            return createResponse(content, 200, finalHeaders);
        }

    } catch (error) {
        logDebug(`處理代理请求時發生嚴重錯誤: ${error.message} \n ${error.stack}`);
        return createResponse(`代理處理錯誤: ${error.message}`, 500);
    }
}

// 处理 OPTIONS 预检请求的函数
export async function onOptions(context) {
    // 直接返回允许跨域的头信息
    return new Response(null, {
        status: 204, // No Content
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Headers": "*", // 允许所有请求头
            "Access-Control-Max-Age": "86400", // 预检请求结果缓存一天
        },
    });
}
