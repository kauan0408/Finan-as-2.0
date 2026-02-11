/* public/firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_AUTH_DOMAIN",
  projectId: "SEU_PROJECT_ID",
  storageBucket: "SEU_STORAGE_BUCKET",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "⏰ Lembrete";
  const options = {
    body: payload?.notification?.body || "Você tem um lembrete!",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
  };

  self.registration.showNotification(title, options);
});
