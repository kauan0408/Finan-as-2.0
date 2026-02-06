import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles/global.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Elemento #root não encontrado");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ✅ REGISTRA SERVICE WORKER APENAS EM PRODUÇÃO
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      // 🔴 ANTES: "/service-worker.js"
      // ✅ AGORA:
      .register("/sw.js")
      .then(() => console.log("Service Worker registrado"))
      .catch((err) =>
        console.error("Erro ao registrar Service Worker:", err)
      );
  });
}
