import sys
import json
import os
import traceback

# Path ke cookies YouTube (opsional, untuk bypass bot detection)
COOKIES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cookies", "youtube_cookies.txt")

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)

    url = sys.argv[1]

    # Coba import pytubefix
    pytubefix_available = False
    try:
        from pytubefix import YouTube
        pytubefix_available = True
    except ImportError:
        try:
            from pytube import YouTube
        except ImportError:
            print(json.dumps({"error": "pytubefix tidak terinstall. Jalankan: pip install pytubefix"}))
            sys.exit(1)

    # Cek apakah cookies file ada
    has_cookies = os.path.isfile(COOKIES_PATH)

    try:
        # Daftar client untuk dicoba (urutan: yang paling mungkin bypass bot detection)
        # Prioritas: WEB (dengan po_token) > IOS > ANDROID > TV > lainnya
        clients_to_try = [
            'WEB',                # Paling umum, butuh po_token untuk hindari bot check
            'IOS',                # iOS client sering bypass
            'ANDROID',            # Android client alternatif
            'TV',                 # TV client (sering work untuk video terbatas)
            'ANDROID_MUSIC',      # Music client alternatif
            'IOS_MUSIC',          # iOS Music
            'WEB_EMBEDDED',       # Embedded web
            'TV_EMBEDDED',        # Embedded TV
            'MWEB',               # Mobile web
            'ANDROID_VR',         # VR
            'ANDROID_TESTSUITE',  # Test suite (kadang work)
            'WEB_CREATOR',        # Creator web
            'WEB_MUSIC',          # Web music
            'MEDIA_CONNECT',      # Media connect (client baru)
            'ANDROID_PRODUCER',   # Producer
            'IOS_CREATOR',        # iOS Creator
            'ANDROID_CREATOR',    # Android Creator
            'ANDROID_KIDS',       # Kids
            'IOS_KIDS',           # iOS Kids
            'WEB_KIDS',           # Web Kids
            'WEB_SAFARI',         # Safari web
        ]

        yt = None
        last_error = None
        successful_client = None

        # Mode 1: Coba dengan cookies jika tersedia
        if has_cookies:
            try:
                yt = YouTube(url, use_oauth=False, allow_oauth_cache=False)
                if hasattr(yt, '_cookies'):
                    yt._cookies = COOKIES_PATH
                _ = yt.title
                successful_client = 'cookies'
            except Exception as e:
                last_error = f"cookies: {str(e)}"
                yt = None

        # Mode 2: Coba berbagai client tanpa po_token
        if yt is None:
            for client in clients_to_try:
                try:
                    yt = YouTube(url, client=client)
                    _ = yt.title
                    successful_client = client
                    break
                except Exception as e:
                    last_error = str(e)
                    yt = None
                    continue

        # Mode 4: Fallback tanpa parameter client
        if yt is None:
            try:
                yt = YouTube(url)
                _ = yt.title
                successful_client = 'default'
            except Exception as e:
                print(json.dumps({
                    "error": f"Semua client gagal: {last_error} | Fallback: {str(e)}",
                    "hint": "YouTube memblokir IP server (cloud/datacenter). Upload cookies YouTube ke cookies/youtube_cookies.txt"
                }))
                sys.exit(1)

        formats = []
        client_info = f"client={successful_client}" + (" +cookies" if has_cookies else "")

        # 1. Progressive streams (Video + Audio combined)
        try:
            progressive = yt.streams.filter(progressive=True).order_by('resolution').desc()
            for s in progressive:
                formats.append({
                    "type": "video",
                    "quality": s.resolution or "SD",
                    "url": s.url,
                    "ext": s.subtype,
                    "hasAudio": True
                })
        except Exception as e:
            print(json.dumps({"error": f"Gagal ambil progressive streams: {str(e)}"}), file=sys.stderr)

        # 2. Audio only streams
        try:
            audio = yt.streams.filter(only_audio=True).order_by('abr').desc()
            if audio:
                best_audio = audio.first()
                formats.append({
                    "type": "audio",
                    "quality": "Audio",
                    "url": best_audio.url,
                    "ext": best_audio.subtype
                })
        except Exception as e:
            print(json.dumps({"error": f"Gagal ambil audio: {str(e)}"}), file=sys.stderr)

        # 3. Adaptive video (DASH) untuk resolusi tinggi (1080p+) — selalu ambil
        try:
            adaptive_video = yt.streams.filter(only_video=True).order_by('resolution').desc()
            adaptive_added = 0
            if adaptive_video:
                for s in adaptive_video:
                    # Hanya ambil resolusi >= 720p dan yang belum ada di progressive
                    if s.resolution and s.resolution not in [f["quality"] for f in formats if f["type"] == "video"]:
                        formats.append({
                            "type": "video",
                            "quality": s.resolution,
                            "url": s.url,
                            "ext": s.subtype,
                            "hasAudio": False
                        })
                        adaptive_added += 1
            if adaptive_added > 0:
                print(json.dumps({"info": f"Adaptive: {adaptive_added} format HD+ ditambahkan"}), file=sys.stderr)
        except Exception as e:
            print(json.dumps({"error": f"Gagal ambil adaptive video: {str(e)}"}), file=sys.stderr)

        # Validasi: cek apakah ada format yang valid
        if not formats:
            print(json.dumps({
                "error": f"Tidak ada stream tersedia ({client_info}). YouTube mungkin memblokir IP server.",
                "hint": "Upload cookies YouTube ke cookies/youtube_cookies.txt"
            }), file=sys.stderr)
            print(json.dumps({"error": "Tidak ada stream tersedia"}))
            sys.exit(1)

        result = {
            "title": yt.title,
            "author": yt.author,
            "thumbnail": yt.thumbnail_url,
            "duration": yt.length,
            "formats": formats,
            "client": client_info
        }

        print(json.dumps(result))
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({"error": f"{str(e)} | trace: {tb[:300]}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
