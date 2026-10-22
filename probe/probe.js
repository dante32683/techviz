// techviz sandbox probe: reports what the host widget iframe allows.
(function () {
  const out = document.getElementById('tv-probe') || document.body.appendChild(document.createElement('div'));
  const rows = [];
  const show = () => {
    out.innerHTML = '<table style="font:13px var(--font-mono,monospace);border-collapse:collapse">' +
      rows.map(([k, v, ok]) => `<tr><td style="padding:2px 10px 2px 0;color:var(--text-secondary,#888)">${k}</td><td style="color:${ok ? 'var(--text-success,#3B6D11)' : 'var(--text-danger,#A32D2D)'}">${v}</td></tr>`).join('') + '</table>';
  };
  const add = (k, v, ok) => { rows.push([k, v, ok]); show(); };
  const t0 = performance.now();
  add('script from jsDelivr gh', 'loaded', true);
  const cs = getComputedStyle(document.documentElement);
  const tp = cs.getPropertyValue('--text-primary').trim();
  add('host CSS vars', tp ? `--text-primary=${tp}` : 'missing', !!tp);
  add('dark mode', String(matchMedia('(prefers-color-scheme: dark)').matches), true);
  // Minimal wasm module: (module) = 8 bytes.
  const wasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  WebAssembly.compile(wasmBytes).then(() => add('WebAssembly.compile', 'ok', true), (e) => add('WebAssembly.compile', String(e), false));
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['postMessage(6*7)'], { type: 'text/javascript' })));
    w.onmessage = (m) => add('blob Worker', 'ok ' + m.data, true);
    w.onerror = (e) => add('blob Worker', 'error ' + (e.message || ''), false);
  } catch (e) { add('blob Worker', String(e), false); }
  fetch('https://cdn.jsdelivr.net/npm/katex@0.16.11/package.json').then((r) => r.json()).then((j) => add('fetch jsDelivr', 'ok ' + j.version, true), (e) => add('fetch jsDelivr', String(e), false));
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@viz-js/viz@3.31.0/dist/viz-global.js';
  s.onload = () => {
    const t1 = performance.now();
    Viz.instance().then((viz) => {
      const svg = viz.renderSVGElement('digraph{rankdir=LR;node[shape=circle];S0[shape=doublecircle];S0->S1[label="1"];S1->S0[label="0"]}');
      svg.style.maxWidth = '260px';
      out.after(svg);
      add('Graphviz WASM (viz.js)', `ok in ${Math.round(performance.now() - t1)} ms after load`, true);
    }, (e) => add('Graphviz WASM (viz.js)', String(e), false));
  };
  s.onerror = () => add('viz.js script', 'blocked or failed', false);
  document.head.appendChild(s);
  setTimeout(() => add('elapsed', Math.round(performance.now() - t0) + ' ms', true), 4000);
})();
