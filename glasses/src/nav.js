// Indietro di sistema: la lista è la voce base e aprire una chat aggiunge una
// sola voce. La piattaforma ammette al massimo cinque voci totali.
let onRoute = () => {};

function currentRoute(state) {
  return state?.screen === 'chat' ? state : { screen: 'chats' };
}

export function startNav(handler) {
  onRoute = handler;
  window.addEventListener('popstate', (event) => onRoute(currentRoute(event.state)));
}

// Va chiamata quando lista e chat sono pronte: rende anche il caso del reload
// dentro una chat, dove la voce corrente è già quella della conversazione.
export function resumeRoute() {
  const route = currentRoute(history.state);
  if (route.screen === 'chats') history.replaceState(route, '');
  onRoute(route);
}

export function openChat(chatId) {
  const route = { screen: 'chat', chatId };
  history.pushState(route, '');
  onRoute(route);
}
