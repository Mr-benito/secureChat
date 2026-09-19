SecureChat - Groupe 27
Application de messagerie web chiffrée de bout en bout (E2EE).

Membres du groupe
Nom	Rôle
NDUBU LULE BENITO	Développeur Backend et Firebase
KAMBA KATANU NOÉ	Développeur Frontend et Cryptographie
WUMBA WUMBA ALBERT	Frontend
Groupe : 27 - Sécurité Réseau
Module : Protocoles de Sécurité Réseau et Cryptographie
Année académique : 2025 - 2026
Université de Kinshasa - Faculté des Sciences et Technologies

Objectifs
Objectif général : Développer et déployer une application de messagerie web permettant à deux utilisateurs de communiquer de manière confidentielle, sans que le serveur puisse lire les messages.

Objectifs spécifiques :

Concevoir une architecture sécurisée à 3 tiers

Implémenter l'authentification via Firebase Auth

Générer les clés cryptographiques localement avec la Web Crypto API

Chiffrer les messages avec RSA-OAEP 2048 bits

Déployer l'application en HTTPS sur Vercel

Implémenter des appels audio et vidéo chiffrés avec WebRTC

Architecture
Le projet repose sur une architecture à trois tiers.

Tier 1 : Navigateur web (client)

HTML5, CSS3, JavaScript ES6

Web Crypto API pour les opérations cryptographiques

Firebase SDK pour la communication avec le backend

Tier 2 : Backend Firebase

Firebase Authentication pour la gestion des comptes

Cloud Firestore pour la base de données en temps réel

Tier 3 : Base de données

Collection users : uid, username, email, publicKey

Collection chats : chatId, lastMessage, timestamp

Collection messages : ciphertext, senderId, receiverId, timestamp

Flux d'un message :

L'expéditeur saisit un message

Le message est chiffré localement avec la clé publique du destinataire

Le message chiffré est envoyé à Firestore

Firestore stocke le message sans pouvoir le lire

Le destinataire reçoit le message chiffré

Le destinataire le déchiffre avec sa clé privée

Protocoles et mécanismes de sécurité
Mécanisme	Rôle
RSA-OAEP 2048 bits	Chiffrement asymétrique des messages
Web Crypto API	Opérations cryptographiques côté client
SHA-256	Hachage et contrôle d'intégrité
HTTPS/TLS	Chiffrement du transport
WebRTC / DTLS-SRTP	Appels audio et vidéo chiffrés
Firebase Auth (JWT)	Authentification et gestion des sessions
Installation locale
Prérequis :

Node.js version 18 ou supérieure

Git

Un navigateur moderne

Étapes :

Cloner le dépôt
git clone https://github.com/Mr-benito/secureChat.git
cd secureChat

Lancer l'application
npx serve .

Accéder à l'application
Ouvrir http://localhost:3000 dans le navigateur

Alternative : ouvrir directement le fichier login.html dans le navigateur.

Déploiement
Service	URL	Statut
Frontend Vercel	https://secure-chat-bice.vercel.app	HTTPS actif
Backend Firebase	Firebase Auth et Firestore	Actif
Dépôt GitHub	https://github.com/Mr-benito/secureChat	Public
Tests
Test	Cible	Résultat attendu	Statut
Authentification	Firebase Auth	Token JWT valide	Réussi
Chiffrement client	Web Crypto API	Ciphertext illisible sans clé	Réussi
Inspection serveur	Firestore	Contenu inintelligible	Réussi
Appel vidéo	PeerJS WebRTC	Flux DTLS-SRTP	Réussi
Injection XSS	Champs de saisie	Sanitisation correcte	Réussi
Navigation privée	URL publique	Site accessible	Réussi
Limites identifiées :

Dépendance à la sécurité du terminal client

Métadonnées visibles côté serveur

Absence de Forward Secrecy parfaite

Clé privée stockée dans le localStorage

Identifiants de démonstration
Email	Mot de passe
demo1@securechat.com	Demo1234!
demo2@securechat.com	Demo1234!
Technologies utilisées
Catégorie	Technologie
Frontend	HTML5, CSS3, JavaScript ES6
Cryptographie	Web Crypto API (RSA-OAEP, SHA-256)
Backend	Firebase Authentication et Firestore
Appels	PeerJS (WebRTC)
Icônes	Font Awesome 6.5.1
Hébergement	Vercel
Licence
Projet académique réalisé dans le cadre du module Protocoles de Sécurité Réseau et Cryptographie à l'Université de Kinshasa.

© 2026 - Groupe 27
