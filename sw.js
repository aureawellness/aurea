const CACHE='aurea-v17';
const ASSETS=['index.html','manifest.webmanifest','icon-192.png','icon-512.png','icon-180.png','icon-512-maskable.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{ if(e.data==='skipWaiting')self.skipWaiting(); });

// ===== Notifiche push (Fase 3) =====
// Ricezione di una push dal server (quando l'app sarà nativa / con backend push).
self.addEventListener('push',e=>{
  let data={title:'Auréa',body:'Hai un nuovo aggiornamento.'};
  try{ if(e.data) data=Object.assign(data,e.data.json()); }catch(_){ try{ data.body=e.data.text(); }catch(__){} }
  e.waitUntil(self.registration.showNotification(data.title||'Auréa',{
    body:data.body||'', icon:'icon-192.png', badge:'icon-192.png', tag:data.tag||'aurea',
    data:{url:data.url||'index.html'}, vibrate:[80,40,80]
  }));
});
// Tap sulla notifica: porta l'utente all'app (o alla schermata indicata).
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'index.html';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){ if('focus' in c) return c.focus(); }
    if(clients.openWindow) return clients.openWindow(url);
  }));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  // non intercettare le chiamate all'API AI
  if(url.hostname.includes('anthropic.com')) return;
  const isDoc = e.request.mode==='navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if(isDoc){
    // Pagina principale: prima la rete (così gli aggiornamenti arrivano subito), poi la cache come riserva offline
    e.respondWith(
      fetch(e.request).then(resp=>{ const cp=resp.clone(); caches.open(CACHE).then(c=>c.put('index.html',cp)); return resp; })
        .catch(()=>caches.match('index.html').then(r=>r||caches.match(e.request)))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r=>r || fetch(e.request).then(resp=>{
      if(e.request.method==='GET' && resp.status===200 && url.origin===location.origin){
        const cp=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp));
      }
      return resp;
    }).catch(()=>caches.match('index.html')))
  );
});
