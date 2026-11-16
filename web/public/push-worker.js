// No offline caching: stove controls and readings must never come from a cache.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // Do not intercept Firebase/Google auth, API calls, assets, or other origins.
 if(event.request.mode==='navigate'&&url.origin===self.location.origin&&['/','/index.html'].includes(url.pathname)){
  event.respondWith(fetch(new Request(event.request,{cache:'no-store'})));
 }
});
self.addEventListener('push',event=>{
 let value={};try{value=event.data?.json()||{};}catch{}
 const title=typeof value.title==='string'?value.title.slice(0,100):'PARO · Obvestilo';
 const body=typeof value.body==='string'?value.body.slice(0,400):'Open the app for the latest stove state.';
 event.waitUntil(self.registration.showNotification(title,{body,tag:typeof value.tag==='string'?value.tag.slice(0,64):'paro-stove-alert',icon:'/icons/paro-flame-v1-192.png',badge:'/icons/paro-flame-v1-192.png',timestamp:Number.isFinite(value.at)?value.at:Number.isFinite(value.timestamp)?value.timestamp:Date.now(),data:{path:value.data?.view==='control'?'/?view=control':'/?view=status'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const path=event.notification.data?.path==='/?view=control'?'/?view=control':'/?view=status';
  const url=new URL(path,self.location.origin).href;
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}
  return self.clients.openWindow(url);
 })());
});
