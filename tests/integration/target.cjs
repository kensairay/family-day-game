function testOrigin(value) {
 const url = new URL(value);
 if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('測試網址只可指定origin');
 const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
 const staging = url.protocol === 'https:' && /^family-day-game-staging\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname);
 if (!local && !staging) throw new Error('只允許本機或獨立 family-day-game-staging.workers.dev，避免寫入正式環境');
 return url.origin;
}
module.exports = { testOrigin };
