// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";

// 🔧 CONFIG DO SEU PROJETO (copiada do Firebase)
const firebaseConfig = {
  apiKey: "AIzaSyA6cdF26jyRSuclkPNjcHNFpLey5GuM5Q4",
  authDomain: "financas-offline.firebaseapp.com",
  projectId: "financas-offline",
  storageBucket: "financas-offline.firebasestorage.app",
  messagingSenderId: "353840341280",
  appId: "1:353840341280:web:1ac5be0ca48ba34f7fb745",
  measurementId: "G-7RTK0Z27RM",
};

// 🚀 Inicializa o app Firebase
const app = initializeApp(firebaseConfig);

// 🔐 Autenticação
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// força abrir seleção de conta
provider.setCustomParameters({
  prompt: "select_account",
});

export function loginComGoogle() {
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
}

// ☁️ Firestore (banco de dados)
export const db = getFirestore(app);

/**
 * 💾 salvarDados
 * Salva um "bloco" de dados para o usuário em:
 *  usuarios/{uid}/dados/{tipo}
 *
 * Exemplo de tipo: "profile", "transacoes", "cartoes", "reserva"
 */
export async function salvarDados(uid, tipo, dados) {
  if (!uid || !tipo) return;
  const ref = doc(db, "usuarios", uid, "dados", tipo);
  await setDoc(ref, dados, { merge: true });
}

/**
 * 📥 carregarDados
 * Busca os dados em:
 *  usuarios/{uid}/dados/{tipo}
 */
export async function carregarDados(uid, tipo) {
  if (!uid || !tipo) return null;
  const ref = doc(db, "usuarios", uid, "dados", tipo);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data();
}
