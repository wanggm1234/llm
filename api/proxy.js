import httpProxy from 'http-proxy';
import url from 'url';
import cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const proxy = httpProxy.createProxyServer({});

const USERNAME = process.env.PROXY_USERNAME;
const PASSWORD = process.env.PROXY_PASSWORD;
const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL;

if (!USERNAME || !PASSWORD || !PROXY_SERVER_URL) {
    console.error('Missing environment variables');
    process.exit(1);
}

function authenticate(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    return username === USERNAME && password === PASSWORD;
}

function modifyHtmlContent(body) {
    if (!body) {
        throw new Error('HTML content is undefined');
    }
    const $ = cheerio.load(body);
    
    // 修改所有链接
    $('a').each((index, element) => {
        const originalUrl = $(element).attr('href');
        const modifiedUrl = new URL(originalUrl, PROXY_SERVER_URL).href;
        $(element).attr('href', modifiedUrl);
    });

    // 添加自定义属性
    $('body').attr('data-proxy', 'true');

    return $.html();
}

function modifyNonHtmlContent(req, proxyRes, res) {
    const originalUrl = req.url;
    const modifiedUrl = `${PROXY_SERVER_URL}${originalUrl}`;

    if (proxyRes.headers['content-location']) {
        proxyRes.headers['content-location'] = modifiedUrl;
    }
    if (proxyRes.headers['location']) {
        proxyRes.headers['location'] = modifiedUrl;
    }

    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
}

export default function handler(req, res) {
    // 认证请求
    if (!authenticate(req)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Proxy Server"');
        return res.status(401).send('Unauthorized');
    }

    const targetUrl = url.parse(req.url, true).query.url;
    if (!targetUrl) {
        return res.status(400).send('Missing target URL');
    }

    const isHttps = targetUrl.startsWith('https://');

    const proxyOptions = {
        target: targetUrl,
        changeOrigin: true,
        secure: isHttps,
    };

    // 代理请求
    proxy.web(req, res, proxyOptions, (err) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy Error: ' + err.message);
    });

    // 处理代理响应
    proxy.on('proxyRes', (proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'];

        // 处理重定向
        if ([301, 302].includes(proxyRes.statusCode)) {
            const location = proxyRes.headers['location'];
            if (location) {
                proxyRes.headers['location'] = `${PROXY_SERVER_URL}${location}`;
            }
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            return res.end();
        }

        // 处理 HTML 内容
        if (contentType && contentType.includes('text/html')) {
            let body = '';
            proxyRes.on('data', (chunk) => {
                body += chunk;
            });

            proxyRes.on('end', () => {
                try {
                    const modifiedHtml = modifyHtmlContent(body);
                    res.end(modifiedHtml);
                } catch (error) {
                    console.error('Error modifying HTML content:', error);
                    res.status(500).send('Error modifying HTML content');
                }
            });
        } else if (contentType) {
            // 处理非 HTML 内容
            modifyNonHtmlContent(req, proxyRes, res);
        } else {
            // 不支持的内容类型
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Unsupported content type');
        }
    });
}
