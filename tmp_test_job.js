const fs = require('fs');

(async () => {
  try {
    console.log('posting job...');
    const post = await fetch('http://localhost:4000/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: 'Test Render with Logo',
        backgroundUrl: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?auto=format&fit=crop&w=1080&q=80',
        newsImageUrl: 'https://res.cloudinary.com/demo/image/upload/w_540,h_540,c_fill/sample.jpg'
      })
    });

    const job = await post.json();
    if (!job || !job.id) {
      console.error('failed to create job', job);
      process.exit(1);
    }

    console.log('created job', job.id);

    let final = null;
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`http://localhost:4000/jobs/${job.id}`);
      const j = await r.json();
      console.log(new Date().toISOString(), 'status', j.status);
      if (j.status === 'DONE') {
        final = j;
        break;
      }
      if (j.status === 'ERROR') {
        console.error('job error', j);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!final) {
      console.error('job did not finish in time');
      process.exit(1);
    }

    console.log('job done, outputUrl=', final.outputUrl);
    const outResp = await fetch(final.outputUrl);
    if (!outResp.ok) {
      console.error('failed to fetch output', outResp.status);
      process.exit(1);
    }
    const arr = await outResp.arrayBuffer();
    const dest = 'C:\\Windows\\Temp\\photocard_test.png';
    fs.writeFileSync(dest, Buffer.from(arr));
    console.log('saved output to', dest);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
