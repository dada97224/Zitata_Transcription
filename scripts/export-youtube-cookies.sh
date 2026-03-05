#!/bin/bash
# Exporte les cookies YouTube depuis Chrome vers un fichier Netscape
# Usage: ./scripts/export-youtube-cookies.sh [output_path]
#
# Prérequis: Se connecter à YouTube dans Chrome AVANT d'exécuter ce script.
# Chrome doit être FERMÉ pour que le script puisse lire la base de données cookies.

OUTPUT="${1:-./cookies/youtube_cookies.txt}"
mkdir -p "$(dirname "$OUTPUT")"

echo "Export des cookies YouTube depuis Chrome..."

# Vérifier si Chrome est en cours d'exécution
if pgrep -x "chrome" > /dev/null 2>&1; then
    echo "⚠ Chrome semble en cours d'exécution."
    echo "  Fermez Chrome ou utilisez yt-dlp --cookies-from-browser chrome"
fi

yt-dlp --cookies-from-browser chrome --cookies "$OUTPUT" --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>/dev/null

if [ -f "$OUTPUT" ] && [ -s "$OUTPUT" ]; then
    echo "✓ Cookies exportés vers $OUTPUT"
    echo "  Configurez YT_COOKIES_PATH=$OUTPUT dans .env"
else
    echo "✗ Échec de l'export. Alternatives :"
    echo "  1. Installez l'extension 'Get cookies.txt LOCALLY' dans Chrome"
    echo "  2. Exportez les cookies pour youtube.com"
    echo "  3. Sauvegardez le fichier dans ./cookies/youtube_cookies.txt"
    echo "  4. Ajoutez YT_COOKIES_PATH=./cookies/youtube_cookies.txt dans .env"
fi
