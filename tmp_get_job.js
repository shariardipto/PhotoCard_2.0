(async ()=>{try{const id='cmgdtc1h'; const r=await fetch('http://localhost:4000/jobs/'+id); const j=await r.json(); console.log(JSON.stringify(j,null,2));}catch(e){console.error(e);}})();
