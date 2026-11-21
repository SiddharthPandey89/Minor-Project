// Minimal client-side export utilities for TERRAX

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function toCsv(rows) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

export function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

export function downloadJson(filename, obj) {
  const json = JSON.stringify(obj, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json;charset=utf-8;' }), filename);
}

export function downloadGeoJson(filename, features) {
  const fc = { type: 'FeatureCollection', features };
  downloadJson(filename, fc);
}

// Minimal PDF generator (text only)
export function downloadPdf(filename, lines) {
  const text = lines.join('\n');
  // Build a minimal PDF
  const content = `BT /F1 10 Tf 50 780 Td (${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj ET`;
  const pdf = `%PDF-1.4
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
<< /Length ${content.length} >>
stream
${content}
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
${320 + content.length}
%%EOF`;
  downloadBlob(new Blob([pdf], { type: 'application/pdf' }), filename);
}

export function safe(v) {
  if (v === null || v === undefined) return 'Data unavailable';
  return v;
}
