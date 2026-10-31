// Costruisce elementi senza innerHTML: i testi di Telegram restano solo testo.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.filter((child) => child !== null && child !== undefined));
  return el;
}

// Sostituisce il contenuto del contenitore e riporta la pagina in cima.
export function mount(root, ...children) {
  root.replaceChildren(...children);
  window.scrollTo(0, 0);
}

// Risolve dopo che il browser ha davvero disegnato il fotogramma corrente.
export function afterPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}
