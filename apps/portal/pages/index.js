import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000";

export default function Home() {
  const [form, setForm] = useState({ headline: "", backgroundUrl: "", newsImageUrl: "" });
  const [jobs, setJobs] = useState([]);

  const load = async () => {
    const res = await fetch(`${API}/jobs`);
    const data = await res.json();
    setJobs(data);
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API}/jobs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    if (res.ok) {
      setForm({ headline: "", backgroundUrl: "", newsImageUrl: "" });
      await load();
      alert('Job created!');
    } else {
      alert('Failed to create job');
    }
  };

  return (
    <div style={{maxWidth:900, margin:"30px auto", fontFamily:"system-ui"}}>
      <h1>PhotoCard Portal</h1>
      <form onSubmit={submit} style={{display:"grid", gap:12}}>
        <input placeholder="Headline (required)" value={form.headline} onChange={e=>setForm({...form, headline:e.target.value})}/>
        <input placeholder="Background URL (optional)" value={form.backgroundUrl} onChange={e=>setForm({...form, backgroundUrl:e.target.value})}/>
        <input placeholder="News Image URL (optional)" value={form.newsImageUrl} onChange={e=>setForm({...form, newsImageUrl:e.target.value})}/>
        <button type="submit">Create Job</button>
      </form>

      <hr style={{margin:"24px 0"}}/>
      <h2>Jobs</h2>
      <div style={{display:"grid", gap:16}}>
        {jobs.map(j=>(
          <div key={j.id} style={{padding:12, border:"1px solid #ddd", borderRadius:8}}>
            <div><b>ID:</b> {j.id}</div>
            <div><b>Status:</b> {j.status}</div>
            <div><b>Headline:</b> {j.headline}</div>
            {j.outputUrl && <img src={j.outputUrl} alt="card" style={{width:300, marginTop:8, borderRadius:8}}/>}
          </div>
        ))}
      </div>
    </div>
  );
}

