# Consignes de protection du projet Diving Aware

## Vision Produit
Diving Aware est un outil d'identification de la biodiversité marine destiné aux plongeurs et aux centres de plongée. Sa valeur repose sur la précision de l'IA (Gemini) et la qualité des fiches PDF générées.

## Règles de Sécurité Invariants
- **Quotas** : Un utilisateur gratuit est limité à 3 analyses/jour. Cette règle est appliquée côté client ET validée par les `firestore.rules`.
- **Accès Premium** : Les statuts `isPremium` et `isDiveCenter` ne doivent JAMAIS être modifiables par le client. Ils sont gérés par Stripe ou manuellement par l'admin.
- **Back-end obligatoire** : Toutes les appels à Stripe et Gemini doivent passer par le serveur Express (`server.ts`) pour ne jamais exposer les clés API.

## Design System
- Couleurs : Bleu Marine `#003466`, Accents Cyan, Fond Blanc cassé.
- Typographie : Serif pour le prestige (Titres PDF), Sans-serif moderne pour l'UI.

## Maintenance
- Toujours vérifier que le logo Diving Aware est présent et lisible sur les PDF.
- En mode "Centre de Plongée", le logo du partenaire doit être affiché à côté de celui de Diving Aware, jamais à sa place.
