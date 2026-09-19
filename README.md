# 🔐 SecureChat - Groupe 27

> Application de messagerie web chiffrée de bout en bout (E2EE) avec appels audio/vidéo sécurisés.

[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://secure-chat-bice.vercel.app)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-orange?logo=firebase)](https://firebase.google.com)
[![License](https://img.shields.io/badge/License-Academic-blue)]()

---

## 👥 Membres du Groupe

| Nom | Rôle |
|-----|------|
| **NDUBU LULE BENITO** | Développeur Backend & Firebase |
| **KAMBA KATANU NOÉ** | Développeur Frontend & Cryptographie |
| **WUMBA WUMBA ALBERT** |Frontend |

**Groupe :** 27 - Sécurité Réseau  
**Module :** Protocoles de Sécurité Réseau & Cryptographie  
**Année académique :** 2025 - 2026  
**Université :** Université de Kinshasa - Faculté des Sciences et Technologies

---

## 🎯 Objectifs du Projet

### Objectif Général
Développer et déployer une application de messagerie web permettant à deux utilisateurs de communiquer de manière confidentielle, **sans que le serveur puisse lire les messages**.

### Objectifs Spécifiques
- ✅ Concevoir une architecture sécurisée à 3 tiers
- ✅ Implémenter l'authentification via Firebase Auth
- ✅ Générer les clés cryptographiques localement (Web Crypto API)
- ✅ Chiffrer les messages avec RSA-OAEP 2048 bits
- ✅ Déployer l'application en HTTPS sur Vercel
- ✅ Implémenter des appels audio/vidéo chiffrés (WebRTC)

---


---

## 🔐 Protocoles et Mécanismes de Sécurité

| # | Mécanisme | Rôle |
|---|-----------|------|
| 1 | **RSA-OAEP 2048 bits** | Chiffrement asymétrique des messages |
| 2 | **Web Crypto API (SubtleCrypto)** | Opérations cryptographiques côté client |
| 3 | **SHA-256** | Hachage et contrôle d'intégrité |
| 4 | **HTTPS/TLS** | Chiffrement du transport |
| 5 | **WebRTC / DTLS-SRTP** | Appels audio/vidéo chiffrés |
| 6 | **Firebase Auth (JWT)** | Authentification et sessions |

### Principe du Chiffrement de Bout en Bout


**Point fondamental :** Le serveur ne possède **jamais** la clé privée. Il ne peut donc **jamais** déchiffrer les messages.

---

## 📦 Installation Locale

### Prérequis
- **Node.js** (v18 ou supérieur) — [Télécharger](https://nodejs.org)
- **Git** — [Télécharger](https://git-scm.com)
- Un navigateur moderne (Chrome, Firefox, Edge)

### Étapes

1. **Cloner le dépôt**
   ```bash
   git clone https://github.com/Mr-benito/secureChat.git
   cd secureChat

   npm install
   

## 🏗️ Architecture
