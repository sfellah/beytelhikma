# Certificats de signature Android

Les trois certificats que le Google Play Console remet une fois **Play App
Signing** activé pour `org.beytelhikma.app`. Émis par Google le 4 août 2026,
valides jusqu'au 4 août 2056.

**Ce sont des certificats publics.** Un `.der` ne porte que la partie publique
d'une paire de clés : rien ici n'est secret, Google les publie à qui interroge
une application installée, et c'est pourquoi ils sont suivis par git. La clé
privée correspondante est chez Google et n'en sort jamais.

## Qui signe quoi

Play App Signing coupe la chaîne en deux, et c'est toute la logique du dossier :

- **La clé de signature d'application** est celle dont Google signe l'APK
  qu'il livre à l'appareil. Google la détient. C'est elle que ces certificats
  décrivent. Elle ne change **jamais** — une application ne peut pas être mise à
  jour par une autre signature, c'est la règle d'Android.
- **La clé d'upload** est la tienne. Elle ne sert qu'à prouver au Console que
  l'envoi vient bien de toi ; Google la retire du bundle et re-signe. Elle
  n'est pas dans ce dossier, elle ne doit jamais y être, et elle est
  **remplaçable** : perdue, on en enregistre une autre par une demande de
  réinitialisation.

C'est cette asymétrie qui rend la perte de la clé d'upload survivable, quand la
perte d'une clé de signature à l'ancienne était définitive.

## Les trois fichiers

| Fichier | Rôle | Algorithme |
| --- | --- | --- |
| `deployment_cert.der` | signature des APK livrés | RSA 4096, SHA256withRSA |
| `hybrid_classical_cert.der` | volet classique de la signature hybride | RSA 4096, SHA256withRSA |
| `hybrid_pqc_cert.der` | volet post-quantique de la même signature | ML-DSA-65 (OID `2.16.840.1.101.3.4.3.18`) |

Les deux derniers vont ensemble : Android vérifie la signature classique **et**
la signature post-quantique. Le couple existe parce qu'un appareil ancien ne
sait pas lire ML-DSA, et qu'un attaquant futur disposant d'un calculateur
quantique casserait RSA seul. Aucune action de ta part : Google les applique.

## Empreintes

À reporter dans un service tiers qui demande une empreinte de certificat —
Firebase, Google Sign-In, une API cartographique. C'est **`deployment_cert`**
qu'ils veulent, jamais la clé d'upload : c'est la signature que l'appareil voit.

```
deployment_cert
  SHA-1    BB:AB:25:03:7F:BB:A9:F6:4B:B3:9A:DE:76:C1:1D:CD:12:76:A8:D9
  SHA-256  42:AD:C6:43:1A:47:53:ED:FC:18:EB:9A:DC:46:8B:1D:
           28:59:5A:D9:1A:90:29:31:AA:CC:4B:36:CA:DF:EC:B1

hybrid_classical
  SHA-1    35:71:3F:51:8A:F7:E9:27:77:3D:95:46:8D:0F:82:E8:84:B4:CB:F1
  SHA-256  31:F4:A9:C6:53:20:47:07:89:17:E5:72:4D:AC:4D:34:
           5A:A0:9F:36:9C:E4:35:90:45:B5:0B:DB:2F:7D:C7:EB

hybrid_pqc
  SHA-1    02:7F:DB:55:29:1A:79:90:8E:9C:EC:60:F0:00:25:C8:A7:96:C1:9B
  SHA-256  7D:88:BC:F9:CC:35:45:68:D1:93:24:2F:5A:F5:45:55:
           CC:34:21:B3:40:77:0E:8D:A7:E8:25:DD:FD:56:5E:31
```

Aujourd'hui l'application n'appelle aucun service qui en demande une : elle n'a
ni compte, ni Firebase, ni SDK tiers. Ces empreintes servent d'abord à
**vérifier** qu'un APK trouvé quelque part est bien celui qu'on a publié :

```bash
apksigner verify --print-certs app.apk
```

## Ce qui ne doit jamais entrer ici

La clé d'upload — `.jks`, `.keystore`, `.p12` — et ses mots de passe. Le
`.gitignore` de la racine les exclut **par extension et partout**, pas par
dossier : la pente naturelle est justement de déposer la clé privée à côté des
certificats publics, où elle a l'air à sa place.

Une clé privée entrée dans l'historique y reste après le commit qui la retire,
et doit être tenue pour compromise. La réparation n'est pas un `git rm` : c'est
une demande de réinitialisation auprès de Google, et plusieurs jours d'attente.

Où elle vit : hors du dépôt, sauvegardée en deux exemplaires dont un hors
ligne, son chemin et ses mots de passe dans `apps/mobile/keystore.properties`,
lui-même ignoré. Voir `keystore.properties.example`.
