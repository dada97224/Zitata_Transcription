# Limiter la RAM utilisée par WSL2 (VmmemWSL)

Sous Windows, Docker Desktop utilise WSL2. Le processus **VmmemWSL** est la VM WSL2 et peut consommer beaucoup de RAM (souvent jusqu’à 50 % de la RAM totale par défaut).

Pour limiter l’usage mémoire de WSL2 (et donc de Docker) :

## 1. Créer le fichier `.wslconfig`

Crée ou modifie le fichier :

**`C:\Users\<TonUtilisateur>\.wslconfig`**

(sans extension, remplace `<TonUtilisateur>` par ton nom d’utilisateur Windows)

Contenu recommandé pour **32 Go de RAM** (laisser ~12–16 Go à Windows) :

```ini
[wsl2]
memory=16GB
processors=8
swap=4GB
autoMemoryReclaim=gradual
```

- **memory** : plafond RAM pour WSL2 (ex. 16GB pour garder de la marge sous Windows).
- **processors** : nombre de cœurs CPU (ajuste selon ton CPU, 8 est un bon compromis).
- **swap** : swap WSL2 pour éviter les OOM.
- **autoMemoryReclaim** : `gradual` aide à rendre de la RAM à Windows quand WSL en utilise moins.

## 2. Appliquer les changements

Fermer toutes les fenêtres WSL / terminaux WSL, puis dans **PowerShell (en tant qu’admin)** :

```powershell
wsl --shutdown
```

Redémarre ensuite Docker Desktop (ou relance ta distro WSL). Les nouveaux paramètres sont pris en compte au prochain démarrage de WSL.

## 3. Limites déjà en place dans le projet

Dans `docker-compose.dev-stack.yml`, des limites mémoire sont définies pour éviter qu’un conteneur n’accapare toute la RAM :

- **ASR** : 12 Go max (Parakeet + NeMo).
- **Backend** : 2 Go max.
- **Frontend** : 2 Go max.

Cela évite que la stack dépasse raisonnablement la limite que tu donnes à WSL2 dans `.wslconfig`.
