# 🔐 SecureChat - Groupe 27

> Application de messagerie web chiffrée de bout en bout (E2EE) avec appels audio/vidéo sécurisés.

---

## 👥 Membres du Groupe

| Nom | Rôle |
|-----|------|
| **NDUBU LULE BENITO** | Développeur Backend & Firebase |
| **KAMBA KATANU NOÉ** | Développeur Frontend & Cryptographie |
| **WUMBA WUMBA ALBERT** | Frontend |

- **Groupe :** 27 - Sécurité Réseau
- **Module :** Protocoles de Sécurité Réseau & Cryptographie
- **Année académique :** 2025 - 2026
- **Université :** Université de Kinshasa - Faculté des Sciences et Technologies

---

## 🎯 Objectifs

### Objectif Général
Développer et déployer une application de messagerie web permettant à deux utilisateurs de communiquer de manière confidentielle, **sans que le serveur puisse lire les messages**.

### Objectifs Spécifiques
- Concevoir une architecture sécurisée à 3 tiers
- Implémenter l'authentification via Firebase Auth
- Générer les clés cryptographiques localement (Web Crypto API)
- Chiffrer les messages avec RSA-OAEP 2048 bits
- Déployer l'application en HTTPS sur Vercel
- Implémenter des appels audio/vidéo chiffrés (WebRTC)

---

## 🏗️ Architecture

Le projet repose sur une architecture à trois tiers.

### Tier 1 : Navigateur Web (Client)
- HTML5, CSS3, JavaScript ES6
- Web Crypto API pour les opérations cryptographiques
- Firebase SDK pour la communication avec le backend

### Tier 2 : Backend Firebase
- Firebase Authentication pour la gestion des comptes
- Cloud Firestore pour la base de données temps réel

### Tier 3 : Base de Données
- `users` : uid, username, email, publicKey
- `chats` : chatId, lastMessage, timestamp
- `messages` : ciphertext, senderId, receiverId, timestamp

### Flux d'un message

1. L'expéditeur saisit un message
2. Le message est chiffré localement avec la clé publique du destinataire
3. Le message chiffré est envoyé à Firestore
4. Firestore stocke le message sans pouvoir le lire
5. Le destinataire reçoit le message chiffré
6. Le destinataire le déchiffre avec sa clé privée

---

## 🔐 Protocoles et Mécanismes de Sécurité

| Mécanisme | Rôle |
|-----------|------|
| **RSA-OAEP 2048 bits** | Chiffrement asymétrique des messages |
| **Web Crypto API** | Opérations cryptographiques côté client |
| **SHA-256** | Hachage et contrôle d'intégrité |
| **HTTPS/TLS** | Chiffrement du transport |
| **WebRTC / DTLS-SRTP** | Appels audio et vidéo chiffrés |
| **Firebase Auth (JWT)** | Authentification et gestion des sessions |

---

## 📦 Installation Locale

### Prérequis
- Node.js version 18 ou supérieure
- Git
- Un navigateur moderne (Chrome, Firefox, Edge)

### Étapes

1. Cloner le dépôt
   ```bash
   git clone https://github.com/Mr-benito/secureChat.git
   cd secureChat
