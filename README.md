# 🔐 SecureChat - Groupe 27

> Application de messagerie web chiffrée de bout en bout (E2EE) avec appels audio/vidéo sécurisés.

[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://secure-chat-bice.vercel.app)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-orange?logo=firebase)](https://firebase.google.com)

---

## 👥 Membres du Groupe

| Nom | Rôle |
|-----|------|
| **NDUBU LULE BENITO** | Développeur Backend & Firebase |
| **KAMBA KATANU NOÉ** | Développeur Frontend & Cryptographie |
| **WUMBA WUMBA ALBERT** | Frontend |

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

## 🏗️ Architecture

### Vue d'ensemble (3 tiers)

```mermaid
graph TB
    subgraph CLIENT["🌐 NAVIGATEUR WEB (Client)"]
        A1[HTML5 + CSS3 + JavaScript ES6]
        A2[Web Crypto API - SubtleCrypto]
        A3[Firebase SDK]
    end

    subgraph BACKEND["☁️ BACKEND FIREBASE"]
        B1[Firebase Authentication]
        B2[Cloud Firestore]
    end

    subgraph DB["💾 BASE DE DONNÉES"]
        C1[📁 users]
        C2[📁 chats]
        C3[📁 messages]
    end

    CLIENT -->|🔒 HTTPS/TLS| BACKEND
    BACKEND -->|📦 SDK| DB

    style CLIENT fill:#e3f2fd,stroke:#1976d2,stroke-width:2px

# 🔐 SecureChat - Groupe 27

> Application de messagerie web chiffrée de bout en bout (E2EE) avec appels audio/vidéo sécurisés.

[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://secure-chat-bice.vercel.app)
[![Firebase](https://img.shields.io/badge/Backend-Firebase-orange?logo=firebase)](https://firebase.google.com)

---

## 👥 Membres du Groupe

| Nom | Rôle |
|-----|------|
| **NDUBU LULE BENITO** | Développeur Backend & Firebase |
| **KAMBA KATANU NOÉ** | Développeur Frontend & Cryptographie |
| **WUMBA WUMBA ALBERT** | Frontend |

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

## 🏗️ Architecture

### Vue d'ensemble (3 tiers)

```mermaid
graph TB
    subgraph CLIENT["🌐 NAVIGATEUR WEB (Client)"]
        A1[HTML5 + CSS3 + JavaScript ES6]
        A2[Web Crypto API - SubtleCrypto]
        A3[Firebase SDK]
    end

    subgraph BACKEND["☁️ BACKEND FIREBASE"]
        B1[Firebase Authentication]
        B2[Cloud Firestore]
    end

    subgraph DB["💾 BASE DE DONNÉES"]
        C1[📁 users]
        C2[📁 chats]
        C3[📁 messages]
    end

    CLIENT -->|🔒 HTTPS/TLS| BACKEND
    BACKEND -->|📦 SDK| DB

    style CLIENT fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style BACKEND fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style DB fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style BACKEND fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    style DB fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
