# Cookies YouTube pour yt-dlp (transcription)

Si la transcription échoue car YouTube bloque les téléchargements (IP datacenter / Docker), exporte les cookies d’un navigateur où tu es connecté à YouTube.

## Option 1 : Extension navigateur (recommandé sous Windows)

1. Dans **Chrome** : installe l’extension [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc).
2. Ouvre **youtube.com** et connecte-toi si besoin.
3. Clique sur l’extension → **Export** → enregistre le fichier dans ce dossier sous le nom **`youtube_cookies.txt`**.
4. Dans ton `.env` à la racine du projet, ajoute (pour le backend en Docker) :
   ```env
   YT_COOKIES_PATH=/app/cookies/youtube_cookies.txt
   ```
5. Redémarre le backend :  
   `docker compose -f docker-compose.dev-stack.yml up -d backend`

## Option 2 : Ligne de commande (Chrome fermé)

Sur ta machine, avec **Chrome complètement fermé** :

```powershell
# Si yt-dlp est installé (pip install yt-dlp) :
py -m yt_dlp --cookies-from-browser chrome --cookies "d:\Coding_Projet\Zitata_Transcription\cookies\youtube_cookies.txt" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

Puis configure `YT_COOKIES_PATH` et redémarre le backend comme ci‑dessus.
