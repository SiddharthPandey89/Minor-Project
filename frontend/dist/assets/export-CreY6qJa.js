function a(o,t){const e=URL.createObjectURL(o),n=document.createElement("a");n.href=e,n.download=t,document.body.appendChild(n),n.click(),document.body.removeChild(n),URL.revokeObjectURL(e)}function s(o){const t=e=>{if(e==null)return"";const n=String(e);return/[",\n]/.test(n)?'"'+n.replace(/"/g,'""')+'"':n};return o.map(e=>e.map(t).join(",")).join(`
`)}function r(o,t){const e=s(t);a(new Blob([e],{type:"text/csv;charset=utf-8;"}),o)}function d(o,t){const e=JSON.stringify(t,null,2);a(new Blob([e],{type:"application/json;charset=utf-8;"}),o)}function l(o,t){d(o,{type:"FeatureCollection",features:t})}function i(o,t){const n=`BT /F1 10 Tf 50 780 Td (${t.join(`
`).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")}) Tj ET`,c=`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${n.length} >>
stream
${n}
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 65535 f 
0000000058 65535 f 
0000000115 65535 f 
0000000214 65535 f 
0000000263 65535 f 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
${320+n.length}
%%EOF`;a(new Blob([c],{type:"application/pdf"}),o)}export{l as a,i as b,r as d};
