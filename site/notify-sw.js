// Shows the "new chapter" notifications sent by .github/workflows/notify.yml.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch (err) {}
  const d = Object.assign({}, payload.notification, payload.data);
  e.waitUntil(self.registration.showNotification(d.title || "The Legend Of Chris", {
    body: d.body || "A new chapter of the MASTER FILE is out.",
    icon: new URL("assets/icon-192.png", self.registration.scope).href,
    badge: new URL("assets/icon-192.png", self.registration.scope).href,
    tag: d.tag || "loc-chapter",
    data: { url: new URL("read.html" + (d.slug ? "#" + d.slug : ""), self.registration.scope).href }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && "navigate" in c) return c.navigate(url).then(w => (w || c).focus(), () => self.clients.openWindow(url));
    }
    return self.clients.openWindow(url);
  }));
});
