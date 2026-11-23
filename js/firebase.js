import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  addDoc, query, where, orderBy, limit, limitToLast, serverTimestamp,
  onSnapshot, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let app = null;

export const fs = {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc,
  query, where, orderBy, limit, limitToLast, serverTimestamp, onSnapshot,
  arrayUnion, arrayRemove,
};
export const authApi = {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, updateProfile,
};

export function initFirebase(cfg) {
  if (app) deleteApp(app);
  app = initializeApp(cfg);
}

export function db() {
  return getFirestore(app);
}

export function fbAuth() {
  return getAuth(app);
}
