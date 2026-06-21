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
        # ANDROID_TESTSUITE dan TV_EMBEDDED dikenal bisa bypass di beberapa kasus
        clients_to_try = [
            'ANDROID_TESTSUITE',  # Paling reliable untuk bypass bot check
            'ANDROID_VR',
            'TV_EMBEDDED',
            'WEB',                # Otomatis generate PO token via nodejs
            'ANDROID',
            'WEB_EMBEDDED',
            'MWEB',
            'WEB_CREATOR',
            'WEB_MUSIC',
            'TV',
        ]

        yt = None
        last_error = None
        successful_client = None

        # Mode 1: Coba dengan cookies jika tersedia
        if has_cookies:
            try:
                yt = YouTube(url, use_oauth=False, allow_oauth_cache=False)
                # Coba load cookies secara manual jika pytubefix support
                if hasattr(yt, '_cookies'):
                    yt._cookies = COOKIES_PATH
                _ = yt.title
                successful_client = 'cookies'
            except Exception as e:
                last_error = f"cookies: {str(e)}"
                yt = None

        # Mode 2: Coba berbagai client
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

        # Mode 3: Fallback tanpa parameter client
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

        # 3. Adaptive video (DASH) jika progressive kosong
        if len(formats) == 0 or (len(formats) == 1 and formats[0]["type"] == "audio"):
            try:
                adaptive_video = yt.streams.filter(only_video=True).order_by('resolution').desc()
                if adaptive_video:
                    for s in adaptive_video:
                        formats.append({
                            "type": "video",
                            "quality": s.resolution or "SD",
                            "url": s.url,
                            "ext": s.subtype,
                            "hasAudio": False
                        })
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
import sys
import json
import traceback

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)

    url = sys.argv[1]

    # Coba import pytubefix
    try:
        from pytubefix import YouTube
    except ImportError:
        # Fallback: coba pytube lama
        try:
            from pytube import YouTube
        except ImportError:
            print(json.dumps({"error": "pytubefix tidak terinstall. Jalankan: pip install pytubefix"}))
            sys.exit(1)

    try:
        # Coba berbagai client secara berurutan
        clients_to_try = ['WEB', 'ANDROID_VR', 'ANDROID', 'TV', 'WEB_CREATOR']
        yt = None
        last_error = None

        for client in clients_to_try:
            try:
                yt = YouTube(url, client=client)
                # Test akses title untuk validasi
                _ = yt.title
                break
            except Exception as e:
                last_error = str(e)
                continue

        if yt is None:
            # Fallback: tanpa parameter client
            try:
                yt = YouTube(url)
                _ = yt.title
            except Exception as e:
                print(json.dumps({"error": f"Semua client gagal: {last_error} | Fallback: {str(e)}"}))
                sys.exit(1)

        formats = []

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

        # 3. Adaptive video (DASH) jika progressive kosong
        if len(formats) == 0 or (len(formats) == 1 and formats[0]["type"] == "audio"):
            try:
                adaptive_video = yt.streams.filter(only_video=True).order_by('resolution').desc()
                if adaptive_video:
                    for s in adaptive_video:
                        formats.append({
                            "type": "video",
                            "quality": s.resolution or "SD",
                            "url": s.url,
                            "ext": s.subtype,
                            "hasAudio": False
                        })
            except Exception as e:
                print(json.dumps({"error": f"Gagal ambil adaptive video: {str(e)}"}), file=sys.stderr)

        result = {
            "title": yt.title,
            "author": yt.author,
            "thumbnail": yt.thumbnail_url,
            "duration": yt.length,
            "formats": formats
        }

        print(json.dumps(result))
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({"error": f"{str(e)} | trace: {tb[:200]}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
