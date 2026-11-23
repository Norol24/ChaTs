# 👻 ChaTs

ChaTs est une application de conversation web (mobile-first) inspirée de Snapchat :
connexion par e-mail, amis avec statut en ligne, chats 1‑à‑1 et groupes, snaps photo,
créateur de personnage (avatar) et **vrais appels audio/vidéo** (solo et groupe) en WebRTC.

Les jeux arrivent dans une prochaine mise à jour 🎮

---

## 🚀 Lancer ChaTs sur ton ordinateur

Aucune compilation nécessaire : c'est du JavaScript moderne.

```bash
# option 1 (Node.js installé : https://nodejs.org)
npx serve .

# option 2 (Python installé)
python3 -m http.server 8000
```

Puis ouvre l'adresse affichée (ex. `http://localhost:3000`) — dans Chrome, idéalement.

## 🔥 Brancher Firebase (5 minutes, gratuit)

ChaTs a besoin d'un projet Firebase pour la connexion e-mail, les messages et les appels.

1. Va sur [console.firebase.google.com](https://console.firebase.google.com) → **Ajouter un projet** (nom : `chats`, Google Analytics : non nécessaire).
2. **Build → Authentication → Commencer → E-mail/Mot de passe → Activer → Enregistrer.**
3. **Build → Firestore Database → Créer une base de données** → choisis un emplacement → **Mode test** → **Activer**.
4. **⚙️ Paramètres du projet → Vos applications → Web `</>`** : nom `ChaTs` → **Enregistrer l'app**.
5. Copie le bloc `firebaseConfig` affiché (les 6 lignes avec `apiKey`, `projectId`, etc.).
6. Lance ChaTs : l'écran de démarrage te demande de **coller ce bloc** → **C'est parti !**

> Pour repartir de zéro (changer de projet Firebase) : vide les données du site dans ton
> navigateur, ou supprime la clé `chats_firebase_config` du localStorage.

### Tester à deux

Ouvre un second onglet **en navigation privée** (ou un autre appareil sur le même réseau) :

1. Crée un compte avec une autre adresse e-mail.
2. Dans **Amis**, recherche le pseudo ou l'e-mail du premier compte → **＋ Ajouter**.
3. Le premier compte accepte la demande dans l'onglet **Amis** → la discussion s'ouvre.
4. Envoie des messages, des photos 📷, et lance un **appel** 📞/🎥 : l'invitation s'affiche en direct.

## 🌍 Mettre ChaTs en ligne (URL partageable)

Avec [Firebase Hosting](https://firebase.google.com/docs/hosting) (inclus dans le forfait gratuit) :

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # sélectionne ton projet "chats"
firebase deploy             # déploie l'app + les règles Firestore
```

Ton app est alors en ligne sur `https://TON-PROJET.web.app` 🎉

## 🔒 Sécurité

Le **mode test** Firestore laisse tout ouvert pendant 30 jours. Le fichier
[`firestore.rules`](./firestore.rules) fourni ici limite l'accès aux utilisateurs connectés :

```bash
firebase deploy --only firestore:rules
```

## 📱 Notes sur les appels

- Les appels **WebRTC** fonctionnent entre deux appareils/navigateurs différents.
- Les appels fonctionnent sur `localhost` ou sur une URL en **HTTPS** (Firebase Hosting convient) : le navigateur exige ça pour donner accès à la caméra et au micro.
- Les appels passent par les serveurs **STUN** de Google. Si un réseau bloqué (entreprise, école) empêche la connexion, il faut ajouter un serveur **TURN** (offre gratuite possible) dans `js/call.js` (`ICE_SERVERS`).
- Côté Firestore, les appels utilisent les collections `calls/{id}/participants` et `calls/{id}/signals`.

## 🗂️ Structure du projet

```
index.html          Interface complète (écrans connexion, chats, amis, profil, appels)
css/styles.css      Thème « Snapchat » (noir + jaune)
js/config.js        Lecture du firebaseConfig (localStorage)
js/firebase.js      Initialisation Firebase
js/main.js          Navigation, onglets, discussions, groupes, caméra
js/store.js         Couche de données (Firestore) : users, amis, chats, groupes
js/avatar.js        Générateur d'avatar SVG + éditeur
js/presence.js      Statut en ligne (heartbeat Firestore)
js/call.js          Appels WebRTC 1‑à‑1 et de groupe (signalisation Firestore)
firebase.json       Configuration Firebase Hosting
firestore.rules     Règles de sécurité Firestore
```

## 🧭 Feuille de route

- 🎮 Jeux (pierre-feuille-ciseaux, quiz…)
- ⏳ Snaps éphémères (photos supprimées après visionnage) et compteur de flames 🔥
- ✏️ Modification du pseudo et statut personnalisé
- 🔔 Notifications push

---

Fait avec ❤️ par Norol24 — propulsé par Firebase + WebRTC.
