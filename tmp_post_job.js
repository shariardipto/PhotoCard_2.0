const http = require('http');

const data = JSON.stringify({
  headline: 'Test Compose',
  backgroundUrl: 'https://images.unsplash.com/photo-1503264116251-35a269479413',
  newsImageUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2'
});

const opts = new URL('http://localhost:4000/jobs');

const req = http.request(opts, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
  console.log('status', res.statusCode);
  res.setEncoding('utf8');
  res.on('data', (chunk) => console.log(chunk));
  res.on('end', () => console.log('done'));
});
req.on('error', (e) => console.error('req error', e));
req.write(data);
req.end();
