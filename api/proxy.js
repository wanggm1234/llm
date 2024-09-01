import httpProxy from 'http-proxy';
import url from 'url';
import cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

const proxy = httpProxy.createProxyServer({});

// 从环境变量中获取用户名和密码
const USERNAME = process.env.PROXY_USERNAME;
const PASSWORD = process.env.PROXY_PASSWORD;
const PROXY_SERVER_URL = process.env.PROXY_SERVER_URL;

function authenticate(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return false;

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');

    return username === USERNAME && password === PASSWORD;
}

function modifyHtmlContent(body) {
    const $ = cheerio.load(body);
    $('a').each((index, element) => {
        const originalUrl = $(element).attr('href');
        const modifiedUrl = `${PROXY_SERVER_URL}/${originalUrl}`;
        $(element).attr('href', modifiedUrl);
    });
    return $.html();
}

function modifyNonHtmlContent(req, proxyRes, res) {
    const originalUrl = req.url;
    const modifiedUrl = `${PROXY_SERVER_URL}${originalUrl}`;

    // 修改响应头中的 content-location 和 location
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

    proxy.web(req, res, proxyOptions, (err) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy Error');
    });

    proxy.on('proxyRes', (proxyRes, req, res) => {
        const contentType = proxyRes.headers['content-type'];

        if (contentType && contentType.includes('text/html')) {
            let body = '';
            proxyRes.on('data', (chunk) => {
                body += chunk;
            });

            proxyRes.on('end', () => {
                const modifiedHtml = modifyHtmlContent(body);
                res.end(modifiedHtml);
            });
        } else if (contentType) {
            // 处理非 HTML 内容
            modifyNonHtmlContent(req, proxyRes, res);
        } else {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Unsupported content type');
        }
    });
}
